import json
import shutil
from collections import Counter

import numpy as np
import pandas as pd
import pytest

from lanternport.balance import balance_report
from lanternport.constants import CONTEXT, GAME, WINDOW
from lanternport.engine import DATA_DIR, WorldError, load_world, simulate
from lanternport.publish import PUZZLE_GAP_BEFORE_LAUNCH, Publisher, publish

LAUNCH = "2020-06-01"


@pytest.fixture(scope="module")
def world():
    return load_world()


@pytest.fixture(scope="module")
def sim(world):
    return simulate(world, "2016-01-04", "2021-06-30", seed=7, launch=LAUNCH)


def test_world_content_is_consistent(world):
    assert len(world.companies) == 60
    assert len({c["ticker"] for c in world.companies}) == 60


def test_typos_in_content_are_reported(tmp_path):
    for f in DATA_DIR.glob("*.yaml"):
        shutil.copy(f, tmp_path / f.name)
    path = tmp_path / "companies.yaml"
    path.write_text(path.read_text(encoding="utf-8").replace("rival: glowbean", "rival: glowbeen", 1), encoding="utf-8")
    with pytest.raises(WorldError, match="glowbeen"):
        load_world(tmp_path)


def test_simulation_is_reproducible(world, sim):
    again = simulate(world, "2016-01-04", "2021-06-30", seed=7, launch=LAUNCH)
    assert [n.headline for n in again.news] == [n.headline for n in sim.news]
    np.testing.assert_array_equal(again.bars, sim.bars)


def test_every_headline_is_filled_in_and_ohlc_is_valid(sim):
    for n in sim.news:
        assert "{" not in n.headline and "{" not in n.body, n.headline
    o, h, l, c = (sim.bars[..., k] for k in range(4))
    assert (l <= np.minimum(o, c) + 1e-9).all() and (h >= np.maximum(o, c) - 1e-9).all() and (l > 0).all()


def test_storylines_actually_happen(world, sim):
    kinds = Counter(n.kind for n in sim.news)
    for kind in ("results_good", "results_bad", "rumour", "scandal", "ceo_exit", "new_boss", "contract", "fluff"):
        assert kinds[kind] > 0, kind
    assert 1.5 < sum(1 for n in sim.news if n.scope != "feature") / len(sim.calendar) < 6  # a few headlines a day


def test_news_moves_prices_the_way_the_lessons_say(world, sim):
    """Measured from the next open (what a player reacting to the news can catch)."""
    moves: dict[int, list[float]] = {1: [], -1: []}
    for n in sim.news:
        for cid, sign in n.effects.items():
            ci = world.index[cid]
            if n.day + 6 < len(sim.calendar):
                moves[sign].append(np.log(sim.bars[ci, n.day + 6, 3] / sim.bars[ci, n.day + 1, 0]))
    assert np.mean(moves[1]) > 0.01
    assert np.mean(moves[-1]) < -0.01


def test_bosses_reset_to_the_guide_at_launch(world, sim):
    launch = int(sim.calendar.searchsorted(pd.Timestamp(LAUNCH)))
    assert sim.bosses[launch] == {c["id"]: c["boss"] for c in world.companies}


def test_publishing_never_leaks_the_future(sim, tmp_path):
    result = publish(sim, pd.Timestamp(LAUNCH).date(), pd.Timestamp("2020-07-15").date(), tmp_path / "world",
                     tmp_path / "puzzles", puzzle_count=20, seed=3)
    days = sorted(p.stem for p in (tmp_path / "world" / "days").glob("*.json"))
    assert days[0] == "2020-06-01" and days[-1] == "2020-07-15" and result["editions"] == len(days)
    index = json.loads((tmp_path / "world" / "index.json").read_text())
    assert index["today"] == "2020-07-15"
    # 15 July is a Wednesday: its market hasn't closed when the morning build runs, so prices stop on the 14th.
    assert index["completed"] == "2020-07-14"
    assert index["prices"]["dates"][-1] == "2020-07-14" and index["index_series"]["dates"][-1] == "2020-07-14"
    assert index["prices"]["dates"][0] == "2020-06-01"  # from the start of last month (here, launch)
    assert all(len(v) == len(index["prices"]["dates"]) for v in index["prices"]["closes"].values())
    company = json.loads((tmp_path / "world" / "companies" / "fizzco.json").read_text())
    assert company["dates"][-1] == "2020-07-14"
    assert all(item["date"] <= "2020-07-15" for item in company["news"])
    # The morning paper carries the news from after the previous close.
    pub = Publisher(sim, pd.Timestamp(LAUNCH).date(), pd.Timestamp("2020-07-15").date())
    t = next(t for t in range(pub.L + 1, pub.R) if any(n.scope != "feature" for n in pub.by_day.get(t - 1, [])))
    prev_headlines = {n.headline for n in pub.by_day.get(t - 1, []) if n.scope != "feature"}
    ed = pub.edition(t)
    shown = {ed["lead"]["headline"]} | {s["headline"] for s in ed["stories"]} | set(ed["briefs"])
    assert shown == prev_headlines


def test_archive_puzzles_come_from_unpublished_backstory(sim):
    pub = Publisher(sim, pd.Timestamp(LAUNCH).date(), pd.Timestamp("2020-07-15").date())
    puzzles = pub.puzzles(25, seed=2)
    latest = max(p["company"]["archive"] for p in puzzles)
    assert latest  # labelled with a season
    for p in puzzles:
        assert len(p["game"]) == GAME and p["context"][-1][3] == 100.0
        assert sum(1 for s in p["_signals"] if CONTEXT - 1 <= s["i"] < CONTEXT + GAME - 1) >= 3
    # The newest possible window ends well before launch.
    assert pub.L - PUZZLE_GAP_BEFORE_LAUNCH - WINDOW > 0


def test_world_puzzles_reward_reading_the_news(sim):
    pub = Publisher(sim, pd.Timestamp(LAUNCH).date(), pd.Timestamp("2020-07-15").date())
    report = balance_report(pub.puzzles(80, seed=4), n_random=120)
    assert 70 <= report["median_percentile"] <= 97
    assert 55 <= report["beat_buy_hold_pct"] <= 90


def test_build_needs_a_seed(monkeypatch, tmp_path):
    from lanternport import cli

    monkeypatch.delenv("LANTERNPORT_SEED", raising=False)
    monkeypatch.setattr(cli, "ENGINE_DIR", tmp_path)  # no .seed file here
    with pytest.raises(SystemExit, match="No seed"):
        cli.read_seed()
    monkeypatch.setenv("LANTERNPORT_SEED", "12345")
    assert cli.read_seed() == 12345
    monkeypatch.setenv("LANTERNPORT_SEED", "not-a-number")
    with pytest.raises(SystemExit, match="whole number"):
        cli.read_seed()


def test_check_command(capsys):
    from lanternport.cli import main

    assert main(["check"]) == 0
    assert "60 companies" in capsys.readouterr().out


def test_weekend_builds_publish_fridays_close(sim):
    pub = Publisher(sim, pd.Timestamp(LAUNCH).date(), pd.Timestamp("2020-07-18").date())  # a Saturday
    assert sim.calendar[pub.R].strftime("%Y-%m-%d") == "2020-07-17"  # Friday's edition
    assert sim.calendar[pub.C].strftime("%Y-%m-%d") == "2020-07-17"  # and Friday's close is final
