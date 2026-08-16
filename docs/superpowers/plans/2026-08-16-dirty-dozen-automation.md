# Dirty Dozen Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automate keeper-cost computation, workbook sheet generation, season finances, and a live GitHub Pages league site for The Dirty Dozen (Sleeper league `1389387813203484672`).

**Architecture:** Plain Node.js (ES modules) CLI in `dd-tools/` with a pure, browser-safe keeper-rules engine (`lib/keepers.js`) shared verbatim by the CLI and a static web page. Sleeper API is the only data source; the workbook and finances CSV are outputs. Regression tests validate the engine against 4 years of real keeper history with an allowlist for hand-computed-era human error.

**Tech Stack:** Node 18+ (installed), `node:test`, `exceljs` (only runtime dep), vanilla-JS single-page site, GitHub Pages via `gh` CLI.

**Spec:** `docs/superpowers/specs/2026-08-16-dirty-dozen-automation-design.md`
**Spec deviation (deliberate):** the web page lives at repo root (`index.html`) instead of `web/index.html`, so the GitHub Pages URL is clean (`…/dirty-dozen/` rather than `…/dirty-dozen/web/`). It imports `./lib/keepers.js` as a native ES module.

**Known league facts (verified live 2026-08-16):**

| Season | League ID | Draft ID | Keeper-flagged picks |
|---|---|---|---|
| 2026 | 1389387813203484672 | 1389387813203484673 | (pre-draft) |
| 2025 | 1257449101973266432 | 1257449101973266433 | 24 |
| 2024 | 1080545999434731520 | 1080545999434731521 | 26 |
| 2023 | 992210095754518528 | 992210095754518529 | 26 |
| 2022 | 863901169892917248 | 866057373452713984 | 31 |
| 2021 | 733731388615974912 | 733731388615974913 | 24 |
| 2020 | 591388575946293248 | 606513145103568896 | (league's first Sleeper year) |

All drafts are 15-round snake, 180 picks. Chain ends at 2020 (`previous_league_id: null`).

---

## File Structure

```
dd-tools/
  package.json            type:module, test script, exceljs dep
  .gitignore              node_modules/, data/
  config.json             league ID, owner map, amounts, overrides
  cli.js                  command router: pull | keepers | finances
  lib/sleeper.js          API client + data/bundle.json cache (Node-only)
  lib/keepers.js          pure rules engine — NO imports, browser-safe
  lib/finances.js         weekly winners, CSV ledger merge (pure except noted)
  lib/excel.js            workbook backup + keeper sheet writer (exceljs)
  scripts/make-fixtures.js  trims data/bundle.json → test/fixtures/
  scripts/serve.js        15-line static server for local page preview
  index.html              live league page (GitHub Pages root)
  test/*.test.js          node:test suites (all offline, fixture-driven)
  test/fixtures/          committed real-data snapshots + allowlist.json
  data/                   gitignored Sleeper cache
```

---

### Task 1: Scaffold the project

**Files:**
- Create: `package.json`, `.gitignore`, `config.json`

- [ ] **Step 1: Write package.json**

```json
{
  "name": "dd-tools",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "test": "node --test test/"
  },
  "dependencies": {
    "exceljs": "^4.4.0"
  }
}
```

- [ ] **Step 2: Write .gitignore**

```
node_modules/
data/
```

- [ ] **Step 3: Write config.json**

Ledger names are best guesses mapping Sleeper accounts to the first names used in the `24-25 Keepers` sheet — confirmed with the user in Task 11. Amounts are the values currently in the workbook's Rules sheet as last read (30/120/50/30 + $10 weekly from the ledger CSV) — also confirmed/updated in Task 11 since the user reports they changed.

```json
{
  "leagueId": "1389387813203484672",
  "workbookPath": "../DirtyDozenFantasyFootball.xlsx",
  "financesDir": "..",
  "rounds": 15,
  "amounts": { "dues": 30, "weeklyPoints": 10, "places": [120, 50, 30] },
  "owners": [
    { "sleeperUsername": "AndyMorris", "ledgerName": "Andy" },
    { "sleeperUsername": "zthoreso", "ledgerName": "Thor" },
    { "sleeperUsername": "sschraff", "ledgerName": "Schraff" },
    { "sleeperUsername": "rkitching", "ledgerName": "Rob" },
    { "sleeperUsername": "cmateja03", "ledgerName": "Chad" },
    { "sleeperUsername": "tfrizzi", "ledgerName": "Frizzi" },
    { "sleeperUsername": "ndevillez", "ledgerName": "Nathan" },
    { "sleeperUsername": "AirFish", "ledgerName": "Fish" },
    { "sleeperUsername": "mahaus", "ledgerName": "Mitch" },
    { "sleeperUsername": "amcgowan", "ledgerName": "McGowan" },
    { "sleeperUsername": "esalata", "ledgerName": "Texas" },
    { "sleeperUsername": "SrBrown", "ledgerName": "Stephen" }
  ],
  "basisOverrides": {}
}
```

- [ ] **Step 4: Install and commit**

Run: `npm install` (in `dd-tools/`)
Expected: `added 1 package` (+ transitive deps), `node_modules/` appears, `package-lock.json` created.

```bash
git add package.json package-lock.json .gitignore config.json
git commit -m "feat: scaffold dd-tools project"
```

---

### Task 2: Sleeper client (`lib/sleeper.js`)

**Files:**
- Create: `lib/sleeper.js`
- Test: `test/sleeper.test.js`

- [ ] **Step 1: Write the failing tests**

`test/sleeper.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fetchJson, makeCache, pull } from '../lib/sleeper.js';

function fakeFetch(routes) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    for (const [pattern, body] of Object.entries(routes)) {
      if (url.includes(pattern)) return { ok: true, json: async () => structuredClone(body) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  fn.calls = calls;
  return fn;
}

test('fetchJson throws on non-OK response', async () => {
  await assert.rejects(
    () => fetchJson('https://x/nope', fakeFetch({})),
    /404/,
  );
});

test('makeCache fetches once within maxAge, refetches after', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ddcache-'));
  const ff = fakeFetch({ '/thing': { a: 1 } });
  const cache = makeCache(dir, ff);
  await cache.get('thing', 'https://x/thing', { maxAgeMs: 60000 });
  const second = await cache.get('thing', 'https://x/thing', { maxAgeMs: 60000 });
  assert.deepEqual(second, { a: 1 });
  assert.equal(ff.calls.length, 1); // second call served from cache
});

test('makeCache falls back to stale cache on network failure', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ddcache-'));
  const good = makeCache(dir, fakeFetch({ '/thing': { a: 1 } }));
  await good.get('thing', 'https://x/thing', { maxAgeMs: 60000 });
  const broken = makeCache(dir, fakeFetch({})); // 404s everything
  const result = await broken.get('thing', 'https://x/thing', { maxAgeMs: 0 }); // force refetch
  assert.deepEqual(result, { a: 1 }); // stale data survived
});

test('pull walks league chain and assembles bundle', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ddpull-'));
  const ff = fakeFetch({
    '/league/NEW/users': [{ user_id: 'u1' }],
    '/league/NEW/rosters': [{ roster_id: 1 }],
    '/league/NEW/drafts': [{ draft_id: 'DNEW' }],
    '/league/NEW/traded_picks': [],
    '/league/NEW/matchups': [],
    '/league/NEW/winners_bracket': [],
    '/league/NEW': { league_id: 'NEW', season: '2026', previous_league_id: 'OLD',
                     settings: { playoff_week_start: 15 } },
    '/league/OLD/users': [], '/league/OLD/rosters': [], '/league/OLD/drafts': [{ draft_id: 'DOLD' }],
    '/league/OLD/traded_picks': [],
    '/league/OLD': { league_id: 'OLD', season: '2025', previous_league_id: null,
                     settings: { playoff_week_start: 15 } },
    '/draft/DNEW/picks': [], '/draft/DOLD/picks': [{ round: 1 }],
    '/players/nfl': { p1: { first_name: 'A', last_name: 'B', position: 'RB' } },
  });
  const bundle = await pull({ leagueId: 'NEW' }, dir, ff);
  assert.equal(bundle.chain.length, 2);
  assert.equal(bundle.chain[0].season, '2026');
  assert.deepEqual(bundle.picks['2025'], [{ round: 1 }]);
  // bundle persisted for offline commands
  const reloaded = JSON.parse(await fs.readFile(path.join(dir, 'bundle.json'), 'utf8'));
  assert.equal(reloaded.chain.length, 2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/sleeper.test.js`
Expected: FAIL — `Cannot find module '../lib/sleeper.js'`

- [ ] **Step 3: Implement lib/sleeper.js**

```js
// Sleeper API client + local cache. Node-only (fs) — the web page uses fetch directly.
import fs from 'node:fs/promises';
import path from 'node:path';

const BASE = 'https://api.sleeper.app/v1';

export async function fetchJson(url, fetchImpl = fetch) {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Sleeper API ${res.status} for ${url}`);
  return res.json();
}

export function makeCache(dir, fetchImpl = fetch) {
  return {
    async get(name, url, { maxAgeMs = Infinity } = {}) {
      const file = path.join(dir, `${name}.json`);
      try {
        const stat = await fs.stat(file);
        if (Date.now() - stat.mtimeMs < maxAgeMs) {
          return JSON.parse(await fs.readFile(file, 'utf8'));
        }
      } catch { /* cache miss */ }
      let data;
      try {
        data = await fetchJson(url, fetchImpl);
      } catch (err) {
        try {
          const stale = JSON.parse(await fs.readFile(file, 'utf8'));
          console.warn(`WARN: network failed for ${name}, using stale cache (${err.message})`);
          return stale;
        } catch { throw err; }
      }
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(file, JSON.stringify(data));
      return data;
    },
  };
}

export async function pull(config, dataDir, fetchImpl = fetch) {
  const chain = [];
  let id = config.leagueId;
  while (id && id !== '0') {
    const lg = await fetchJson(`${BASE}/league/${id}`, fetchImpl);
    chain.push(lg);
    id = lg.previous_league_id;
  }
  const current = chain[0];
  const bundle = { pulledAt: new Date().toISOString(), chain,
                   users: {}, rosters: {}, drafts: {}, picks: {}, tradedPicks: {},
                   matchups: {}, brackets: {} };
  for (const lg of chain) {
    const y = lg.season;
    bundle.users[y] = await fetchJson(`${BASE}/league/${lg.league_id}/users`, fetchImpl);
    bundle.rosters[y] = await fetchJson(`${BASE}/league/${lg.league_id}/rosters`, fetchImpl);
    const drafts = await fetchJson(`${BASE}/league/${lg.league_id}/drafts`, fetchImpl);
    bundle.drafts[y] = drafts[0] ?? null;
    if (drafts[0]) {
      bundle.picks[y] = await fetchJson(`${BASE}/draft/${drafts[0].draft_id}/picks`, fetchImpl);
    }
    bundle.tradedPicks[y] = await fetchJson(`${BASE}/league/${lg.league_id}/traded_picks`, fetchImpl);
  }
  const lastRegWeek = (current.settings?.playoff_week_start ?? 15) - 1;
  for (let w = 1; w <= lastRegWeek; w++) {
    bundle.matchups[w] = await fetchJson(`${BASE}/league/${current.league_id}/matchups/${w}`, fetchImpl);
  }
  bundle.brackets[current.season] = await fetchJson(`${BASE}/league/${current.league_id}/winners_bracket`, fetchImpl);
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, 'bundle.json'), JSON.stringify(bundle));
  // Player-name map is ~5 MB — refresh at most daily.
  const cache = makeCache(dataDir, fetchImpl);
  await cache.get('players', `${BASE}/players/nfl`, { maxAgeMs: 24 * 3600 * 1000 });
  return bundle;
}

export async function loadBundle(dataDir) {
  try {
    return JSON.parse(await fs.readFile(path.join(dataDir, 'bundle.json'), 'utf8'));
  } catch {
    throw new Error('No cached data found. Run: node cli.js pull');
  }
}

export async function loadPlayers(dataDir) {
  try {
    return JSON.parse(await fs.readFile(path.join(dataDir, 'players.json'), 'utf8'));
  } catch {
    throw new Error('No cached player data found. Run: node cli.js pull');
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/sleeper.test.js`
Expected: 4 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add lib/sleeper.js test/sleeper.test.js
git commit -m "feat: Sleeper API client with bundle cache and stale fallback"
```

---

### Task 3: Real pull + committed test fixtures

Needs network. Produces the fixture snapshots every later test depends on.

**Files:**
- Create: `scripts/make-fixtures.js`
- Create (generated): `test/fixtures/seasons.json`, `test/fixtures/current.json`, `test/fixtures/allowlist.json`

- [ ] **Step 1: Write scripts/make-fixtures.js**

```js
// Trims data/bundle.json into small committed fixtures for offline tests.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBundle } from '../lib/sleeper.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bundle = await loadBundle(path.join(root, 'data'));
const fixDir = path.join(root, 'test', 'fixtures');
await fs.mkdir(fixDir, { recursive: true });

const trimPick = (p) => ({
  player_id: p.player_id,
  round: p.round,
  draft_slot: p.draft_slot,
  is_keeper: p.is_keeper === true,
  roster_id: p.roster_id,
  picked_by: p.picked_by,
  name: `${p.metadata?.first_name ?? ''} ${p.metadata?.last_name ?? ''}`.trim(),
  position: p.metadata?.position ?? '',
});

const seasons = {};
for (const [year, picks] of Object.entries(bundle.picks)) {
  seasons[year] = {
    picks: (picks ?? []).map(trimPick),
    tradedPicks: (bundle.tradedPicks[year] ?? []).map(t => ({
      season: t.season, round: t.round, roster_id: t.roster_id, owner_id: t.owner_id,
    })),
    draftOrder: bundle.drafts[year]?.draft_order ?? null,
  };
}
await fs.writeFile(path.join(fixDir, 'seasons.json'), JSON.stringify(seasons, null, 1));

const cur = bundle.chain[0];
await fs.writeFile(path.join(fixDir, 'current.json'), JSON.stringify({
  season: cur.season,
  settings: { playoff_week_start: cur.settings?.playoff_week_start ?? 15 },
  users: bundle.users[cur.season].map(u => ({
    user_id: u.user_id, display_name: u.display_name,
    metadata: { team_name: u.metadata?.team_name ?? '' },
  })),
  rosters: bundle.rosters[cur.season].map(r => ({
    roster_id: r.roster_id, owner_id: r.owner_id, players: r.players ?? [],
    settings: { wins: r.settings?.wins ?? 0, losses: r.settings?.losses ?? 0,
                fpts: r.settings?.fpts ?? 0 },
  })),
  // A prior completed season's matchups + bracket for finances tests:
  matchups2025: null, // filled below if available
  bracket2025: bundle.brackets['2025'] ?? null,
}, null, 1));

// Sanity: keeper-flag counts must match live-verified values.
const expected = { 2021: 24, 2022: 31, 2023: 26, 2024: 26, 2025: 24 };
for (const [y, n] of Object.entries(expected)) {
  const got = seasons[y].picks.filter(p => p.is_keeper).length;
  if (got !== n) throw new Error(`Fixture sanity failed: ${y} keeper count ${got} !== ${n}`);
}
console.log('Fixtures written. Keeper counts verified:', expected);
```

Note: `matchups2025`/`bracket2025` — the 2025 league's matchups aren't in the current bundle (matchups are only pulled for the current season). The finances tests in Task 8 use **hand-written minimal matchup fixtures** instead; `bracket2025` comes from the chain pull only if present, and Task 8's tests do not depend on it.

- [ ] **Step 2: Run the real pull**

Run (in `dd-tools/`): `node -e "import('./lib/sleeper.js').then(async m => { const cfg = JSON.parse(await import('node:fs/promises').then(f=>f.readFile('config.json','utf8'))); await m.pull(cfg, 'data'); console.log('pulled'); })"`
Expected: `pulled`; `data/bundle.json` and `data/players.json` exist. (~30 API calls, well under Sleeper's ~1000/min limit.)

- [ ] **Step 3: Generate fixtures**

Run: `node scripts/make-fixtures.js`
Expected: `Fixtures written. Keeper counts verified: { '2021': 24, '2022': 31, '2023': 26, '2024': 26, '2025': 24 }`

If a count mismatches, STOP — the live data changed or the trim is wrong. Investigate before committing anything.

- [ ] **Step 4: Create empty allowlist**

`test/fixtures/allowlist.json`:

```json
{ "_comment": "Historical keeper rounds were computed by hand. Entries here are accepted engine-vs-history divergences, keyed 'year:player name', each with a reason.", "entries": {} }
```

- [ ] **Step 5: Commit**

```bash
git add scripts/make-fixtures.js test/fixtures/
git commit -m "feat: fixture snapshot script + real-data fixtures"
```

---

### Task 4: Engine — keeper history (`keeperHistory`)

`lib/keepers.js` is browser-safe: **zero imports**, pure functions only. Built across Tasks 4–7.

**Files:**
- Create: `lib/keepers.js`
- Test: `test/keepers-history.test.js`

- [ ] **Step 1: Write the failing tests**

`test/keepers-history.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keeperHistory } from '../lib/keepers.js';

// seasonsDesc: most-recent-first, engine-shaped picks
const S = (year, picks) => ({ year, picks });
const P = (playerId, round, isKeeper = false) => ({ playerId, round, isKeeper });

test('undrafted player: FA basis, zero years kept', () => {
  const h = keeperHistory('x', [S(2025, [P('other', 3)])]);
  assert.deepEqual(h, { yearsKept: 0, basisRound: 'FA', lastPickWasKeeper: false });
});

test('drafted last year, not kept: basis = round, zero years', () => {
  const h = keeperHistory('x', [S(2025, [P('x', 7)]), S(2024, [P('x', 9, true)])]);
  assert.deepEqual(h, { yearsKept: 0, basisRound: 7, lastPickWasKeeper: false });
});

test('kept two consecutive years', () => {
  const h = keeperHistory('x', [
    S(2025, [P('x', 4, true)]),
    S(2024, [P('x', 8, true)]),
    S(2023, [P('x', 9)]),        // real draft pick — chain stops here
  ]);
  assert.deepEqual(h, { yearsKept: 2, basisRound: 4, lastPickWasKeeper: true });
});

test('gap year breaks the consecutive chain', () => {
  const h = keeperHistory('x', [
    S(2025, [P('x', 4, true)]),
    S(2024, []),                  // not in 2024 draft at all
    S(2023, [P('x', 9, true)]),
  ]);
  assert.deepEqual(h, { yearsKept: 1, basisRound: 4, lastPickWasKeeper: true });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/keepers-history.test.js`
Expected: FAIL — `Cannot find module '../lib/keepers.js'`

- [ ] **Step 3: Implement keeperHistory in lib/keepers.js**

```js
// Dirty Dozen keeper rules engine.
// Pure functions, ZERO imports — shared byte-for-byte by the CLI and the web page.

export const KEEP_OFFSETS = [1, 4, 8];   // cost offsets for 1st, 2nd, 3rd consecutive keep
export const FA_FIRST_KEEP_ROUND = 10;   // undrafted pickups slot here on their first keep
export const MAX_CONSECUTIVE_KEEPS = 3;
export const BANNED_DRAFT_ROUNDS = 2;    // genuinely *drafted* in R1-R2 => can't be kept

function picksByPlayer(season) {
  if (!season._byPlayer) {
    season._byPlayer = new Map(season.picks.map(p => [p.playerId, p]));
  }
  return season._byPlayer;
}

// seasonsDesc: [{ year, picks: [{playerId, round, isKeeper}] }] most-recent-first.
export function keeperHistory(playerId, seasonsDesc) {
  let yearsKept = 0;
  for (const s of seasonsDesc) {
    const p = picksByPlayer(s).get(playerId);
    if (p && p.isKeeper) yearsKept++;
    else break;
  }
  const last = seasonsDesc.length ? picksByPlayer(seasonsDesc[0]).get(playerId) : undefined;
  return {
    yearsKept,
    basisRound: last ? last.round : 'FA',
    lastPickWasKeeper: Boolean(last && last.isKeeper),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/keepers-history.test.js`
Expected: 4 pass.

- [ ] **Step 5: Commit**

```bash
git add lib/keepers.js test/keepers-history.test.js
git commit -m "feat: keeper history walker (consecutive is_keeper chain)"
```

---

### Task 5: Engine — cost & eligibility (`nominalCost`, `evaluatePlayer`)

**Files:**
- Modify: `lib/keepers.js` (append)
- Test: `test/keepers-eligibility.test.js`

- [ ] **Step 1: Write the failing tests**

`test/keepers-eligibility.test.js` — every case is straight from the rules sheet:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nominalCost, evaluatePlayer } from '../lib/keepers.js';

const S = (year, picks) => ({ year, picks });
const P = (playerId, round, isKeeper = false) => ({ playerId, round, isKeeper });

test('cost track from rules example: drafted R12 -> 11 -> 7 -> 1', () => {
  assert.equal(nominalCost(12, 1), 11);  // 12 - 1
  assert.equal(nominalCost(11, 2), 7);   // 11 - 4
  assert.equal(nominalCost(7, 3), 1);    // 7 - 8 floors at 1
});

test('FA track: 10 flat first keep (no -1), then 6, then 1', () => {
  assert.equal(nominalCost('FA', 1), 10);
  assert.equal(nominalCost(10, 2), 6);
  assert.equal(nominalCost(6, 3), 1);
});

test('verified real case J. Williams: 13 -> 12 -> 8', () => {
  assert.equal(nominalCost(13, 1), 12);
  assert.equal(nominalCost(12, 2), 8);
});

test('R1/R2 draftees are ineligible', () => {
  const ev = evaluatePlayer('x', [S(2025, [P('x', 1)])]);
  assert.equal(ev.eligible, false);
  assert.match(ev.reason, /round 1/);
});

test('R1/R2 keeper-slot is NOT banned (3rd-year keep landing at R2)', () => {
  const ev = evaluatePlayer('x', [
    S(2025, [P('x', 2, true)]),   // occupied R2 as a keeper slot
    S(2024, [P('x', 3)]),
  ]);
  assert.equal(ev.eligible, true);
  assert.equal(ev.costRound, 1);  // 2 - 4 floors to 1 (2nd consecutive keep)
});

test('3 consecutive keeps exhausts eligibility', () => {
  const ev = evaluatePlayer('x', [
    S(2025, [P('x', 1, true)]),
    S(2024, [P('x', 6, true)]),
    S(2023, [P('x', 10, true)]),
    S(2022, [P('x', 11)]),
  ]);
  assert.equal(ev.eligible, false);
  assert.match(ev.reason, /3 consecutive/);
});

test('basisOverrides pin a nominal round (collision-bumped history)', () => {
  const ev = evaluatePlayer('x', [S(2025, [P('x', 9, true)]), S(2024, [P('x', 99)])]);
  // actual draft said 9 (bumped), but nominal was 10:
  const fixed = evaluatePlayer('x', [S(2025, [P('x', 9, true)]), S(2024, [P('x', 99)])],
                               { x: { basisRound: 10 } });
  assert.equal(ev.costRound, 5);    // 9 - 4 (2nd keep... yearsKept=1, keepNumber=2)
  assert.equal(fixed.costRound, 6); // 10 - 4
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/keepers-eligibility.test.js`
Expected: FAIL — `nominalCost` not exported.

- [ ] **Step 3: Append to lib/keepers.js**

```js
export function nominalCost(basisRound, keepNumber) {
  if (basisRound === 'FA') return FA_FIRST_KEEP_ROUND; // only reachable as keepNumber 1
  return Math.max(1, basisRound - KEEP_OFFSETS[keepNumber - 1]);
}

export function evaluatePlayer(playerId, seasonsDesc, overrides = {}) {
  const h = keeperHistory(playerId, seasonsDesc);
  const ov = overrides[playerId];
  if (ov && ov.basisRound != null) h.basisRound = ov.basisRound;
  const keepNumber = h.yearsKept + 1;
  if (h.yearsKept >= MAX_CONSECUTIVE_KEEPS) {
    return { ...h, eligible: false, costRound: null,
             reason: `kept ${MAX_CONSECUTIVE_KEEPS} consecutive seasons — must re-enter draft` };
  }
  if (h.basisRound !== 'FA' && h.basisRound <= BANNED_DRAFT_ROUNDS && !h.lastPickWasKeeper) {
    return { ...h, eligible: false, costRound: null,
             reason: `drafted in round ${h.basisRound} last year` };
  }
  return { ...h, eligible: true, reason: null, costRound: nominalCost(h.basisRound, keepNumber) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/keepers-eligibility.test.js`
Expected: 7 pass.

- [ ] **Step 5: Commit**

```bash
git add lib/keepers.js test/keepers-eligibility.test.js
git commit -m "feat: keeper cost and eligibility rules"
```

---

### Task 6: Engine — slot resolution (`resolveKeeperSlots`)

**Files:**
- Modify: `lib/keepers.js` (append)
- Test: `test/keepers-resolve.test.js`

- [ ] **Step 1: Write the failing tests**

`test/keepers-resolve.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveKeeperSlots } from '../lib/keepers.js';

const ALL = Array.from({ length: 15 }, (_, i) => i + 1);
const K = (name, costRound, yearsKept = 0, basisRound = 10) =>
  ({ playerId: name, name, costRound, yearsKept, basisRound });

test('no conflicts: everyone gets their cost round', () => {
  const r = resolveKeeperSlots([K('a', 3), K('b', 10)], ALL);
  assert.deepEqual(r.map(x => [x.name, x.assignedRound, x.moved]),
                   [['a', 3, false], ['b', 10, false]]);
});

test('collision: longer-tenured keeper holds the round, other slides up (rules r19-20)', () => {
  const r = resolveKeeperSlots([K('vet', 10, 1), K('rookie', 10, 0)], ALL);
  const vet = r.find(x => x.name === 'vet');
  const rook = r.find(x => x.name === 'rookie');
  assert.equal(vet.assignedRound, 10);
  assert.equal(rook.assignedRound, 9); // "next highest available round"
  assert.equal(rook.moved, true);
});

test('traded-away round: keeper slides up (rules r17-18 example: cost 5, 5th traded -> 4th)', () => {
  const owned = ALL.filter(x => x !== 5);
  const r = resolveKeeperSlots([K('a', 5)], owned);
  assert.equal(r[0].assignedRound, 4);
});

test('floor collision at round 1 pushes the junior keeper downstream (rule r14)', () => {
  const r = resolveKeeperSlots([K('vet', 1, 2, 5), K('kid', 1, 1, 5)], ALL);
  const vet = r.find(x => x.name === 'vet');
  const kid = r.find(x => x.name === 'kid');
  assert.equal(vet.assignedRound, 1);
  assert.equal(kid.assignedRound, 2); // nowhere above round 1 — pushed down
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/keepers-resolve.test.js`
Expected: FAIL — `resolveKeeperSlots` not exported.

- [ ] **Step 3: Append to lib/keepers.js**

```js
// Resolve final draft-slot assignments for one team's chosen keeper set (<= 3).
// keepers: [{playerId, name, costRound, yearsKept, basisRound}]
// ownedRounds: rounds where the team still holds its own original pick.
// Seniority (more years kept, then earlier basis, then name) holds its round;
// juniors slide up (r17-r20); if blocked all the way past round 1, push down (r14).
export function resolveKeeperSlots(keepers, ownedRounds) {
  const owned = new Set(ownedRounds);
  const num = (b) => (b === 'FA' ? 99 : b);
  const seniority = (a, b) =>
    (b.yearsKept - a.yearsKept) || (num(a.basisRound) - num(b.basisRound)) ||
    String(a.name).localeCompare(String(b.name));
  const taken = new Set();
  const out = [];
  for (const k of [...keepers].sort(seniority)) {
    let r = k.costRound;
    while (r >= 1 && (!owned.has(r) || taken.has(r))) r--;
    if (r < 1) {
      r = 1;
      while (taken.has(r) || !owned.has(r)) r++;
    }
    taken.add(r);
    out.push({ ...k, assignedRound: r, moved: r !== k.costRound });
  }
  return out.sort((a, b) => a.assignedRound - b.assignedRound);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/keepers-resolve.test.js`
Expected: 4 pass.

- [ ] **Step 5: Commit**

```bash
git add lib/keepers.js test/keepers-resolve.test.js
git commit -m "feat: keeper slot resolution (collisions, traded picks, floor push-down)"
```

---

### Task 7: Engine — full board (`computeKeeperBoard`)

**Files:**
- Modify: `lib/keepers.js` (append)
- Test: `test/keepers-board.test.js`

- [ ] **Step 1: Write the failing tests**

`test/keepers-board.test.js` — synthetic unit test plus a fixture smoke test:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { computeKeeperBoard } from '../lib/keepers.js';

test('board groups players by team with eligibility and owned rounds', () => {
  const board = computeKeeperBoard({
    seasons: [{ year: 2025, picks: [
      { player_id: 'p1', round: 7, is_keeper: false },
      { player_id: 'p2', round: 1, is_keeper: false },
    ] }],
    rosters: [{ roster_id: 1, owner_id: 'u1', players: ['p1', 'p2', 'p3'] }],
    users: [{ user_id: 'u1', display_name: 'mitch', metadata: { team_name: 'Team M' } }],
    tradedPicks: [{ season: '2026', round: 6, roster_id: 1, owner_id: 2 }],
    upcomingSeason: '2026',
    rounds: 15,
    playerNames: { p1: { name: 'Player One', position: 'RB' },
                   p2: { name: 'Player Two', position: 'WR' },
                   p3: { name: 'Player Three', position: 'TE' } },
  });
  assert.equal(board.teams.length, 1);
  const t = board.teams[0];
  assert.equal(t.ownerName, 'mitch');
  assert.deepEqual(t.ownedRounds.includes(6), false); // traded away
  const p1 = t.players.find(p => p.playerId === 'p1');
  const p2 = t.players.find(p => p.playerId === 'p2');
  const p3 = t.players.find(p => p.playerId === 'p3');
  assert.equal(p1.costRound, 6);            // 7 - 1
  assert.equal(p2.eligible, false);          // R1 draftee
  assert.equal(p3.costRound, 10);            // FA
  assert.equal(p3.basisRound, 'FA');
});

test('fixture smoke: 2026 board has 12 teams, all rostered players evaluated', async () => {
  const seasons = JSON.parse(await fs.readFile('test/fixtures/seasons.json', 'utf8'));
  const current = JSON.parse(await fs.readFile('test/fixtures/current.json', 'utf8'));
  const seasonsArr = Object.entries(seasons)
    .map(([year, s]) => ({ year: Number(year), picks: s.picks }))
    .sort((a, b) => b.year - a.year);
  const board = computeKeeperBoard({
    seasons: seasonsArr,
    rosters: current.rosters,
    users: current.users,
    tradedPicks: seasons['2026']?.tradedPicks ?? [],
    upcomingSeason: '2026',
    rounds: 15,
    playerNames: {},
  });
  assert.equal(board.teams.length, 12);
  for (const t of board.teams) {
    assert.ok(t.players.length > 0, `${t.ownerName} has players`);
    for (const p of t.players) {
      assert.ok(p.eligible === true || typeof p.reason === 'string');
    }
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/keepers-board.test.js`
Expected: FAIL — `computeKeeperBoard` not exported.

- [ ] **Step 3: Append to lib/keepers.js**

```js
// Raw Sleeper shapes in, per-team keeper board out.
// seasons: [{year, picks: [raw sleeper picks]}] any order (sorted DESC internally).
export function computeKeeperBoard({ seasons, rosters, users, tradedPicks = [],
                                     upcomingSeason, rounds = 15, overrides = {},
                                     playerNames = {} }) {
  const seasonsDesc = [...seasons]
    .sort((a, b) => b.year - a.year)
    .map(s => ({
      year: s.year,
      picks: s.picks.map(p => ({
        playerId: p.player_id, round: p.round, isKeeper: p.is_keeper === true,
      })),
    }));
  const userById = new Map(users.map(u => [u.user_id, u]));
  const teams = rosters.map(r => {
    const tradedAway = new Set(
      tradedPicks
        .filter(t => String(t.season) === String(upcomingSeason)
                     && t.roster_id === r.roster_id && t.owner_id !== r.roster_id)
        .map(t => t.round),
    );
    const ownedRounds = [];
    for (let i = 1; i <= rounds; i++) if (!tradedAway.has(i)) ownedRounds.push(i);
    const owner = userById.get(r.owner_id);
    const players = (r.players ?? []).map(pid => {
      const ev = evaluatePlayer(pid, seasonsDesc, overrides);
      const meta = playerNames[pid] ?? {};
      return { playerId: pid, name: meta.name ?? pid, position: meta.position ?? '', ...ev };
    }).sort((a, b) => ((a.costRound ?? 99) - (b.costRound ?? 99))
                      || String(a.name).localeCompare(String(b.name)));
    return {
      rosterId: r.roster_id,
      ownerId: r.owner_id,
      ownerName: owner ? owner.display_name : `roster ${r.roster_id}`,
      teamName: owner && owner.metadata ? (owner.metadata.team_name ?? '') : '',
      ownedRounds,
      players,
    };
  });
  return { upcomingSeason, teams };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/keepers-board.test.js`
Expected: 2 pass.

- [ ] **Step 5: Run the whole suite, then commit**

Run: `npm test`
Expected: all tests across all files pass.

```bash
git add lib/keepers.js test/keepers-board.test.js
git commit -m "feat: full keeper board from raw Sleeper shapes"
```

---

### Task 8: Regression — engine vs 4 years of real history

The user has warned: historical rounds were computed **by hand** — divergences may be human error. Mismatches get classified, not blindly "fixed."

**Files:**
- Create: `test/regression.test.js`
- Modify: `test/fixtures/allowlist.json` (populated during triage)

- [ ] **Step 1: Write the regression test**

`test/regression.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { evaluatePlayer, resolveKeeperSlots } from '../lib/keepers.js';

const seasons = JSON.parse(await fs.readFile('test/fixtures/seasons.json', 'utf8'));
const allow = JSON.parse(await fs.readFile('test/fixtures/allowlist.json', 'utf8')).entries;

const engineSeasons = (upToYear) =>
  Object.entries(seasons)
    .map(([year, s]) => ({ year: Number(year), picks: s.picks.map(p => ({
      playerId: p.player_id, round: p.round, isKeeper: p.is_keeper,
    })) }))
    .filter(s => s.year <= upToYear)
    .sort((a, b) => b.year - a.year);

for (const [prior, next] of [[2021, 2022], [2022, 2023], [2023, 2024], [2024, 2025]]) {
  test(`engine(${prior} data) reproduces actual ${next} keeper rounds`, () => {
    const hist = engineSeasons(prior);
    const nextSeason = seasons[String(next)];
    const actualKeepers = nextSeason.picks.filter(p => p.is_keeper);
    const byTeam = new Map();
    for (const p of actualKeepers) {
      if (!byTeam.has(p.roster_id)) byTeam.set(p.roster_id, []);
      byTeam.get(p.roster_id).push(p);
    }
    const mismatches = [];
    for (const [rosterId, kept] of byTeam) {
      const tradedAway = new Set(
        (nextSeason.tradedPicks ?? [])
          .filter(t => String(t.season) === String(next)
                       && t.roster_id === rosterId && t.owner_id !== rosterId)
          .map(t => t.round));
      const owned = [];
      for (let i = 1; i <= 15; i++) if (!tradedAway.has(i)) owned.push(i);
      const evaluated = kept.map(p => {
        const ev = evaluatePlayer(p.player_id, hist);
        return { playerId: p.player_id, name: p.name, costRound: ev.costRound ?? 99,
                 yearsKept: ev.yearsKept, basisRound: ev.basisRound,
                 eligible: ev.eligible, reason: ev.reason, actualRound: p.round };
      });
      for (const ev of evaluated.filter(e => !e.eligible)) {
        mismatches.push({ key: `${next}:${ev.name}`, kind: 'kept-but-engine-says-ineligible',
                          detail: ev.reason });
      }
      const resolved = resolveKeeperSlots(evaluated.filter(e => e.eligible), owned);
      for (const r of resolved) {
        const actual = evaluated.find(e => e.playerId === r.playerId).actualRound;
        if (r.assignedRound !== actual) {
          mismatches.push({ key: `${next}:${r.name}`, kind: 'round-mismatch',
                            detail: `engine=${r.assignedRound} actual=${actual} (cost=${r.costRound}, basis=${r.basisRound}, yearsKept=${r.yearsKept})` });
        }
      }
    }
    const unexplained = mismatches.filter(m => !allow[m.key]);
    assert.deepEqual(unexplained, [],
      `Unexplained divergences:\n` +
      unexplained.map(m => `  ${m.key} [${m.kind}] ${m.detail}`).join('\n') +
      `\nInvestigate each: engine bug -> fix engine; human error -> add to allowlist.json with reason.`);
  });
}
```

- [ ] **Step 2: Run and triage**

Run: `node --test test/regression.test.js`
Expected: likely FAILURES with a printed divergence list. This is the point.

For EACH divergence, in order:
1. Check the raw picks in `test/fixtures/seasons.json` for that player across years.
2. Decide: does the engine follow the rules sheet correctly for this input?
   - Engine wrong → fix `lib/keepers.js`, keeping all Task 4–7 tests green.
   - History wrong (hand-math error, commissioner discretion) → add to `allowlist.json`:
     `"2024:Isiah Pacheco": "sheet slotted R1 via floor rule; commissioner placed R2 after trade — human call"` (example shape; write what you actually find).
   - Genuinely ambiguous rule interpretation → STOP and ask the user before encoding either way.
3. Collision-bump cases (engine basis = actual bumped round, nominal differs) → add a
   `basisOverrides` entry in `config.json` **only if it affects 2026 boards**; for history,
   allowlist it with reason "collision nominal-vs-actual".

- [ ] **Step 3: Run full suite to verify everything passes**

Run: `npm test`
Expected: all pass, regression included, allowlist entries each carrying a reason string.

- [ ] **Step 4: Commit**

```bash
git add test/regression.test.js test/fixtures/allowlist.json lib/keepers.js config.json
git commit -m "test: 4-year keeper regression with triaged allowlist"
```

---

### Task 9: Finances (`lib/finances.js`)

**Files:**
- Create: `lib/finances.js`
- Test: `test/finances.test.js`

- [ ] **Step 1: Write the failing tests**

`test/finances.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weeklyWinner, finalPlaces, parseCsv, serializeCsv, buildLedger }
  from '../lib/finances.js';

test('weeklyWinner finds the top scorer', () => {
  const w = weeklyWinner([{ roster_id: 1, points: 101.5 }, { roster_id: 2, points: 133.2 },
                          { roster_id: 3, points: 99 }]);
  assert.deepEqual(w, { rosterIds: [2], points: 133.2 });
});

test('weeklyWinner returns null for unplayed weeks (all zero) and both ids on a tie', () => {
  assert.equal(weeklyWinner([{ roster_id: 1, points: 0 }, { roster_id: 2, points: 0 }]), null);
  assert.deepEqual(weeklyWinner([{ roster_id: 1, points: 100 }, { roster_id: 2, points: 100 }]),
                   { rosterIds: [1, 2], points: 100 });
  assert.equal(weeklyWinner([]), null);
  assert.equal(weeklyWinner(null), null);
});

test('finalPlaces reads the winners bracket', () => {
  const bracket = [
    { r: 1, m: 1, w: 1, l: 4 }, { r: 1, m: 2, w: 2, l: 3 },
    { r: 2, m: 3, w: 1, l: 2, p: 1 }, { r: 2, m: 4, w: 3, l: 4, p: 3 },
  ];
  assert.deepEqual(finalPlaces(bracket), { first: 1, second: 2, third: 3 });
  assert.equal(finalPlaces([]), null);
  assert.equal(finalPlaces([{ r: 1, m: 1, w: null, l: null, p: 1 }]), null); // unplayed
});

test('csv round-trips including quoted fields', () => {
  const text = 'A,B\nplain,"has, comma"\nx,y\n';
  const { header, rows } = parseCsv(text);
  assert.deepEqual(header, ['A', 'B']);
  assert.deepEqual(rows, [['plain', 'has, comma'], ['x', 'y']]);
  assert.equal(serializeCsv(header, rows), text);
});

test('buildLedger emits dues + weekly winners, preserving manual status edits', () => {
  const existing = [
    ['2026', 'Mitch', '30', 'debit', 'League Dues', '', 'paid'],      // user flipped this
    ['2026', 'Custom', '5', 'debit', 'Side Bet', '', 'pending'],      // manual row
  ];
  const rows = buildLedger({
    season: '2026',
    ledgerNames: ['Mitch', 'Thor'],
    amounts: { dues: 30, weeklyPoints: 10, places: [120, 50, 30] },
    weekWinners: { 1: ['Thor'] },
    places: null,
    existingRows: existing,
  });
  const dues = rows.filter(r => r[4] === 'League Dues');
  assert.equal(dues.length, 2);
  assert.equal(dues.find(r => r[1] === 'Mitch')[6], 'paid');     // preserved
  assert.equal(dues.find(r => r[1] === 'Thor')[6], 'pending');   // default
  const wk = rows.filter(r => r[4] === 'Weekly Points');
  assert.deepEqual(wk, [['2026', 'Thor', '10', 'credit', 'Weekly Points', 'Week1', 'pending']]);
  assert.ok(rows.some(r => r[4] === 'Side Bet'));                 // manual row kept
});

test('buildLedger adds place payouts when places provided', () => {
  const rows = buildLedger({
    season: '2026', ledgerNames: ['A', 'B', 'C', 'D'],
    amounts: { dues: 30, weeklyPoints: 10, places: [120, 50, 30] },
    weekWinners: {}, places: { first: 'B', second: 'A', third: 'D' }, existingRows: [],
  });
  const pay = rows.filter(r => r[5] === '' && r[3] === 'credit');
  assert.deepEqual(pay.map(r => [r[1], r[2], r[4]]), [
    ['B', '120', '1st Place'], ['A', '50', '2nd Place'], ['D', '30', '3rd Place'],
  ]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/finances.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement lib/finances.js**

```js
// Season ledger generation in the League Legacy Finances CSV format.
// Pure functions — file I/O happens in cli.js.

export function weeklyWinner(matchupsForWeek) {
  if (!matchupsForWeek || !matchupsForWeek.length) return null;
  let best = 0, ids = [];
  for (const m of matchupsForWeek) {
    const pts = m.points ?? 0;
    if (pts > best) { best = pts; ids = [m.roster_id]; }
    else if (pts === best && pts > 0) ids.push(m.roster_id);
  }
  return best > 0 ? { rosterIds: ids, points: best } : null;
}

export function finalPlaces(winnersBracket) {
  if (!winnersBracket || !winnersBracket.length) return null;
  const maxRound = Math.max(...winnersBracket.map(m => m.r));
  const finals = winnersBracket.find(m => m.r === maxRound && m.p === 1);
  const third = winnersBracket.find(m => m.r === maxRound && m.p === 3);
  if (!finals || finals.w == null) return null;
  return { first: finals.w, second: finals.l, third: third ? third.w : null };
}

export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return { header: rows[0] ?? [], rows: rows.slice(1) };
}

const esc = (f) => (/[",\n]/.test(f) ? `"${f.replace(/"/g, '""')}"` : f);
export function serializeCsv(header, rows) {
  return [header, ...rows].map(r => r.map(esc).join(',')).join('\n') + '\n';
}

const KEY = (r) => [r[0], r[1], r[4], r[5]].join('|'); // season|member|label|tags

// Returns full row set: computed rows (status merged from existing) + manual extras.
export function buildLedger({ season, ledgerNames, amounts, weekWinners, places, existingRows }) {
  const existingByKey = new Map(existingRows.map(r => [KEY(r), r]));
  const computed = [];
  for (const name of ledgerNames) {
    computed.push([season, name, String(amounts.dues), 'debit', 'League Dues', '', 'pending']);
  }
  for (const week of Object.keys(weekWinners).map(Number).sort((a, b) => a - b)) {
    for (const name of weekWinners[week]) {
      computed.push([season, name, String(amounts.weeklyPoints), 'credit',
                     'Weekly Points', `Week${week}`, 'pending']);
    }
  }
  if (places) {
    const labels = ['1st Place', '2nd Place', '3rd Place'];
    [places.first, places.second, places.third].forEach((name, i) => {
      if (name) computed.push([season, name, String(amounts.places[i]), 'credit',
                               labels[i], '', 'pending']);
    });
  }
  const computedKeys = new Set(computed.map(KEY));
  for (const row of computed) {
    const prior = existingByKey.get(KEY(row));
    if (prior) row[6] = prior[6]; // preserve manually edited status
  }
  const manual = existingRows.filter(r => !computedKeys.has(KEY(r)));
  return [...computed, ...manual];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/finances.test.js`
Expected: 6 pass.

- [ ] **Step 5: Commit**

```bash
git add lib/finances.js test/finances.test.js
git commit -m "feat: finances ledger with status-preserving merge"
```

---

### Task 10: Excel writer (`lib/excel.js`)

**Files:**
- Create: `lib/excel.js`
- Test: `test/excel.test.js`

- [ ] **Step 1: Write the failing tests**

`test/excel.test.js` — builds a synthetic workbook (never touches the real one):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { writeKeeperSheet, sheetNameForSeason } from '../lib/excel.js';

test('sheetNameForSeason follows NN-NN pattern', () => {
  assert.equal(sheetNameForSeason(2026), '25-26 Keepers');
  assert.equal(sheetNameForSeason(2030), '29-30 Keepers');
});

async function makeSyntheticWorkbook(dir) {
  const wb = new ExcelJS.Workbook();
  const rules = wb.addWorksheet('Rules and payouts');
  rules.getCell('A1').value = 'Some rules text';
  const old = wb.addWorksheet('24-25 Keepers');
  old.getCell('B1').value = 'Player';
  const file = path.join(dir, 'wb.xlsx');
  await wb.xlsx.writeFile(file);
  return file;
}

const BOARD = { upcomingSeason: '2026', teams: [{
  rosterId: 1, ownerId: 'u1', ownerName: 'mitch', teamName: 'T', ownedRounds: [1],
  players: [
    { playerId: 'p1', name: 'Good Keeper', position: 'RB', basisRound: 7, yearsKept: 0,
      eligible: true, reason: null, costRound: 6 },
    { playerId: 'p2', name: 'First Rounder', position: 'WR', basisRound: 1, yearsKept: 0,
      eligible: false, reason: 'drafted in round 1 last year', costRound: null },
  ],
}] };

test('writeKeeperSheet adds the sheet, backs up first, preserves other sheets', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ddxl-'));
  const file = await makeSyntheticWorkbook(dir);
  await writeKeeperSheet({
    workbookPath: file, season: 2026, board: BOARD,
    prevSeasonPicks: { p1: { round: 7 }, p2: { round: 1 } },
    prevPrevSeasonPicks: { p1: { round: 9 } },
    weeks: 14, weekWinnerNames: { 1: ['Thor'] },
    ledgerNames: ['mitch', 'Thor'], draftOrder: null,
    amounts: { places: [120, 50, 30] },
  });
  const backups = (await fs.readdir(dir)).filter(f => f.includes('backup'));
  assert.equal(backups.length, 1);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  assert.ok(wb.getWorksheet('Rules and payouts'), 'existing sheet survived');
  assert.equal(wb.getWorksheet('Rules and payouts').getCell('A1').value, 'Some rules text');
  const sheet = wb.getWorksheet('25-26 Keepers');
  assert.ok(sheet, 'new sheet exists');
  assert.equal(sheet.getCell('A2').value, 'mitch');       // owner label on first player row
  assert.equal(sheet.getCell('B2').value, 'Good Keeper');
  assert.equal(sheet.getCell('C2').value, 9);              // 2024 round
  assert.equal(sheet.getCell('D2').value, 7);              // 2025 round
  assert.equal(sheet.getCell('E2').value, 6);              // 2026 cost
  assert.equal(sheet.getCell('E3').value, 'N/A');          // ineligible
  assert.equal(sheet.getCell('J3').value, 'Thor');         // week 1 winner
});

test('rerunning replaces the sheet idempotently', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ddxl-'));
  const file = await makeSyntheticWorkbook(dir);
  const args = { workbookPath: file, season: 2026, board: BOARD,
    prevSeasonPicks: {}, prevPrevSeasonPicks: {}, weeks: 14, weekWinnerNames: {},
    ledgerNames: ['mitch'], draftOrder: null, amounts: { places: [120, 50, 30] } };
  await writeKeeperSheet(args);
  await writeKeeperSheet(args);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const matches = wb.worksheets.filter(w => w.name === '25-26 Keepers');
  assert.equal(matches.length, 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/excel.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement lib/excel.js**

```js
// Writes the season keeper sheet into the real workbook, mirroring the historical layout.
// Always backs up first. Only the target sheet is added/replaced.
import fs from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';

export function sheetNameForSeason(season) {
  const a = String((season - 1) % 100).padStart(2, '0');
  const b = String(season % 100).padStart(2, '0');
  return `${a}-${b} Keepers`;
}

export async function writeKeeperSheet({ workbookPath, season, board,
                                         prevSeasonPicks, prevPrevSeasonPicks,
                                         weeks, weekWinnerNames, ledgerNames,
                                         draftOrder, amounts }) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const ext = path.extname(workbookPath);
  const backupPath = workbookPath.replace(ext, `.backup-${stamp}${ext}`);
  await fs.copyFile(workbookPath, backupPath);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(workbookPath);
  const name = sheetNameForSeason(season);
  const existing = wb.getWorksheet(name);
  if (existing) wb.removeWorksheet(existing.id);
  const ws = wb.addWorksheet(name);

  // Header row mirrors the historical sheets.
  ws.getCell('B1').value = 'Player';
  ws.getCell('C1').value = `${season - 2} Draft`;
  ws.getCell('D1').value = `${season - 1} Draft`;
  ws.getCell('E1').value = `${season} Draft`;
  ws.getCell('I1').value = 'Weekly Points Winners';

  // Owner blocks: owner label in column A on their first player row.
  let row = 2;
  for (const team of board.teams) {
    ws.getCell(`A${row}`).value = team.ownerName;
    for (const p of team.players) {
      ws.getCell(`B${row}`).value = p.name;
      const pp = prevPrevSeasonPicks[p.playerId];
      if (pp) ws.getCell(`C${row}`).value = pp.round;
      const prev = prevSeasonPicks[p.playerId];
      ws.getCell(`D${row}`).value = prev ? prev.round : 'FA';
      ws.getCell(`E${row}`).value = p.eligible ? p.costRound : 'N/A';
      if (!p.eligible) ws.getCell(`F${row}`).value = p.reason;
      row++;
    }
    row++; // blank spacer between owner blocks
  }

  // Weekly winners block (I=week, J=winner, L=name, M=COUNTIF tally) — same as 24-25 sheet.
  ws.getCell('I2').value = 'Week';
  ws.getCell('J2').value = 'Winner';
  const firstWeekRow = 3;
  for (let w = 1; w <= weeks; w++) {
    ws.getCell(`I${firstWeekRow + w - 1}`).value = w;
    const winners = weekWinnerNames[w];
    if (winners && winners.length) {
      ws.getCell(`J${firstWeekRow + w - 1}`).value = winners.join(' / ');
    }
  }
  const lastWeekRow = firstWeekRow + weeks - 1;
  ledgerNames.forEach((n, i) => {
    const r = firstWeekRow + i;
    ws.getCell(`L${r}`).value = n;
    ws.getCell(`M${r}`).value =
      { formula: `COUNTIF(J${firstWeekRow}:J${lastWeekRow},L${r})`, result: 0 };
  });
  const sumRow = firstWeekRow + ledgerNames.length;
  ws.getCell(`M${sumRow}`).value =
    { formula: `SUM(M${firstWeekRow}:M${sumRow - 1})`, result: 0 };

  // Overall winners + draft order blocks.
  let r2 = lastWeekRow + 3;
  ws.getCell(`I${r2}`).value = 'Overall Winners';
  ws.getCell(`L${r2}`).value = `${season} Draft Order`;
  const placeLabels = amounts.places.map((amt, i) => `${i + 1} - $${amt}`);
  for (let i = 0; i < board.teams.length; i++) {
    const rr = r2 + 1 + i;
    ws.getCell(`I${rr}`).value = placeLabels[i] ?? String(i + 1);
    ws.getCell(`L${rr}`).value = i + 1;
    if (draftOrder) {
      const entry = Object.entries(draftOrder).find(([, slot]) => slot === i + 1);
      ws.getCell(`M${rr}`).value = entry ? entry[0] : 'TBD';
    } else {
      ws.getCell(`M${rr}`).value = 'TBD';
    }
  }
  const tail = r2 + 1 + board.teams.length + 1;
  ws.getCell(`I${tail}`).value = 'Loser:';
  ws.getCell(`I${tail + 1}`).value = 'Punishment:';

  const tmp = workbookPath.replace(ext, `.tmp${ext}`);
  await wb.xlsx.writeFile(tmp);
  await fs.rename(tmp, workbookPath);
  return { sheetName: name, backupPath };
}
```

Note: `draftOrder` maps Sleeper `user_id` → slot; cli.js translates user_ids to ledger names before calling (see Task 11), so tests here pass `null` or pre-translated names.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/excel.test.js`
Expected: 3 pass.

- [ ] **Step 5: Commit**

```bash
git add lib/excel.js test/excel.test.js
git commit -m "feat: keeper sheet writer with backup and idempotent rewrite"
```

---

### Task 11: CLI wiring (`cli.js`) + real-workbook run + config confirmation

**Files:**
- Create: `cli.js`

- [ ] **Step 1: Implement cli.js**

```js
// Dirty Dozen CLI: node cli.js pull | keepers | finances [--season YYYY]
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pull, loadBundle, loadPlayers } from './lib/sleeper.js';
import { computeKeeperBoard } from './lib/keepers.js';
import { weeklyWinner, finalPlaces, parseCsv, serializeCsv, buildLedger }
  from './lib/finances.js';
import { writeKeeperSheet, sheetNameForSeason } from './lib/excel.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(root, 'data');
const config = JSON.parse(await fs.readFile(path.join(root, 'config.json'), 'utf8'));
const [cmd, ...rest] = process.argv.slice(2);
const seasonFlag = rest.includes('--season') ? Number(rest[rest.indexOf('--season') + 1]) : null;

const ledgerNameByUserId = (users) => {
  const byUsername = new Map(config.owners.map(o => [o.sleeperUsername.toLowerCase(), o.ledgerName]));
  const map = new Map();
  for (const u of users) {
    map.set(u.user_id, byUsername.get(u.display_name.toLowerCase()) ?? u.display_name);
  }
  return map;
};

function boardInputs(bundle, players) {
  const current = bundle.chain[0];
  const season = seasonFlag ?? Number(current.season);
  const seasons = Object.entries(bundle.picks)
    .filter(([y]) => Number(y) < season)
    .map(([year, picks]) => ({ year: Number(year), picks: picks ?? [] }));
  const playerNames = {};
  for (const r of bundle.rosters[current.season] ?? []) {
    for (const pid of r.players ?? []) {
      const p = players[pid];
      playerNames[pid] = p
        ? { name: `${p.first_name} ${p.last_name}`, position: p.position ?? '' }
        : { name: pid, position: '' };
    }
  }
  return { season, current, seasons, playerNames };
}

async function cmdKeepers() {
  const bundle = await loadBundle(dataDir);
  const players = await loadPlayers(dataDir);
  const { season, current, seasons, playerNames } = boardInputs(bundle, players);
  const board = computeKeeperBoard({
    seasons,
    rosters: bundle.rosters[current.season],
    users: bundle.users[current.season],
    tradedPicks: bundle.tradedPicks[current.season] ?? [],
    upcomingSeason: String(season),
    rounds: config.rounds,
    overrides: config.basisOverrides,
    playerNames,
  });
  const nameById = ledgerNameByUserId(bundle.users[current.season]);
  for (const t of board.teams) t.ownerName = nameById.get(t.ownerId) ?? t.ownerName;

  const idx = (year) => Object.fromEntries(
    (bundle.picks[String(year)] ?? []).map(p => [p.player_id, { round: p.round }]));
  const rosterOwner = new Map(
    (bundle.rosters[current.season] ?? []).map(r => [r.roster_id, r.owner_id]));
  const weeks = (current.settings?.playoff_week_start ?? 15) - 1;
  const weekWinnerNames = {};
  for (let w = 1; w <= weeks; w++) {
    const win = weeklyWinner(bundle.matchups[w]);
    if (win) weekWinnerNames[w] =
      win.rosterIds.map(rid => nameById.get(rosterOwner.get(rid)) ?? `roster ${rid}`);
  }
  let draftOrder = null;
  if (bundle.drafts[current.season]?.draft_order) {
    draftOrder = {};
    for (const [uid, slot] of Object.entries(bundle.drafts[current.season].draft_order)) {
      draftOrder[nameById.get(uid) ?? uid] = slot;
    }
  }
  const workbookPath = path.resolve(root, config.workbookPath);
  try {
    const { sheetName, backupPath } = await writeKeeperSheet({
      workbookPath, season, board,
      prevSeasonPicks: idx(season - 1), prevPrevSeasonPicks: idx(season - 2),
      weeks, weekWinnerNames,
      ledgerNames: config.owners.map(o => o.ledgerName),
      draftOrder, amounts: config.amounts,
    });
    console.log(`Wrote sheet "${sheetName}" to ${workbookPath}`);
    console.log(`Backup: ${backupPath}`);
  } catch (err) {
    if (err.code === 'EBUSY' || /used by another process/i.test(err.message)) {
      console.error('The workbook is open in Excel. Close it and retry.');
      process.exit(1);
    }
    throw err;
  }
  for (const t of board.teams) {
    const elig = t.players.filter(p => p.eligible);
    console.log(`${t.ownerName}: ${elig.length} eligible keepers` +
      (elig.length ? ` (best: ${elig.slice(0, 3).map(p => `${p.name} R${p.costRound}`).join(', ')})` : ''));
  }
}

async function cmdFinances() {
  const bundle = await loadBundle(dataDir);
  const current = bundle.chain[0];
  const season = String(seasonFlag ?? current.season);
  const nameById = ledgerNameByUserId(bundle.users[current.season]);
  const rosterOwner = new Map(
    (bundle.rosters[current.season] ?? []).map(r => [r.roster_id, r.owner_id]));
  const toName = (rid) => nameById.get(rosterOwner.get(rid)) ?? `roster ${rid}`;
  const weeks = (current.settings?.playoff_week_start ?? 15) - 1;
  const weekWinners = {};
  for (let w = 1; w <= weeks; w++) {
    const win = weeklyWinner(bundle.matchups[w]);
    if (win) weekWinners[w] = win.rosterIds.map(toName);
  }
  const bracketPlaces = finalPlaces(bundle.brackets[current.season]);
  const places = bracketPlaces && {
    first: toName(bracketPlaces.first), second: toName(bracketPlaces.second),
    third: bracketPlaces.third != null ? toName(bracketPlaces.third) : null,
  };
  const outPath = path.resolve(root, config.financesDir, `finances-${season}.csv`);
  let existingRows = [];
  let header = ['Season Name (2022 for nfl/mlb or 2022-23 for nba/nhl)', 'Member Name',
                'Amount', 'Type (debit/credit)', 'Label', 'Tags (comma seperated)',
                'Status (paid/pending/past-due)'];
  try {
    const prior = parseCsv(await fs.readFile(outPath, 'utf8'));
    header = prior.header;
    existingRows = prior.rows;
  } catch { /* first run */ }
  const rows = buildLedger({
    season, ledgerNames: config.owners.map(o => o.ledgerName),
    amounts: config.amounts, weekWinners, places, existingRows,
  });
  await fs.writeFile(outPath, serializeCsv(header, rows));
  console.log(`Wrote ${rows.length} rows to ${outPath}`);
}

if (cmd === 'pull') {
  const bundle = await pull(config, dataDir);
  console.log(`Pulled ${bundle.chain.length} seasons (current: ${bundle.chain[0].season}).`);
} else if (cmd === 'keepers') {
  await cmdKeepers();
} else if (cmd === 'finances') {
  await cmdFinances();
} else {
  console.log('Usage: node cli.js pull | keepers [--season YYYY] | finances [--season YYYY]');
  process.exit(cmd ? 1 : 0);
}
```

- [ ] **Step 2: Verify pull + keepers end-to-end**

Ask the user to close the workbook in Excel first if it's open.

Run: `node cli.js pull` → expected: `Pulled 7 seasons (current: 2026).`
Run: `node cli.js keepers` → expected: `Wrote sheet "25-26 Keepers" ...`, `Backup: ...`, then 12 owner summary lines.

Then verify the workbook: reopen it (or dump with a reader script) and check the new sheet exists, existing sheets intact, spot-check 3 players' cost rounds against hand calculation. Confirm the backup file exists next to the workbook.

- [ ] **Step 3: Read current amounts from the Rules sheet + confirm config with user**

The user updated dues/payout amounts in the workbook. Read the `Rules and payouts` sheet (values near rows 24–27 historically), compare against `config.json` amounts, and update config to match. Then confirm with the user (one AskUserQuestion covering both):
1. The dues/weekly/place amounts now in config.
2. The 12 sleeperUsername→ledgerName mappings (guesses from Task 1).
3. Whether the finances "Member Name" column should use these stable first names or each season's Sleeper team names (the 2024 ledger used team names like "Mike Oxmaul" — historical rows suggest team names, but first names are stable; user decides).

If the user picks team names: change `cmdFinances`/`cmdKeepers` ledger-name resolution to use `users[].metadata.team_name` (fall back to display_name), and update the Task 9 tests' expectations accordingly.

- [ ] **Step 4: Run finances end-to-end**

Run: `node cli.js finances`
Expected: `Wrote 12 rows to ...finances-2026.csv` (12 dues rows; no weeks played yet in 2026). Open the CSV, verify format matches `League Legacy Finances.csv` exactly (same header, same column order).

- [ ] **Step 5: Full test suite + commit**

Run: `npm test` → all pass.

```bash
git add cli.js config.json
git commit -m "feat: CLI wiring for pull/keepers/finances"
```

---### Task 12: Live league page (`index.html`)

**Files:**
- Create: `index.html`, `scripts/serve.js`, `.claude/launch.json` (for preview), `.nojekyll`

- [ ] **Step 1: Write scripts/serve.js**

```js
// Minimal static server for local preview of the live page.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
               '.css': 'text/css' };
http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  const file = path.join(root, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'content-type': mime[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(8123, () => console.log('http://localhost:8123'));
```

`.claude/launch.json`:

```json
{
  "version": "0.0.1",
  "configurations": [
    { "name": "dd-page", "runtimeExecutable": "node", "runtimeArgs": ["scripts/serve.js"], "port": 8123 }
  ]
}
```

`.nojekyll`: empty file (disables Jekyll processing on GitHub Pages).

- [ ] **Step 2: Write index.html**

Complete page — imports the same engine the CLI uses. League ID is hardcoded (it's public):

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Dirty Dozen</title>
<style>
  :root { --bg:#f6f7f9; --card:#fff; --ink:#1a202c; --muted:#64748b; --line:#e2e8f0;
          --good:#15803d; --bad:#b91c1c; --accent:#1d4ed8; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0f172a; --card:#1e293b; --ink:#e2e8f0; --muted:#94a3b8; --line:#334155;
            --good:#4ade80; --bad:#f87171; --accent:#60a5fa; }
  }
  * { box-sizing: border-box; }
  body { margin:0; font:15px/1.45 system-ui, sans-serif; background:var(--bg); color:var(--ink); }
  header { padding:20px 16px 8px; text-align:center; }
  h1 { margin:0; font-size:1.6rem; } .sub { color:var(--muted); font-size:.9rem; }
  nav { display:flex; gap:8px; justify-content:center; padding:12px; flex-wrap:wrap;
        position:sticky; top:0; background:var(--bg); }
  nav button { border:1px solid var(--line); background:var(--card); color:var(--ink);
               padding:8px 14px; border-radius:20px; cursor:pointer; font-size:.9rem; }
  nav button.active { background:var(--accent); color:#fff; border-color:var(--accent); }
  main { max-width:1080px; margin:0 auto; padding:8px 12px 48px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:12px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px;
          padding:12px 14px; overflow-x:auto; }
  .card h2 { margin:0 0 2px; font-size:1.05rem; }
  .card .tn { color:var(--muted); font-size:.82rem; margin-bottom:8px; }
  table { border-collapse:collapse; width:100%; font-size:.85rem; }
  th { text-align:left; color:var(--muted); font-weight:600; padding:3px 8px 3px 0; }
  td { padding:3px 8px 3px 0; border-top:1px solid var(--line); white-space:nowrap; }
  .ok { color:var(--good); font-weight:600; } .no { color:var(--bad); }
  .muted { color:var(--muted); } .status { text-align:center; padding:40px; color:var(--muted); }
  section { display:none; } section.active { display:block; }
  pre.rules { white-space:pre-wrap; font:inherit; }
</style>
</head>
<body>
<header>
  <h1>The Dirty Dozen</h1>
  <div class="sub" id="subtitle">loading…</div>
</header>
<nav>
  <button data-tab="keepers" class="active">Keepers</button>
  <button data-tab="weekly">Weekly $</button>
  <button data-tab="standings">Standings</button>
  <button data-tab="rules">Rules</button>
</nav>
<main>
  <div class="status" id="status">Fetching live data from Sleeper…</div>
  <section id="keepers" class="active"><div class="grid" id="keeperGrid"></div></section>
  <section id="weekly"><div class="card" id="weeklyCard"></div></section>
  <section id="standings"><div class="card" id="standingsCard"></div></section>
  <section id="rules"><div class="card"><pre class="rules" id="rulesText"></pre></div></section>
</main>
<script type="module">
import { computeKeeperBoard } from './lib/keepers.js';

const LEAGUE_ID = '1389387813203484672';
const API = 'https://api.sleeper.app/v1';
const $ = (id) => document.getElementById(id);
const j = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(u); return r.json(); };

document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
  document.querySelectorAll('nav button').forEach(x => x.classList.toggle('active', x === b));
  document.querySelectorAll('section').forEach(s =>
    s.classList.toggle('active', s.id === b.dataset.tab));
});

async function playerNames(neededIds) {
  const KEY = 'dd_players_v1';
  try {
    const c = JSON.parse(localStorage.getItem(KEY));
    if (c && Date.now() - c.ts < 86400e3 && neededIds.every(id => c.map[id])) return c.map;
  } catch {}
  const all = await j(`${API}/players/nfl`);   // ~5 MB, then trimmed + cached
  const map = {};
  for (const id of neededIds) {
    const p = all[id];
    map[id] = p ? { name: `${p.first_name} ${p.last_name}`, position: p.position ?? '' }
                : { name: id, position: '' };
  }
  try { localStorage.setItem(KEY, JSON.stringify({ ts: Date.now(), map })); } catch {}
  return map;
}

async function load() {
  // Walk the league chain for draft history.
  const chain = [];
  let id = LEAGUE_ID;
  while (id && id !== '0') { const lg = await j(`${API}/league/${id}`); chain.push(lg); id = lg.previous_league_id; }
  const current = chain[0];
  $('subtitle').textContent = `${current.season} season — live from Sleeper`;
  const [users, rosters] = await Promise.all([
    j(`${API}/league/${current.league_id}/users`),
    j(`${API}/league/${current.league_id}/rosters`),
  ]);
  const seasons = [];
  let currentDraftOrderNames = null;
  await Promise.all(chain.map(async lg => {
    const drafts = await j(`${API}/league/${lg.league_id}/drafts`);
    if (!drafts[0]) return;
    if (lg === current && drafts[0].draft_order) currentDraftOrderNames = drafts[0].draft_order;
    if (Number(lg.season) < Number(current.season)) {
      seasons.push({ year: Number(lg.season),
                     picks: await j(`${API}/draft/${drafts[0].draft_id}/picks`) });
    }
  }));
  const tradedPicks = await j(`${API}/league/${current.league_id}/traded_picks`);
  const ids = rosters.flatMap(r => r.players ?? []);
  const names = await playerNames(ids);
  const board = computeKeeperBoard({
    seasons, rosters, users, tradedPicks,
    upcomingSeason: current.season, rounds: 15, playerNames: names,
  });
  renderKeepers(board);
  await renderWeekly(current, users, rosters);
  renderStandings(users, rosters);
  $('rulesText').textContent = RULES;
  $('status').style.display = 'none';
}

function renderKeepers(board) {
  $('keeperGrid').innerHTML = board.teams.map(t => `
    <div class="card">
      <h2>${esc(t.teamName || t.ownerName)}</h2>
      <div class="tn">@${esc(t.ownerName)}</div>
      <table>
        <tr><th>Player</th><th>Pos</th><th>Keeper cost</th><th>Yrs kept</th></tr>
        ${t.players.map(p => `
          <tr>
            <td>${esc(p.name)}</td><td class="muted">${esc(p.position)}</td>
            <td>${p.eligible ? `<span class="ok">R${p.costRound}</span>`
                             : `<span class="no" title="${esc(p.reason ?? '')}">N/A</span>`}</td>
            <td class="muted">${p.yearsKept || ''}</td>
          </tr>`).join('')}
      </table>
    </div>`).join('');
}

async function renderWeekly(current, users, rosters) {
  const userById = new Map(users.map(u => [u.user_id, u]));
  const ownerOf = new Map(rosters.map(r => [r.roster_id,
    userById.get(r.owner_id)?.display_name ?? `roster ${r.roster_id}`]));
  const lastWeek = (current.settings?.playoff_week_start ?? 15) - 1;
  const weeks = await Promise.all(Array.from({ length: lastWeek }, (_, i) =>
    j(`${API}/league/${current.league_id}/matchups/${i + 1}`).catch(() => [])));
  const tally = new Map();
  const rows = weeks.map((ms, i) => {
    let best = 0, who = [];
    for (const m of ms ?? []) {
      const pts = m.points ?? 0;
      if (pts > best) { best = pts; who = [ownerOf.get(m.roster_id)]; }
      else if (pts === best && pts > 0) who.push(ownerOf.get(m.roster_id));
    }
    if (best > 0) who.forEach(w => tally.set(w, (tally.get(w) ?? 0) + 1));
    return `<tr><td>Week ${i + 1}</td><td>${best > 0 ? esc(who.join(' / ')) : '<span class="muted">—</span>'}</td>
            <td class="muted">${best > 0 ? best.toFixed(2) : ''}</td></tr>`;
  }).join('');
  const tallyRows = [...tally.entries()].sort((a, b) => b[1] - a[1])
    .map(([n, c]) => `<tr><td>${esc(n)}</td><td>${c}</td></tr>`).join('');
  $('weeklyCard').innerHTML = `
    <h2>Weekly high scores</h2>
    <table><tr><th>Week</th><th>Winner</th><th>Points</th></tr>${rows}</table>
    ${tallyRows ? `<h2 style="margin-top:16px">Wins tally</h2>
    <table><tr><th>Owner</th><th>Weeks won</th></tr>${tallyRows}</table>` : ''}`;
}

function renderStandings(users, rosters) {
  const userById = new Map(users.map(u => [u.user_id, u]));
  const sorted = [...rosters].sort((a, b) =>
    (b.settings?.wins ?? 0) - (a.settings?.wins ?? 0) ||
    (b.settings?.fpts ?? 0) - (a.settings?.fpts ?? 0));
  $('standingsCard').innerHTML = `<h2>Standings</h2>
    <table><tr><th>#</th><th>Team</th><th>W</th><th>L</th><th>PF</th></tr>
    ${sorted.map((r, i) => {
      const u = userById.get(r.owner_id);
      return `<tr><td>${i + 1}</td><td>${esc(u?.metadata?.team_name || u?.display_name || '?')}</td>
        <td>${r.settings?.wins ?? 0}</td><td>${r.settings?.losses ?? 0}</td>
        <td class="muted">${r.settings?.fpts ?? 0}</td></tr>`;
    }).join('')}</table>`;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const RULES = `Dirty Dozen Keeper Rules

- 3 keepers max. You are not required to keep any players.
- No player drafted in the first or second round may be kept the next year.
- You may only keep a player for 3 consecutive seasons.

Keeper cost (from the round taken the previous year):
- 1st year kept: previous round - 1
- 2nd year kept: previous round - 4
- 3rd year kept: previous round - 8
- Waiver pickups: round 10, then 6, then 1.
- If the cost would be round 0 or less, the player takes the team's 1st round pick
  and pushes other picks downstream as necessary.
- If you trade the draft pick a keeper would occupy, the player moves up to the
  next available round. Two keepers in the same round: one takes the next highest
  available round (both still count at their nominal round going forward).

Draft order is chosen by managers in reverse order of last season's standings.`;

load().catch(err => { $('status').textContent = `Failed to load: ${err.message}`; });
</script>
</body>
</html>
```

- [ ] **Step 3: Preview and verify in browser**

Start the preview server (`preview_start` with config name `dd-page`, or `node scripts/serve.js`), open `http://localhost:8123`, and verify:
- 12 keeper cards render with player names (not raw IDs), costs, and N/A reasons on hover.
- Spot-check 3 players against `node cli.js keepers` output — must match exactly (same engine, must agree).
- Weekly tab shows em-dashes (2026 preseason), Standings renders 12 rows, Rules text shows.
- No console errors; check both light and dark color schemes.

- [ ] **Step 4: Commit**

```bash
git add index.html scripts/serve.js .claude/launch.json .nojekyll
git commit -m "feat: live league page sharing the keeper engine"
```

---

### Task 13: Deploy to GitHub Pages

**Files:** none (repo operations)

- [ ] **Step 1: Confirm with the user before anything goes public**

Ask (AskUserQuestion): "Ready to publish? This creates a **public** GitHub repo `dirty-dozen` under your account containing the code and the league page (no xlsx/CSV/financial data — those live outside the repo). OK to proceed? Any different repo name?"

Do NOT proceed without a yes.

- [ ] **Step 2: Create repo and push**

```bash
gh auth status
```
Expected: logged in. If not, ask the user to run `gh auth login` themselves.

```bash
git branch -M main
gh repo create dirty-dozen --public --source . --push
```
Expected: repo created, `main` pushed.

- [ ] **Step 3: Enable Pages**

```bash
gh api -X POST "repos/{owner}/dirty-dozen/pages" -f "source[branch]=main" -f "source[path]=/"
```
Expected: 201. (If 409 "already exists", fine.) Then poll:

```bash
gh api "repos/{owner}/dirty-dozen/pages" --jq .html_url
```
Expected: `https://<user>.github.io/dirty-dozen/`

- [ ] **Step 4: Verify the live site**

Open the Pages URL in the browser. Same checks as Task 12 Step 3. First deploy can take ~1–2 minutes; retry once if 404. Give the user the final URL.

---

### Task 14: README + final verification

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write README.md**

```markdown
# Dirty Dozen Tools

Automation for The Dirty Dozen fantasy football league (Sleeper).

## Annual workflow

| When | Command | What it does |
|---|---|---|
| Offseason | `node cli.js pull` then `node cli.js keepers` | Writes the new "NN-NN Keepers" sheet into the workbook (backs it up first) |
| Weekly in season | `node cli.js pull` then `node cli.js finances` | Refreshes `finances-YYYY.csv` with weekly high-score winners |
| Season end | same as weekly | Adds 1st/2nd/3rd place payout rows |

The live league page (GitHub Pages) needs **no updates** — it fetches Sleeper
from the viewer's browser. Push to `main` only when logic/layout changes.

## Config (`config.json`)

- `amounts` — dues / weekly / place payouts (edit when league votes change them)
- `owners` — Sleeper username → ledger name map (edit when someone new joins)
- `basisOverrides` — pin a player's nominal keeper basis when a draft-day
  collision bumped their actual round

## Tests

`npm test` — includes a regression suite that replays 4 years of real keeper
history; accepted human-error divergences live in `test/fixtures/allowlist.json`.
```

- [ ] **Step 2: Full suite + clean tree check**

Run: `npm test` → all pass.
Run: `git status` → only README untracked.

- [ ] **Step 3: Commit and push**

```bash
git add README.md
git commit -m "docs: README with annual workflow"
git push
```

---

## Self-Review (completed)

**Spec coverage:** keeper engine rules 1–7 → Tasks 4–7; regression + allowlist → Task 8; Excel writer + backup + idempotency → Task 10; finances incl. config-driven amounts + status merge → Tasks 9/11; live page → Task 12; GitHub Pages + public-repo privacy boundary → Task 13 (+ `.gitignore` in Task 1); config seeding from updated workbook + owner-map confirmation → Task 11 Step 3; error handling (stale cache, EBUSY, missing players) → Tasks 2/7/11. Draft-order display → Tasks 10–12.

**Placeholders:** none — every code step has complete code; Task 11 Step 3's user confirmation is a genuine runtime decision, with both branches specified.

**Type consistency:** engine pick shape `{playerId, round, isKeeper}` (Tasks 4–6) vs raw Sleeper `{player_id, round, is_keeper}` — converted exactly once, in `computeKeeperBoard` (Task 7) and in the regression test's own adapter (Task 8). `resolveKeeperSlots` consumes `evaluatePlayer` output spread with `playerId`/`name` — shapes match. `buildLedger` row arrays match the 7-column CSV header order used in Task 11.
