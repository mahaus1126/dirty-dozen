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
