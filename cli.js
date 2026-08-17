// Dirty Dozen CLI: node cli.js pull | keepers | finances [--season YYYY]
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pull, loadBundle, loadPlayers } from './lib/sleeper.js';
import { computeKeeperBoard } from './lib/keepers.js';
import { weeklyWinner, finalPlaces, parseCsv, serializeCsv, buildLedger, findOrphanedRows }
  from './lib/finances.js';
import { writeKeeperSheet } from './lib/excel.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(root, 'data');
const config = JSON.parse(await fs.readFile(path.join(root, 'config.json'), 'utf8'));
const [cmd, ...rest] = process.argv.slice(2);
let seasonFlag = null;
if (rest.includes('--season')) {
  const raw = rest[rest.indexOf('--season') + 1];
  if (!/^\d{4}$/.test(raw ?? '')) {
    console.error('--season requires a 4-digit year, e.g. --season 2025');
    process.exit(1);
  }
  seasonFlag = Number(raw);
}

const ledgerNameByUserId = (users) => {
  const byUsername = new Map(config.owners.map(o => [o.sleeperUsername.toLowerCase(), o.ledgerName]));
  const map = new Map();
  for (const u of users) {
    map.set(u.user_id, byUsername.get(u.display_name.toLowerCase()) ?? u.display_name);
  }
  return map;
};

// The bundle is a local cache; a stale one silently produces last week's answers.
function warnIfStale(bundle) {
  const ageH = (Date.now() - new Date(bundle.pulledAt).getTime()) / 3600e3;
  if (!Number.isFinite(ageH) || ageH > 24) {
    console.warn(`WARN: cached Sleeper data is ${Number.isFinite(ageH) ? Math.round(ageH) + 'h' : 'of unknown age'} old — consider: node cli.js pull`);
  }
}

// Week -> [ledger names] for the weekly high-score payout. Shared by both commands.
function weekWinnerNamesByWeek(bundle, current, nameById) {
  const rosterOwner = new Map(
    (bundle.rosters[current.season] ?? []).map(r => [r.roster_id, r.owner_id]));
  const toName = (rid) => nameById.get(rosterOwner.get(rid)) ?? `roster ${rid}`;
  const weeks = (current.settings?.playoff_week_start ?? 15) - 1;
  const byWeek = {};
  for (let w = 1; w <= weeks; w++) {
    const win = weeklyWinner(bundle.matchups[w]);
    if (win) byWeek[w] = win.rosterIds.map(toName);
  }
  return { weeks, byWeek, toName };
}

async function cmdKeepers() {
  const bundle = await loadBundle(dataDir);
  warnIfStale(bundle);
  const players = await loadPlayers(dataDir);
  const current = bundle.chain[0];
  const season = seasonFlag ?? Number(current.season);
  const seasons = Object.entries(bundle.picks)
    .map(([year, picks]) => ({ year: Number(year), picks: picks ?? [] }));
  const playerNames = {};
  for (const r of bundle.rosters[current.season] ?? []) {
    for (const pid of r.players ?? []) {
      const p = players[pid];
      playerNames[pid] = p
        ? { name: `${p.first_name} ${p.last_name}`, position: p.position ?? '' }
        : { name: pid, position: '' };
    }
  }
  const board = computeKeeperBoard({
    seasons,
    rosters: bundle.rosters[current.season] ?? [],
    users: bundle.users[current.season] ?? [],
    tradedPicks: bundle.tradedPicks[current.season] ?? [],
    upcomingSeason: String(season),
    rounds: config.rounds,
    overrides: config.basisOverrides,
    playerNames,
  });
  const nameById = ledgerNameByUserId(bundle.users[current.season] ?? []);
  for (const t of board.teams) t.ownerName = nameById.get(t.ownerId) ?? t.ownerName;

  const idx = (year) => Object.fromEntries(
    (bundle.picks[String(year)] ?? []).map(p => [p.player_id, { round: p.round }]));
  const { weeks, byWeek: weekWinnerNames, toName } =
    weekWinnerNamesByWeek(bundle, current, nameById);
  const bracketPlaces = finalPlaces(bundle.brackets[current.season]);
  const placeNames = bracketPlaces
    ? [bracketPlaces.first, bracketPlaces.second, bracketPlaces.third]
        .map(rid => (rid != null ? toName(rid) : null))
    : null;
  let draftOrder = null;
  if (bundle.drafts[current.season]?.draft_order) {
    draftOrder = {};
    for (const [uid, slot] of Object.entries(bundle.drafts[current.season].draft_order)) {
      draftOrder[nameById.get(uid) ?? uid] = slot;
    }
  }
  const workbookPath = path.resolve(root, config.workbookPath);
  try {
    const { sheetName, backupPath } = await writeKeeperSheet({
      workbookPath, season, board,
      prevSeasonPicks: idx(season - 1), prevPrevSeasonPicks: idx(season - 2),
      weeks, weekWinnerNames,
      ledgerNames: config.owners.map(o => o.ledgerName),
      draftOrder, amounts: config.amounts, placeNames,
    });
    console.log(`Wrote sheet "${sheetName}" to ${workbookPath}`);
    console.log(`Backup: ${backupPath}`);
  } catch (err) {
    if (err.code === 'EBUSY' || err.code === 'EPERM'
        || /used by another process/i.test(err.message)) {
      console.error('The workbook appears to be open in Excel. Close it and retry.');
      process.exit(1);
    }
    throw err;
  }
  for (const t of board.teams) {
    const elig = t.players.filter(p => p.eligible);
    console.log(`${t.ownerName}: ${elig.length} eligible keepers` +
      (elig.length ? ` (best: ${elig.slice(0, 3).map(p => `${p.name} R${p.costRound}`).join(', ')})` : ''));
  }
}

async function cmdFinances() {
  const bundle = await loadBundle(dataDir);
  warnIfStale(bundle);
  const current = bundle.chain[0];
  const season = String(seasonFlag ?? current.season);
  const nameById = ledgerNameByUserId(bundle.users[current.season] ?? []);
  const { byWeek: weekWinners, toName } = weekWinnerNamesByWeek(bundle, current, nameById);
  const bracketPlaces = finalPlaces(bundle.brackets[current.season]);
  const places = bracketPlaces && {
    first: toName(bracketPlaces.first), second: toName(bracketPlaces.second),
    third: bracketPlaces.third != null ? toName(bracketPlaces.third) : null,
  };
  const outPath = path.resolve(root, config.financesDir, `finances-${season}.csv`);
  let existingRows = [];
  let header = ['Season Name (2022 for nfl/mlb or 2022-23 for nba/nhl)', 'Member Name',
                'Amount', 'Type (debit/credit)', 'Label', 'Tags (comma seperated)',
                'Status (paid/pending/past-due)'];
  try {
    const prior = parseCsv(await fs.readFile(outPath, 'utf8'));
    header = prior.header;
    existingRows = prior.rows;
  } catch { /* first run */ }
  const ledgerNames = config.owners.map(o => o.ledgerName);
  const rows = buildLedger({
    season, ledgerNames,
    amounts: config.amounts, weekWinners, places, existingRows,
  });
  const orphans = findOrphanedRows(rows, ledgerNames);
  for (const o of orphans) {
    console.warn(`WARN: row for unknown member "${o[1]}" (${o[4]}${o[5] ? ' ' + o[5] : ''}) — leftover after a rename? Reconcile it manually.`);
  }
  await fs.writeFile(outPath, serializeCsv(header, rows));
  console.log(`Wrote ${rows.length} rows to ${outPath}`);
}

if (cmd === 'pull') {
  const bundle = await pull(config, dataDir);
  console.log(`Pulled ${bundle.chain.length} seasons (current: ${bundle.chain[0].season}).`);
} else if (cmd === 'keepers') {
  await cmdKeepers();
} else if (cmd === 'finances') {
  await cmdFinances();
} else {
  console.log('Usage: node cli.js pull | keepers [--season YYYY] | finances [--season YYYY]');
  process.exit(cmd ? 1 : 0);
}
