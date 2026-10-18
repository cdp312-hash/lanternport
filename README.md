# Lanternport

A cosy fictional harbour city with a daily newspaper, a stock exchange and daily games.
Live at https://cdp312-hash.github.io/lanternport/

- **The Lanternport Ledger** (home page): each morning's paper. Lead story, other stories, developing
  stories, markets at the close, weather, gossip and a company of the day, plus every past edition.
- **Markets**: the Lantern 60 index and all 60 companies. Each company has a page with its chart,
  boss, rival and news.
- **Daily Trade**: a 30-day trading round on a company from the Ledger's archive. Each day you choose
  how much of £10,000 to have invested (cash, 25%, 50%, 75% or all in). Trades fill at the next open
  with a 0.1% fee. News moves prices in learnable ways (results keep drifting, takeover rumours fade,
  scandals partly recover, fluff does nothing), so reading the news is the skill. You're scored
  against buy-and-hold, perfect hindsight and 1,000 random traders, then shown what each headline did.

Everything is made up, so there is no market data to license and nothing to look up.

## Run the site locally

```
./install.ps1        # first time only: npm install, with node_modules kept outside OneDrive
npm run dev          # http://localhost:5174 while editing
npm run build        # type-check and build the static site into dist/
npm run preview      # serve dist/ at http://localhost:4174
npm test             # game logic tests
```

The site needs world data in `public/`. Build it with the engine first (below).

Useful URLs for testing: `?n=12#/trade` plays puzzle 12 as practice; `?autoplay#/trade` finishes a
practice round with random choices (`?autoplay=15` stops after 15 days); `?skiphelp` hides the
first-visit instructions.

## The world engine

The world is simulated by the Python package in [engine/](engine/) (`lanternport`). Its content
(city, districts, 60 companies, bosses, storylines and their headlines) is plain YAML in
[engine/lanternport/data/](engine/lanternport/data/) and can be edited freely; typos are reported
with the file and company or storyline.

```
pip install -e "engine[dev]"
python -m lanternport check                 # validate the YAML
python -m lanternport build                 # editions up to today + 365 archive puzzles
cd engine && python -m pytest               # engine tests
```

`build` writes `public/world/` (index, one file per edition, one per company) and `public/puzzles/`.
These are generated, not committed. Only editions up to today are written; later days are simulated
but kept back. Trading rounds come from years of backstory that is never published.

**The seed is secret.** The world is decided by a seed read from `LANTERNPORT_SEED` (a GitHub secret)
or `engine/.seed` (git-ignored, on the developer's PC). With the public code and the seed, anyone
could work out tomorrow's news, so never commit it. Changing it, or the dates in
[engine/lanternport/constants.py](engine/lanternport/constants.py), re-rolls the entire history.

Each build runs a balance check: a bot that reads every headline correctly should usually beat random
traders and buy and hold, but not always (currently about 83% and 72%).

## Publishing

[.github/workflows/deploy.yml](.github/workflows/deploy.yml) tests the engine and the game, builds
the world and publishes the site to GitHub Pages:

- on every push to `main`,
- every morning at 05:00 UTC, which is how each new Ledger comes out,
- or by hand from the **Actions** tab (**Build and publish → Run workflow**).

One-time setup: **Settings → Pages → Source: GitHub Actions**, and the `LANTERNPORT_SEED` secret
under **Settings → Secrets and variables → Actions**.

GitHub pauses scheduled workflows in public repositories after 60 days without commits. It emails a
warning first; any commit, or re-enabling the workflow in the Actions tab, restarts it.

## Ads

Ads come from Google AdSense and are off until configured. AdSense only approves live sites.

1. Sign up at adsense.google.com with the site's address and wait for approval.
2. Create two display ad units (under the results, and the footer) and switch on
   **Privacy & messaging → European regulations message**, the consent banner UK and EEA visitors need.
3. Add repository **variables** `ADSENSE_CLIENT` (e.g. `ca-pub-1234…`), `AD_SLOT_RESULT` and
   `AD_SLOT_FOOTER`. The next deploy shows ads and writes `ads.txt`.
4. Fill in the bracketed parts of [public/privacy.html](public/privacy.html).

Ads sit under the results and in the footer, away from the trading buttons; AdSense forbids
placements that invite accidental clicks.

## Not built yet

- Live trading season: a monthly £10,000 portfolio traded once a day on the live world.
- Leaderboards (daily and all-time) and nicknames, which need a small backend. Today the
  comparison is with 1,000 simulated random traders, and stats live in the player's browser.
- The game's name is still a working title (`TITLE` in [src/TradeGame.tsx](src/TradeGame.tsx)).
