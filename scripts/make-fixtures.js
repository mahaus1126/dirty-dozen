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
  bracket2025: bundle.brackets['2025'] ?? null,
}, null, 1));

// Sanity: keeper-flag counts must match live-verified values.
const expected = { 2021: 24, 2022: 31, 2023: 26, 2024: 26, 2025: 24 };
for (const [y, n] of Object.entries(expected)) {
  const got = seasons[y].picks.filter(p => p.is_keeper).length;
  if (got !== n) throw new Error(`Fixture sanity failed: ${y} keeper count ${got} !== ${n}`);
}
console.log('Fixtures written. Keeper counts verified:', expected);
