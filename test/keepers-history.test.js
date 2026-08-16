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
