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

test('3-way floor collision: seniority order 1, 2, 3', () => {
  const r = resolveKeeperSlots(
    [K('vet', 1, 2, 4), K('mid', 1, 1, 5), K('kid', 1, 0, 6)], ALL);
  assert.deepEqual(r.map(x => [x.name, x.assignedRound]),
                   [['vet', 1], ['mid', 2], ['kid', 3]]);
});

test('double-traded rounds: cost 10 with 10 and 9 both traded lands on 8', () => {
  const owned = ALL.filter(x => x !== 10 && x !== 9);
  const r = resolveKeeperSlots([K('a', 10)], owned);
  assert.equal(r[0].assignedRound, 8);
});

test('senior slide displaces an otherwise-unconflicted junior', () => {
  // Senior (traded out of 10) slides to 9; junior who wanted 9 cascades to 8.
  const owned = ALL.filter(x => x !== 10);
  const r = resolveKeeperSlots([K('senior', 10, 1), K('junior', 9, 0)], owned);
  assert.equal(r.find(x => x.name === 'senior').assignedRound, 9);
  assert.equal(r.find(x => x.name === 'junior').assignedRound, 8);
  assert.equal(r.find(x => x.name === 'junior').moved, true);
});
