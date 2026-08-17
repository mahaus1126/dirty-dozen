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
      rosterId: p.roster_id,
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
        const ev = evaluatePlayer(p.player_id, hist, {}, p.roster_id);
        return { playerId: p.player_id, name: p.name, costRound: ev.costRound ?? 99,
                 yearsKept: ev.yearsKept, basisRound: ev.basisRound,
                 eligible: ev.eligible, reason: ev.reason, actualRound: p.round };
      });
      for (const ev of evaluated.filter(e => !e.eligible)) {
        mismatches.push({ key: `${next}:${ev.playerId}:${ev.name}`, kind: 'kept-but-engine-says-ineligible',
                          detail: ev.reason });
      }
      const resolved = resolveKeeperSlots(evaluated.filter(e => e.eligible), owned);
      for (const r of resolved) {
        const actual = evaluated.find(e => e.playerId === r.playerId).actualRound;
        if (r.assignedRound !== actual) {
          mismatches.push({ key: `${next}:${r.playerId}:${r.name}`, kind: 'round-mismatch',
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
