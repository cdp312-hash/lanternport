"""Turns a simulated Lanternport into files for the game site.

* The live world starts on the launch date. One newspaper edition per trading day is published,
  up to and including the ``through`` date; later days are simulated but not written, so the
  future can't be read from the site. (A scheduled job republishes each morning.)
* Trading puzzles come from the years of backstory before launch, which are never published, so
  their outcomes can't be looked up either.

Output (under ``out``):
    index.json              world facts, published editions, company list with latest prices
    days/<date>.json        each morning's Ledger: lead story, other stories, briefs, markets, weather
    companies/<id>.json     profile, price history (closes) and news for each company
and daily puzzles in the existing puzzle format (``mode: "world"``).
"""

from __future__ import annotations

import base64
import json
from collections import deque
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

from lanternport.constants import CONTEXT, GAME, WINDOW
from lanternport.engine import News, Simulation
PRE_LAUNCH_CHART_DAYS = 60
PUZZLE_GAP_BEFORE_LAUNCH = 130  # trading days kept clear between the archive and the published history
FORECASTS = {
    "sunny": "Sunglasses at the ready.",
    "cloudy": "Grey but dry, probably.",
    "rain": "Brollies out, Lanternport.",
    "snow": "Wrap up warm and mind the ice.",
    "storm": "Batten down the hatches.",
}


def _season(d: pd.Timestamp) -> str:
    return ["Winter", "Winter", "Spring", "Spring", "Spring", "Summer", "Summer", "Summer",
            "Autumn", "Autumn", "Autumn", "Winter"][d.month - 1]


def _r(x: float, n: int = 2) -> float:
    return round(float(x), n)


class Publisher:
    def __init__(self, sim: Simulation, launch: date, through: date):
        self.sim = sim
        self.w = sim.world
        cal = sim.calendar
        self.L = int(cal.searchsorted(pd.Timestamp(launch)))
        self.R = int(cal.searchsorted(pd.Timestamp(through), side="right")) - 1
        if self.L < WINDOW + PUZZLE_GAP_BEFORE_LAUNCH:
            raise ValueError("Launch is too close to the start of the simulation to leave room for backstory")
        if self.R < self.L:
            raise ValueError("'through' is before the launch date")
        if self.R >= len(cal):
            raise ValueError("'through' is past the end of the simulation")
        self.by_day: dict[int, list[News]] = {}
        self.stories: dict[int, list[News]] = {}
        for n in sim.news:
            self.by_day.setdefault(n.day, []).append(n)
            if n.story >= 0 and n.scope != "feature":
                self.stories.setdefault(n.story, []).append(n)
        self.closes = sim.bars[:, :, 3]
        self.level = sim.index_level()

    # --- Newspaper -----------------------------------------------------------------------
    def _story(self, n: News) -> dict:
        w = self.w
        if n.scope == "weather":
            tag = "Weather"
        elif n.scope == "market":
            tag = "Markets"
        elif n.scope == "sector":
            tag = w.sectors[n.sector]["name"]
        elif n.companies:
            tag = w.sectors[w.by_id[n.companies[0]]["sector"]]["name"]
        else:
            tag = "Lanternport"
        return {"headline": n.headline, "body": n.body, "tag": tag,
                "companies": [{"id": c, "name": w.by_id[c]["name"]} for c in n.companies]}

    def _movers(self, t: int) -> tuple[list[dict], list[dict]]:
        change = (self.closes[:, t] / self.closes[:, t - 1] - 1) * 100
        order = np.argsort(change)
        row = lambda i: {"id": self.w.companies[i]["id"], "name": self.w.companies[i]["name"],
                         "ticker": self.w.companies[i]["ticker"], "change": _r(change[i])}
        return [row(i) for i in order[::-1][:3]], [row(i) for i in order[:3]]

    def edition(self, t: int) -> dict:
        """The morning paper for trading day t: the news that came out after the previous close,
        and the markets as of that close."""
        cal = self.sim.calendar
        news = sorted(self.by_day.get(t - 1, []), key=lambda n: (-n.importance, n.id))
        stories = [n for n in news if n.scope != "feature"]
        features = [n.headline for n in news if n.scope == "feature"]
        gainers, losers = self._movers(t - 1)
        weather = self.sim.weather[t]
        if stories:
            lead = self._story(stories[0])
        elif features:  # a quiet night for business: lead with the best local story, as a real paper would
            lead = {"headline": features.pop(0), "body": "", "tag": "Around town", "companies": []}
        else:
            lead = None
        return {
            "date": cal[t].strftime("%Y-%m-%d"),
            "edition": t - self.L + 1,
            "weather": {**weather, "forecast": FORECASTS[weather["sky"]], "presenter": self.w.characters["weather"]["name"]},
            "developing": self.developing(t),
            "gossip": self.gossip(t),
            "spotlight": self.spotlight(t),
            "lead": lead,
            "stories": [self._story(n) for n in stories[1:6]],
            "briefs": [n.headline for n in stories[6:]],
            "features": features,
            "markets": {
                "index": _r(self.level[t - 1], 1),
                "change": _r((self.level[t - 1] / self.level[t - 2] - 1) * 100),
                "gainers": gainers,
                "losers": losers,
            },
        }

    def developing(self, t: int) -> list[dict]:
        """Storylines that have started but have more to come: the latest headline of each.
        (Only the fact that a story continues is revealed, never what happens next.)"""
        out = []
        for story, items in self.stories.items():
            seen = [n for n in items if n.day <= t - 1]
            if seen and any(n.day > t - 1 for n in items) and seen[-1].day < t - 1:
                out.append({**self._story(seen[-1]), "since": self.sim.calendar[seen[0].day + 1].strftime("%Y-%m-%d")})
        return sorted(out, key=lambda s: s["since"], reverse=True)[:4]

    def gossip(self, t: int) -> list[str]:
        templates = self.w.config.get("gossip", [])
        if not templates:
            return []
        rng = np.random.default_rng(t * 9973)
        lines = []
        for k in rng.choice(len(templates), size=min(2, len(templates)), replace=False):
            c = self.w.companies[int(rng.integers(len(self.w.companies)))]
            values = {
                "company": c["name"], "boss": self.sim.bosses[t][c["id"]], "trait": c["trait"], "product": c["product"],
                "district": self.w.districts[c["district"]]["name"], "sector": self.w.sectors[c["sector"]]["name"],
                **{k2: v["name"] for k2, v in self.w.characters.items()},
            }
            lines.append(templates[int(k)].format(**values))
        return lines

    def spotlight(self, t: int) -> dict:
        """Company of the day: rotates through every company before repeating."""
        ci = (t * 37) % len(self.w.companies)
        c = self.w.companies[ci]
        closes = self.closes[ci, max(0, t - 30):t]
        return {"id": c["id"], "name": c["name"], "ticker": c["ticker"], "what": c["what"], "product": c["product"],
                "boss": self.sim.bosses[t][c["id"]], "trait": c["trait"], "district": self.w.districts[c["district"]]["name"],
                "price": _r(closes[-1]), "month": _r((closes[-1] / closes[0] - 1) * 100, 1), "spark": [_r(x) for x in closes]}

    # --- Companies -------------------------------------------------------------------------
    def company(self, ci: int) -> dict:
        w, cal = self.w, self.sim.calendar
        c = w.companies[ci]
        lo = self.L - PRE_LAUNCH_CHART_DAYS
        cid = c["id"]
        news = [
            {"date": cal[n.day + 1].strftime("%Y-%m-%d"), "headline": n.headline}
            for d in range(self.L - 1, self.R)
            for n in self.by_day.get(d, [])
            if cid in n.companies or (n.scope != "company" and cid in n.effects)
        ]
        return {
            "id": cid, "name": c["name"], "ticker": c["ticker"], "what": c["what"], "product": c["product"],
            "sector": w.sectors[c["sector"]]["name"], "district": w.districts[c["district"]]["name"],
            "boss": self.sim.bosses[self.R][cid], "trait": c["trait"],
            "rival": w.by_id[c["rival"]]["name"] if c.get("rival") else None,
            "rival_id": c.get("rival"),
            "launch_index": PRE_LAUNCH_CHART_DAYS,
            "dates": [d.strftime("%Y-%m-%d") for d in cal[lo:self.R + 1]],
            "closes": [_r(x) for x in self.closes[ci, lo:self.R + 1]],
            "news": list(reversed(news)),
        }

    def index(self, editions: list[str]) -> dict:
        w, t = self.w, self.R
        cfg = w.config
        return {
            "city": cfg["city"], "newspaper": cfg["newspaper"], "motto": cfg.get("motto", ""), "blurb": cfg.get("blurb", ""),
            "index_name": cfg["index"]["name"],
            "launch": self.sim.calendar[self.L].strftime("%Y-%m-%d"),
            "today": self.sim.calendar[t].strftime("%Y-%m-%d"),
            "editions": editions,
            "sectors": [s["name"] for s in w.sectors.values()],
            "districts": [{"name": d["name"], "blurb": d["blurb"]} for d in w.districts.values()],
            "characters": [{"name": c["name"], "about": c["about"]} for c in w.characters.values()],
            "companies": [
                {"id": c["id"], "name": c["name"], "ticker": c["ticker"], "sector": w.sectors[c["sector"]]["name"],
                 "price": _r(self.closes[i, t - 1]),
                 "change": _r((self.closes[i, t - 1] / self.closes[i, t - 2] - 1) * 100),
                 "spark": [_r(x) for x in self.closes[i, max(self.L - 20, t - 30):t]]}
                for i, c in enumerate(w.companies)
            ],
            "index_series": {"dates": [d.strftime("%Y-%m-%d") for d in self.sim.calendar[self.L - PRE_LAUNCH_CHART_DAYS:t]],
                             "levels": [_r(x, 1) for x in self.level[self.L - PRE_LAUNCH_CHART_DAYS:t]]},
        }

    # --- Archive puzzles ---------------------------------------------------------------------
    def _relevant(self, n: News, cid: str) -> bool:
        return cid in n.effects or (n.scope == "company" and n.companies[:1] == [cid])

    def puzzle(self, number: int, ci: int, start: int) -> dict:
        w, sim = self.w, self.sim
        c = w.companies[ci]
        cid = c["id"]
        bars = sim.bars[ci, start:start + WINDOW]
        scale = bars[CONTEXT - 1, 3]
        rows = lambda a: [[_r(v / scale * 100) for v in r] for r in a]
        news, signals, recap = [], [], []
        for d in range(start, start + CONTEXT + GAME - 1):
            for n in self.by_day.get(d, []):
                if not self._relevant(n, cid):
                    continue
                i = d - start
                news.append({"i": i, "text": n.headline})
                sign = n.effects.get(cid, 0)
                if sign:
                    signals.append({"i": i, "sign": sign})
                if CONTEXT - 1 <= i < CONTEXT + GAME - 1:
                    end = min(i + 5, WINDOW - 1)
                    recap.append({"i": i, "text": n.headline, "kind": n.kind, "lesson": w.lessons[n.kind],
                                  "days": end - i, "move": _r((bars[end, 3] / bars[i + 1, 0] - 1) * 100, 1)})
        game_start = sim.calendar[start + CONTEXT]
        reveal = {"recap": recap, "archive": f"{_season(game_start)} {game_start.year}",
                  "start": game_start.strftime("%Y-%m-%d"), "end": sim.calendar[start + CONTEXT + GAME - 1].strftime("%Y-%m-%d")}
        return {
            "n": number,
            "mode": "world",
            "company": {"name": c["name"], "sector": w.sectors[c["sector"]]["name"], "what": c["what"], "ticker": c["ticker"],
                        "id": cid, "district": w.districts[c["district"]]["name"], "boss": sim.bosses[start + CONTEXT][cid],
                        "archive": f"{_season(game_start)} {game_start.year}"},
            "context": rows(bars[:CONTEXT]),
            "game": rows(bars[CONTEXT:CONTEXT + GAME]),
            "after": rows(bars[CONTEXT + GAME:]),
            "news": news,
            "reveal": base64.b64encode(json.dumps(reveal).encode("utf-8")).decode("ascii"),
            "_signals": signals,
        }

    def puzzles(self, count: int, seed: int = 5, avoid_repeat: int = 15) -> list[dict]:
        rng = np.random.default_rng(seed)
        last_start = self.L - PUZZLE_GAP_BEFORE_LAUNCH - WINDOW
        recent: deque[int] = deque(maxlen=avoid_repeat)
        out = []
        while len(out) < count:
            ci = int(rng.integers(len(self.w.companies)))
            if ci in recent:
                continue
            cid = self.w.companies[ci]["id"]
            for _ in range(300):
                start = int(rng.integers(0, last_start))
                moving = sum(
                    1 for d in range(start + CONTEXT - 1, start + CONTEXT + GAME - 1)
                    for n in self.by_day.get(d, []) if cid in n.effects
                )
                if moving >= 3:
                    out.append(self.puzzle(len(out) + 1, ci, start))
                    recent.append(ci)
                    break
        return out


def write_puzzles(puzzles: list[dict], out_dir: str | Path, epoch: date) -> Path:
    """One small file per puzzle plus index.json (which records the date of puzzle #1).
    Fields starting with "_" are for balance checks only and aren't written."""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*.json"):
        old.unlink()
    for p in puzzles:
        public = {k: v for k, v in p.items() if not k.startswith("_")}
        (out / f"{p['n']}.json").write_text(json.dumps(public, separators=(",", ":")), encoding="utf-8")
    (out / "index.json").write_text(json.dumps({"count": len(puzzles), "epoch": epoch.isoformat()}), encoding="utf-8")
    return out


def publish(sim: Simulation, launch: date, through: date, out: str | Path, puzzles_out: str | Path | None,
            puzzle_count: int = 365, seed: int = 5) -> dict:
    pub = Publisher(sim, launch, through)
    out = Path(out)
    for sub in ("days", "companies"):
        folder = out / sub
        folder.mkdir(parents=True, exist_ok=True)
        for old in folder.glob("*.json"):
            old.unlink()
    editions = []
    for t in range(pub.L, pub.R + 1):
        ed = pub.edition(t)
        editions.append(ed["date"])
        (out / "days" / f"{ed['date']}.json").write_text(json.dumps(ed, separators=(",", ":")), encoding="utf-8")
    for ci in range(len(sim.world.companies)):
        data = pub.company(ci)
        (out / "companies" / f"{data['id']}.json").write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    (out / "index.json").write_text(json.dumps(pub.index(editions), separators=(",", ":")), encoding="utf-8")
    puzzles = []
    if puzzles_out:
        puzzles = pub.puzzles(puzzle_count, seed=seed)
        write_puzzles(puzzles, puzzles_out, sim.calendar[pub.L].date())
    return {"editions": len(editions), "puzzles": puzzles, "launch": editions[0], "today": editions[-1]}
