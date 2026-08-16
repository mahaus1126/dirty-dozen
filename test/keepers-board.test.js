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
