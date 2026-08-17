// Writes the season keeper sheet into the real workbook, mirroring the historical layout.
// Always backs up first. Only the target sheet is added/replaced.
import fs from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';

export function sheetNameForSeason(season) {
  const a = String((season - 1) % 100).padStart(2, '0');
  const b = String(season % 100).padStart(2, '0');
  return `${a}-${b} Keepers (Generated)`;
}

export async function writeKeeperSheet({ workbookPath, season, board,
                                         prevSeasonPicks, prevPrevSeasonPicks,
                                         weeks, weekWinnerNames, ledgerNames,
                                         draftOrder, amounts, placeNames = null }) {
  // Probe for a write lock BEFORE taking a backup, so failed runs (workbook
  // open in Excel) don't accumulate stray backup files.
  await (await fs.open(workbookPath, 'r+')).close();

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const ext = path.extname(workbookPath);
  const backupPath = workbookPath.replace(ext, `.backup-${stamp}${ext}`);
  await fs.copyFile(workbookPath, backupPath);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(workbookPath);
  const name = sheetNameForSeason(season);
  const existing = wb.getWorksheet(name);
  if (existing) wb.removeWorksheet(existing.id);
  const ws = wb.addWorksheet(name);

  // Header row mirrors the historical sheets.
  ws.getCell('B1').value = 'Player';
  ws.getCell('C1').value = `${season - 2} Draft`;
  ws.getCell('D1').value = `${season - 1} Draft`;
  ws.getCell('E1').value = `${season} Draft`;
  ws.getCell('I1').value = 'Weekly Points Winners';
  for (const c of ['B1', 'C1', 'D1', 'E1', 'I1']) ws.getCell(c).font = { bold: true };

  // Owner blocks: owner label in column A on their first player row.
  let row = 2;
  for (const team of board.teams) {
    ws.getCell(`A${row}`).value = team.ownerName;
    for (const p of team.players) {
      ws.getCell(`B${row}`).value = p.name;
      const pp = prevPrevSeasonPicks[p.playerId];
      if (pp) ws.getCell(`C${row}`).value = pp.round;
      const prev = prevSeasonPicks[p.playerId];
      ws.getCell(`D${row}`).value = prev ? prev.round : 'FA';
      ws.getCell(`E${row}`).value = p.eligible ? p.costRound : 'N/A';
      if (!p.eligible) ws.getCell(`F${row}`).value = p.reason;
      row++;
    }
    row++; // blank spacer between owner blocks
  }

  // Weekly winners block (I=week, J=winner, L=name, M=COUNTIF tally) — same as 24-25 sheet.
  ws.getCell('I2').value = 'Week';
  ws.getCell('J2').value = 'Winner';
  for (const c of ['I2', 'J2']) ws.getCell(c).font = { bold: true };
  const firstWeekRow = 3;
  for (let w = 1; w <= weeks; w++) {
    ws.getCell(`I${firstWeekRow + w - 1}`).value = w;
    const winners = weekWinnerNames[w];
    if (winners && winners.length) {
      ws.getCell(`J${firstWeekRow + w - 1}`).value = winners.join(' / ');
    }
  }
  const lastWeekRow = firstWeekRow + weeks - 1;
  ledgerNames.forEach((n, i) => {
    const r = firstWeekRow + i;
    ws.getCell(`L${r}`).value = n;
    ws.getCell(`M${r}`).value =
      { formula: `COUNTIF(J${firstWeekRow}:J${lastWeekRow},L${r})`, result: 0 };
  });
  const sumRow = firstWeekRow + ledgerNames.length;
  ws.getCell(`M${sumRow}`).value =
    { formula: `SUM(M${firstWeekRow}:M${sumRow - 1})`, result: 0 };

  // Overall winners + draft order blocks.
  let r2 = lastWeekRow + 3;
  ws.getCell(`I${r2}`).value = 'Overall Winners';
  ws.getCell(`L${r2}`).value = `${season} Draft Order`;
  const placeLabels = amounts.places.map((amt, i) => `${i + 1} - $${amt}`);
  for (let i = 0; i < board.teams.length; i++) {
    const rr = r2 + 1 + i;
    ws.getCell(`I${rr}`).value = placeLabels[i] ?? String(i + 1);
    // Season decided: name the payout winners beside their place labels.
    if (placeNames && placeNames[i]) ws.getCell(`J${rr}`).value = placeNames[i];
    ws.getCell(`L${rr}`).value = i + 1;
    if (draftOrder) {
      const entry = Object.entries(draftOrder).find(([, slot]) => slot === i + 1);
      ws.getCell(`M${rr}`).value = entry ? entry[0] : 'TBD';
    } else {
      ws.getCell(`M${rr}`).value = 'TBD';
    }
  }
  const tail = r2 + 1 + board.teams.length + 1;
  ws.getCell(`I${tail}`).value = 'Loser:';
  ws.getCell(`I${tail + 1}`).value = 'Punishment:';

  for (const [col, width] of Object.entries({
    A: 10, B: 22, C: 10, D: 10, E: 10, F: 32, I: 14, J: 16, L: 12, M: 8,
  })) ws.getColumn(col).width = width;

  wb.calcProperties.fullCalcOnLoad = true; // formulas we write carry stale cached 0s otherwise

  const tmp = workbookPath.replace(ext, `.tmp${ext}`);
  await wb.xlsx.writeFile(tmp);
  try {
    await fs.rename(tmp, workbookPath);
  } catch (err) {
    // Excel holding the target locks the rename; don't strand a .tmp next to it.
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
  return { sheetName: name, backupPath };
}
