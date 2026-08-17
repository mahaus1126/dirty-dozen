// Season ledger generation in the League Legacy Finances CSV format.
// Pure functions — file I/O happens in cli.js.

export function weeklyWinner(matchupsForWeek) {
  if (!matchupsForWeek || !matchupsForWeek.length) return null;
  let best = 0, ids = [];
  for (const m of matchupsForWeek) {
    const pts = m.points ?? 0;
    if (pts > best) { best = pts; ids = [m.roster_id]; }
    else if (pts === best && pts > 0) ids.push(m.roster_id);
  }
  return best > 0 ? { rosterIds: ids, points: best } : null;
}

export function finalPlaces(winnersBracket) {
  if (!winnersBracket || !winnersBracket.length) return null;
  const maxRound = Math.max(...winnersBracket.map(m => m.r));
  const finals = winnersBracket.find(m => m.r === maxRound && m.p === 1);
  const third = winnersBracket.find(m => m.r === maxRound && m.p === 3);
  if (!finals || finals.w == null) return null;
  return { first: finals.w, second: finals.l, third: third ? third.w : null };
}

export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return { header: rows[0] ?? [], rows: rows.slice(1) };
}

const esc = (f) => (/[",\n\r]/.test(f) ? `"${f.replace(/"/g, '""')}"` : f);
export function serializeCsv(header, rows) {
  return [header, ...rows].map(r => r.map(esc).join(',')).join('\n') + '\n';
}

const KEY = (r) => [r[0], r[1], r[4], r[5]].join('|'); // season|member|label|tags

// Returns full row set: computed rows (status merged from existing) + manual extras.
export function buildLedger({ season, ledgerNames, amounts, weekWinners, places, existingRows }) {
  const existingByKey = new Map(existingRows.map(r => [KEY(r), r]));
  const computed = [];
  for (const name of ledgerNames) {
    computed.push([season, name, String(amounts.dues), 'debit', 'League Dues', '', 'pending']);
  }
  for (const week of Object.keys(weekWinners).map(Number).sort((a, b) => a - b)) {
    for (const name of weekWinners[week]) {
      computed.push([season, name, String(amounts.weeklyPoints), 'credit',
                     'Weekly Points', `Week${week}`, 'pending']);
    }
  }
  if (places) {
    const labels = ['1st Place', '2nd Place', '3rd Place'];
    [places.first, places.second, places.third].forEach((name, i) => {
      if (name) computed.push([season, name, String(amounts.places[i]), 'credit',
                               labels[i], '', 'pending']);
    });
  }
  const computedKeys = new Set(computed.map(KEY));
  for (const row of computed) {
    const prior = existingByKey.get(KEY(row));
    if (prior) {
      row[2] = prior[2]; // hand-edited amounts win — the CSV is the official record
      row[6] = prior[6]; // preserve manually edited status
    }
  }
  const manual = existingRows.filter(r => !computedKeys.has(KEY(r)));
  return [...computed, ...manual];
}

// Rows that look computed (known labels) but belong to no current ledger name —
// usually leftovers after an owner rename in config. cli.js surfaces these as warnings.
const COMPUTED_LABELS = ['League Dues', 'Weekly Points', '1st Place', '2nd Place', '3rd Place'];
export function findOrphanedRows(rows, ledgerNames) {
  const names = new Set(ledgerNames);
  return rows.filter(r => COMPUTED_LABELS.includes(r[4]) && !names.has(r[1]));
}
