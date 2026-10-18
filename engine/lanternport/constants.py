"""Fixed facts about the simulated world.

Changing any of these (or the seed) re-rolls the whole history of Lanternport, including editions
players have already read, so treat them as permanent once the site is live.
"""

from datetime import date

HISTORY_START = date(2016, 1, 4)  # backstory begins (used for archive puzzles, never published)
LAUNCH = date(2026, 9, 28)  # first published edition of the Ledger
SIM_END = date(2035, 12, 31)  # fixed horizon: the simulation's random draws depend on its length

# Trading-round shape: bars shown before day 1, game days, bars shown after the round.
CONTEXT, GAME, AFTER = 90, 30, 30
WINDOW = CONTEXT + GAME + AFTER

SEED_ENV = "LANTERNPORT_SEED"
SEED_FILE = ".seed"  # in the engine folder; git-ignored
