"""Command line for the world engine.

    python -m lanternport build                   # editions up to today + archive puzzles
    python -m lanternport build --through 2026-10-16
    python -m lanternport check                   # validate the YAML content only

The seed comes from the LANTERNPORT_SEED environment variable (as on GitHub, where it's a secret)
or from engine/.seed (git-ignored, for local builds). Keep it secret: with the code and the seed,
anyone could work out tomorrow's news.
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import date
from pathlib import Path

from lanternport.constants import HISTORY_START, LAUNCH, SEED_ENV, SEED_FILE, SIM_END

ENGINE_DIR = Path(__file__).resolve().parent.parent
GAME_DIR = ENGINE_DIR.parent


def read_seed() -> int:
    raw = os.environ.get(SEED_ENV) or ((ENGINE_DIR / SEED_FILE).read_text().strip() if (ENGINE_DIR / SEED_FILE).exists() else "")
    if not raw:
        raise SystemExit(f"No seed found. Set {SEED_ENV} or put the seed in {ENGINE_DIR / SEED_FILE}.")
    try:
        return int(raw)
    except ValueError:
        raise SystemExit(f"The seed must be a whole number, got {raw!r}.")


def cmd_build(args: argparse.Namespace) -> int:
    from lanternport.balance import balance_report
    from lanternport.engine import load_world, simulate
    from lanternport.publish import publish

    through = args.through or date.today()
    world = load_world()
    seed = args.seed if args.seed is not None else read_seed()
    print(f"Simulating {world.config['city']} ({len(world.companies)} companies, {len(world.storylines)} storylines)...")
    sim = simulate(world, HISTORY_START, SIM_END, seed=seed, launch=LAUNCH)
    result = publish(sim, LAUNCH, through, args.out, None if args.no_puzzles else args.puzzles,
                     puzzle_count=args.count, seed=seed % 100_000)
    print(f"Published {result['editions']} editions ({result['launch']} to {result['today']}) to {args.out}")
    if result["puzzles"]:
        report = balance_report(result["puzzles"][:150], n_random=150)
        print(f"Wrote {len(result['puzzles'])} archive puzzles to {args.puzzles}. Balance: a perfect news reader beats "
              f"buy & hold in {report['beat_buy_hold_pct']:.0f}% of rounds and typically beats "
              f"{report['median_percentile']:.0f}% of random traders.")
    return 0


def cmd_check(args: argparse.Namespace) -> int:
    from lanternport.engine import load_world

    world = load_world()
    print(f"OK: {len(world.companies)} companies, {len(world.storylines)} storylines, {len(world.districts)} districts.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="lanternport", description="The Lanternport world engine")
    sub = parser.add_subparsers(dest="command", required=True)
    b = sub.add_parser("build", help="Simulate and publish editions, company pages and archive puzzles")
    b.add_argument("--through", type=date.fromisoformat, help="Publish editions up to this date (default today)")
    b.add_argument("--out", default=str(GAME_DIR / "public" / "world"))
    b.add_argument("--puzzles", default=str(GAME_DIR / "public" / "puzzles"))
    b.add_argument("--count", type=int, default=365, help="Archive puzzles to write (default 365)")
    b.add_argument("--no-puzzles", action="store_true")
    b.add_argument("--seed", type=int, help="Override the secret seed (tests and experiments only)")
    b.set_defaults(func=cmd_build)
    c = sub.add_parser("check", help="Validate the world content")
    c.set_defaults(func=cmd_check)
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
