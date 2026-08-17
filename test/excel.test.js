import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { writeKeeperSheet, sheetNameForSeason } from '../lib/excel.js';

test('sheetNameForSeason follows NN-NN pattern', () => {
  assert.equal(sheetNameForSeason(2026), '25-26 Keepers');
  assert.equal(sheetNameForSeason(2030), '29-30 Keepers');
});

async function makeSyntheticWorkbook(dir) {
  const wb = new ExcelJS.Workbook();
  const rules = wb.addWorksheet('Rules and payouts');
  rules.getCell('A1').value = 'Some rules text';
  const old = wb.addWorksheet('24-25 Keepers');
  old.getCell('B1').value = 'Player';
  const file = path.join(dir, 'wb.xlsx');
  await wb.xlsx.writeFile(file);
  return file;
}

const BOARD = { upcomingSeason: '2026', teams: [{
  rosterId: 1, ownerId: 'u1', ownerName: 'mitch', teamName: 'T', ownedRounds: [1],
  players: [
    { playerId: 'p1', name: 'Good Keeper', position: 'RB', basisRound: 7, yearsKept: 0,
      eligible: true, reason: null, costRound: 6 },
    { playerId: 'p2', name: 'First Rounder', position: 'WR', basisRound: 1, yearsKept: 0,
      eligible: false, reason: 'drafted in round 1 last year', costRound: null },
  ],
}] };

test('writeKeeperSheet adds the sheet, backs up first, preserves other sheets', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ddxl-'));
  const file = await makeSyntheticWorkbook(dir);
  await writeKeeperSheet({
    workbookPath: file, season: 2026, board: BOARD,
    prevSeasonPicks: { p1: { round: 7 }, p2: { round: 1 } },
    prevPrevSeasonPicks: { p1: { round: 9 } },
    weeks: 14, weekWinnerNames: { 1: ['Thor'] },
    ledgerNames: ['mitch', 'Thor'], draftOrder: null,
    amounts: { places: [120, 50, 30] },
  });
  const backups = (await fs.readdir(dir)).filter(f => f.includes('backup'));
  assert.equal(backups.length, 1);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  assert.ok(wb.getWorksheet('Rules and payouts'), 'existing sheet survived');
  assert.equal(wb.getWorksheet('Rules and payouts').getCell('A1').value, 'Some rules text');
  const sheet = wb.getWorksheet('25-26 Keepers');
  assert.ok(sheet, 'new sheet exists');
  assert.equal(sheet.getCell('A2').value, 'mitch');       // owner label on first player row
  assert.equal(sheet.getCell('B2').value, 'Good Keeper');
  assert.equal(sheet.getCell('C2').value, 9);              // 2024 round
  assert.equal(sheet.getCell('D2').value, 7);              // 2025 round
  assert.equal(sheet.getCell('E2').value, 6);              // 2026 cost
  assert.equal(sheet.getCell('E3').value, 'N/A');          // ineligible
  assert.equal(sheet.getCell('J3').value, 'Thor');         // week 1 winner
});

test('rerunning replaces the sheet idempotently', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ddxl-'));
  const file = await makeSyntheticWorkbook(dir);
  const args = { workbookPath: file, season: 2026, board: BOARD,
    prevSeasonPicks: {}, prevPrevSeasonPicks: {}, weeks: 14, weekWinnerNames: {},
    ledgerNames: ['mitch'], draftOrder: null, amounts: { places: [120, 50, 30] } };
  await writeKeeperSheet(args);
  await writeKeeperSheet(args);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const matches = wb.worksheets.filter(w => w.name === '25-26 Keepers');
  assert.equal(matches.length, 1);
});
