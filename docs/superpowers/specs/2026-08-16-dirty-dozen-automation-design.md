# Dirty Dozen Automation — Design

**Date:** 2026-08-16
**Status:** Approved pending user review
**League:** The Dirty Dozen — 12-team Sleeper keeper league, league ID `1389387813203484672` (2026, pre-draft)

## Goals

1. Compute every rostered player's keeper cost and eligibility for the upcoming draft automatically from Sleeper data.
2. Write the annual `NN-NN Keepers` sheet into `DirtyDozenFantasyFootball.xlsx`, matching the existing hand-built layout. The workbook remains the league's official record.
3. Generate the season finances ledger (dues debits, weekly high-points credits, place payouts) in the existing "League Legacy Finances" CSV format.
4. Publish a live league web page on GitHub Pages that fetches Sleeper directly from the viewer's browser — deployed once, always current.

## Non-goals

- Draft-order/rollover automation beyond what the sheet layout already displays.
- Enforcing keeper selections (the engine reports options; owners still declare keepers in Sleeper).
- Touching pre-migration (pre-Sleeper) league history. The Sleeper chain (2020 → 2026) is the whole history.
- Modifying any existing sheet in the workbook.

## Architecture

```
Fantasy Football/                     (OneDrive folder — NOT in git)
  DirtyDozenFantasyFootball.xlsx      (official record, output target)
  League Legacy Finances.csv/.xlsx    (existing ledger)
  finances-2026.csv                   (generated output)
  dd-tools/                           (git repo — pushed to GitHub for Pages)
    cli.js                            entry point: pull | keepers | finances
    config.json                       league ID, owner map, payouts
    lib/sleeper.js                    API client + cache under data/
    lib/keepers.js                    pure rules engine (shared with web page)
    lib/excel.js                      workbook writer (exceljs)
    lib/finances.js                   ledger generator
    web/index.html                    live league page (imports lib/keepers.js)
    data/                             cached Sleeper JSON (gitignored)
    test/                             engine + writer tests (node:test)
```

- **Language:** plain Node.js (v18+, already installed). ES modules. Single runtime dependency: `exceljs`. No bundler — the web page loads `keepers.js` as a native ES module.
- **Privacy boundary:** the repo becomes public for GitHub Pages. The xlsx/CSV files live outside it; `data/` and any generated ledgers are gitignored. `config.json` holds only the league ID (already public to anyone with it), first-name owner labels, and payout amounts.

## Components

### lib/sleeper.js — data access

Wraps the public read-only Sleeper API. Fetches and caches to `data/*.json`:

| Data | Endpoint |
|---|---|
| League + chain | `/v1/league/{id}` (walk `previous_league_id` to 2020) |
| Users, rosters | `/v1/league/{id}/users`, `/rosters` |
| Drafts + picks | `/v1/league/{id}/drafts`, `/v1/draft/{id}`, `/v1/draft/{id}/picks` |
| Traded picks | `/v1/league/{id}/traded_picks` |
| Weekly matchups | `/v1/league/{id}/matchups/{week}` |
| Player names | `/v1/players/nfl` (large; cached, refreshed at most daily) |

`pull` refreshes the cache. All other commands read the cache and warn with the cache timestamp if stale. On API failure, commands fall back to cache with a visible warning.

### lib/keepers.js — rules engine (pure, no I/O)

**Input:** draft history (picks with `is_keeper` flags, 2021→latest), current rosters, traded picks for the upcoming draft season. (Draft order is display data — it flows to the sheet/page directly, not through the engine.)
**Output:** per-team keeper board: `{player, position, basisRound, yearsKept, costRound, assignedRound, eligible, reason}` plus per-team assigned-slot resolution.

Rules encoded (from the workbook's "Rules and payouts" sheet, verified against 2023–2025 actuals):

1. **Basis round** — player's round in the most recent draft. A player bumped by a collision keeps their **nominal** round as next year's basis.
2. **Cost** — iterative off last year's round: 1st consecutive keep = basis − 1; 2nd = basis − 4; 3rd = basis − 8. (Verified: J. Williams 13→12→8; J. Cook 8→4→1; I. Pacheco 10→6→1.) **Exception — FA pickups:** an undrafted player's first keep is slotted at round 10 exactly (no −1); later years follow the normal offsets off the prior round: 10 → 6 → 1. (Verified: Irving FA→10; Collins FA→10→6.)
3. **Floor** — cost < 1 becomes round 1, pushing the team's other keepers down as needed.
4. **Eligibility** — a player is keeper-eligible iff: on the team's current roster; not entering a 4th consecutive kept season; and not drafted in R1–R2 last year *unless* that R1–R2 pick was itself a keeper slot (`is_keeper` distinguishes these).
5. **Years-kept** — consecutive `is_keeper` picks walking backward through the draft chain; any real (non-keeper) draft pick resets the count. Max 3.
6. **Traded picks** — if the team traded away the pick in a keeper's assigned round, the keeper slides up to the next round the team still owns.
7. **Collisions** — two keepers assigned the same round: one keeps it, the other takes the next-highest available round. Both retain nominal basis for future years. The rules sheet doesn't say which player moves, so the engine is deterministic: the longer-tenured keeper (more years kept, then earlier draft basis, then alphabetical) holds the round; the other slides up. Flagged in output so the commissioner can override in Sleeper if the owners agreed otherwise.

The engine is deterministic and side-effect free so the CLI and the web page share it byte-for-byte.

### lib/excel.js — workbook writer

`keepers` command produces the **`25-26 Keepers`** sheet (naming follows the existing `24-25 Keepers` pattern — the sheet built ahead of the 2026 draft):

- Column A: owner label; B: player; then prior-draft-round and keeper-round columns matching the existing layout (`N/A` for ineligible, `FA` for waiver basis).
- Side blocks mirroring the current sheet: Weekly Points Winners table (one row per regular-season week per the league's Sleeper settings, winner column filled from Sleeper as weeks complete, COUNTIF tally formulas), Overall Winners/payout block, Draft Order block (from Sleeper draft order when the commissioner sets it, else `TBD`), Loser/Punishment lines.
- **Safety:** before any write, copy the workbook to `DirtyDozenFantasyFootball.backup-YYYYMMDD-HHmmss.xlsx`. Writes only add/replace the target season sheet; all other sheets pass through untouched. Re-running the command regenerates the sheet idempotently.

### lib/finances.js — ledger generator

Writes `finances-2026.csv` (in the parent folder, outside the repo) in the exact Legacy column format:
`Season Name, Member Name, Amount, Type, Label, Tags, Status`

- 12 × `30, debit, League Dues, , pending` rows at season start (user flips to `paid` as money arrives; re-runs preserve manually edited statuses by merging on Season+Member+Label+Tags).
- Per completed week: `10, credit, Weekly Points, WeekN, pending` for the high scorer (top total points across all rosters that week, from matchups).
- Season end: place payouts `120/50/30` for 1st/2nd/3rd from final standings.
- Member names come from the owner map in `config.json` (Sleeper user → ledger name).

### web/index.html — live league page

Single self-contained page + the shared `keepers.js` module, deployed to GitHub Pages. On load, the viewer's browser fetches Sleeper directly (the API is public and CORS-open) — no server, no rebuilds for data changes; pushes only when logic/layout change.

- **Keeper board** — every team's roster with cost round, years kept, eligibility (and why not), searchable/sortable; each owner can see exactly what keeping any player costs.
- **Weekly winners** — during the season: each week's high scorer and score, running $ tally per owner.
- **Standings & payouts** — current standings, payout structure, punishment line.
- **Rules** — the keeper rules text, so the sheet screenshot never gets passed around again.
- Player-name data: fetch `/v1/players/nfl` once, trim to rostered players, cache in localStorage with 24h TTL (first load pays ~5 MB; later loads are instant).
- Dues paid/pending status intentionally **excluded** — the page shows only data derivable from public Sleeper data.

### cli.js

```
node cli.js pull        # refresh Sleeper cache
node cli.js keepers     # backup workbook, write 25-26 Keepers sheet, print summary
node cli.js finances    # write/refresh finances-2026.csv
```

Season is inferred from the league's `season` field; a `--season` flag overrides for regenerating history.

## Error handling

- Network failure → use cache, warn with age. Empty cache → exit with a clear message to run `pull`.
- Player on roster but missing from player map → listed with raw ID and flagged, never dropped silently.
- Keeper-history anomalies (e.g. `is_keeper` gaps that make years-kept ambiguous) → flagged in output with the engine's best guess and the evidence, not silently resolved.
- Excel write failure → original untouched (backup made first; write goes to temp file, then atomic replace).
- Workbook open in Excel (file lock) → clear "close the workbook and retry" message.

## Testing

- **Engine regression fixtures (the core guarantee):** committed snapshots of the real 2022–2025 drafts/rosters. The engine run on year N data must reproduce the actual keeper costs observed in year N+1's draft (24 keepers in 2025, 26 in 2024). Divergences must be explained (trades/collisions) or fixed before shipping.
- Unit tests for each rule in isolation (floor push-down, collision, traded pick, FA track, R1/R2 exception, reset-on-redraft) via `node:test`, offline against fixtures.
- Excel writer: test writes to a scratch copy, re-reads it, asserts sheet content and that other sheets survived byte-identical where expected.
- Web page: shares the tested engine; smoke-checked in a browser before each deploy.

## Deployment

- `dd-tools/` is a git repo; GitHub Pages serves `web/` (project page at `https://<user>.github.io/dirty-dozen/`). Set up via `gh` CLI with the user's confirmation before anything is pushed publicly.
- Data updates require nothing. Logic updates = commit + push.

## Decisions log

- Approach: single Node codebase, shared rules engine (over Python+openpyxl snapshot approach) — user approved.
- Hosting: GitHub Pages — user approved.
- Finances: generate dues + weekly winners + place payouts — user approved.
- Post-migration Sleeper history only; treated as its own league — user directive.
- Dues status stays off the public page — default accepted.
