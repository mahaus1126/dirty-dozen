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
