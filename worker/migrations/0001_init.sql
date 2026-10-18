-- Players are identified by a nickname and a random token kept in their browser.
-- Only a hash of the token is stored.
CREATE TABLE players (
  id TEXT PRIMARY KEY,
  nickname TEXT NOT NULL,
  nickname_key TEXT NOT NULL UNIQUE,   -- lower-case, spaces removed: "Big Sal" and "bigsal" clash
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

-- One row per player per Lantern Cup month they joined.
CREATE TABLE cup_seasons (
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  month TEXT NOT NULL,                 -- YYYY-MM
  joined TEXT NOT NULL,                -- first trading day counted
  PRIMARY KEY (player_id, month)
);

-- A plan fills at the close of `fill`. The server sets fill and placed_at, never the browser.
CREATE TABLE cup_plans (
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  fill TEXT NOT NULL,                  -- YYYY-MM-DD
  month TEXT NOT NULL,
  targets TEXT NOT NULL,               -- JSON: {"company_id": percent}
  placed_at TEXT NOT NULL,
  PRIMARY KEY (player_id, fill)
);
CREATE INDEX cup_plans_month ON cup_plans (month);

-- Sign-ups per (hashed) IP per day, to slow down nickname spam.
CREATE TABLE signups (
  ip_hash TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (ip_hash, day)
);
