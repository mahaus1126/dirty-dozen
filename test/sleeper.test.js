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
