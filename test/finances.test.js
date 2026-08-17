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
