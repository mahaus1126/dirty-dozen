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
