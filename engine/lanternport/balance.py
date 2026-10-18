"""Balance check: does reading the news beat chance in archive rounds, without being a sure thing?

Mirrors the game's scoring (src/engine.ts) closely enough to compare a news-reading bot with random
traders and buy-and-hold over many puzzles.
"""

from __future__ import annotations

import numpy as np

from lanternport.constants import CONTEXT, GAME

LEVELS = (0.0, 0.25, 0.5, 0.75, 1.0)


def play(game: np.ndarray, allocs: list[float], fee: float = 0.001) -> float:
    """Final value from 10,000: rebalance to each allocation at the day's open, value at the close."""
    cash, shares = 10_000.0, 0.0
    for (o, _, _, _), a in zip(game, allocs):
        value = cash + shares * o
        trade = a * value - shares * o
        if trade > 1e-9:
            buy = min(trade, cash / (1 + fee))
            shares += buy / o
            cash -= buy * (1 + fee)
        elif trade < -1e-9:
            shares += trade / o
            cash += -trade * (1 - fee)
    return cash + shares * game[len(allocs) - 1][3]


def news_bot(puzzle: dict, hold: int = 5, base: float = 0.5) -> list[float]:
    """A player who reads every headline correctly: all in after good news, out after bad, ignores fluff."""
    by_day: dict[int, int] = {}
    for s in puzzle["_signals"]:
        by_day[s["i"]] = by_day.get(s["i"], 0) + s["sign"]
    allocs, level, until = [], base, -1
    for d in range(GAME):
        sign = by_day.get(CONTEXT - 1 + d, 0)  # news after this close decides the next open
        if sign > 0:
            level, until = 1.0, d + hold
        elif sign < 0:
            level, until = 0.0, d + hold
        elif d > until:
            level = base
        allocs.append(level)
    return allocs


def balance_report(puzzles: list[dict], n_random: int = 300, seed: int = 0) -> dict:
    rng = np.random.default_rng(seed)
    pct, beat_bh = [], []
    for p in puzzles:
        game = np.array(p["game"])
        bot = play(game, news_bot(p))
        bh = play(game, [1.0] * GAME)
        rand = []
        for _ in range(n_random):
            level, allocs = LEVELS[rng.integers(5)], []
            for d in range(GAME):
                if d == 0 or rng.random() < 0.35:
                    level = LEVELS[rng.integers(5)]
                allocs.append(level)
            rand.append(play(game, allocs))
        pct.append(float((np.array(rand) < bot).mean() * 100))
        beat_bh.append(bot > bh)
    return {"median_percentile": float(np.median(pct)), "beat_buy_hold_pct": float(np.mean(beat_bh) * 100),
            "rounds": len(puzzles)}
