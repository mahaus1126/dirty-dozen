import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { writeKeeperSheet, sheetNameForSeason } from '../lib/excel.js';

test('sheetNameForSeason follows NN-NN pattern', () => {
  assert.equal(sheetNameForSeason(2026), '25-26 Keepers (Generated)');
  assert.equal(sheetNameForSeason(2030), '29-30 Keepers (Generated)');
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
  const sheet = wb.getWorksheet('25-26 Keepers (Generated)');
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
  const matches = wb.worksheets.filter(w => w.name === '25-26 Keepers (Generated)');
  assert.equal(matches.length, 1);
});

test('existing formulas and merged cells survive the rewrite', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ddxl-'));
  const wb0 = new ExcelJS.Workbook();
  const old = wb0.addWorksheet('24-25 Keepers');
  old.getCell('M3').value = { formula: 'COUNTIF(J3:J20,L3)', result: 2 };
  old.mergeCells('A1:B1');
  old.getCell('A1').value = 'Merged Header';
  const file = path.join(dir, 'wb.xlsx');
  await wb0.xlsx.writeFile(file);
  await writeKeeperSheet({
    workbookPath: file, season: 2026, board: BOARD,
    prevSeasonPicks: {}, prevPrevSeasonPicks: {}, weeks: 14, weekWinnerNames: {},
    ledgerNames: ['mitch'], draftOrder: null, amounts: { places: [120, 50, 30] },
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const survived = wb.getWorksheet('24-25 Keepers');
  assert.equal(survived.getCell('M3').value.formula, 'COUNTIF(J3:J20,L3)');
  assert.equal(survived.getCell('A1').value, 'Merged Header');
  // exceljs's own reader doesn't parse calcPr attributes back into
  // Workbook#calcProperties (verified: it always deserializes to {}, even for
  // a bare writeFile->readFile round trip with no other code involved), so we
  // check the persisted XML directly for what Excel actually reads on open.
  const buf = await fs.readFile(file);
  const zip = await JSZip.loadAsync(buf);
  const workbookXml = await zip.file('xl/workbook.xml').async('string');
  assert.match(workbookXml, /<calcPr[^>]*\bfullCalcOnLoad="1"/);
});
