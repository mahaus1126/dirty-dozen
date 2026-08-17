# Dirty Dozen Tools

Automation for The Dirty Dozen fantasy football league (Sleeper).

**Live league page:** https://mahaus1126.github.io/dirty-dozen/ — fetches Sleeper
from the viewer's browser, so it is always current with zero maintenance.

## Annual workflow

| When | Command | What it does |
|---|---|---|
| Offseason | `node cli.js pull` then `node cli.js keepers` | Writes the "NN-NN Keepers (Generated)" sheet into the workbook (timestamped backup first; hand-made sheets are never touched) |
| Weekly in season | `node cli.js pull` then `node cli.js finances` | Refreshes `finances-YYYY.csv` with weekly high-score winners |
| Season end | same as weekly | Adds 1st/2nd/3rd place payout rows from the playoff bracket |

The workbook must be closed in Excel when running `keepers` (a friendly error
tells you if it isn't). The live page needs no updates — push to `main` only
when logic or layout changes.

## Config (`config.json`)

- `amounts` — dues / weekly / place payouts (currently $50 dues, $280/$140/$45
  places, $10 weekly). Edit when the league votes changes; existing CSV rows
  keep any hand-edited amounts.
- `owners` — Sleeper username → ledger first-name map. Edit when someone new
  joins; the finances command warns about orphaned rows after a rename.
- `basisOverrides` — pin a player's nominal keeper basis when a draft-day
  collision bumped their recorded round.

## Keeper rules encoded

Cost: previous round − 1 / − 4 / − 8 for 1st/2nd/3rd consecutive keep, floored
at round 1. Undrafted waiver pickups: 10 → 6 → 1. R1–R2 draftees can't be kept
(keeper slots exempt, same team only). Max 3 consecutive keeps, and the clock
is **per team** — it restarts when a kept player changes teams (owner ruling,
2026-08-16). Traded-away rounds slide keepers up; collisions resolve by tenure.

## Tests

`npm test` — 44 tests including a regression suite that replays 4 years of real
keeper history. Accepted hand-era divergences live in
`test/fixtures/allowlist.json`, each with an evidence-based reason.
