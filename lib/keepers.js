// Dirty Dozen keeper rules engine.
// Pure functions, ZERO imports — shared byte-for-byte by the CLI and the web page.

export const KEEP_OFFSETS = [1, 4, 8];   // cost offsets for 1st, 2nd, 3rd consecutive keep
export const FA_FIRST_KEEP_ROUND = 10;   // undrafted pickups slot here on their first keep
export const MAX_CONSECUTIVE_KEEPS = 3;
export const BANNED_DRAFT_ROUNDS = 2;    // genuinely *drafted* in R1-R2 => can't be kept

function picksByPlayer(season) {
  if (!season._byPlayer) {
    season._byPlayer = new Map(season.picks.map(p => [p.playerId, p]));
  }
  return season._byPlayer;
}

// seasonsDesc: [{ year, picks: [{playerId, round, isKeeper}] }] most-recent-first.
export function keeperHistory(playerId, seasonsDesc) {
  let yearsKept = 0;
  for (const s of seasonsDesc) {
    const p = picksByPlayer(s).get(playerId);
    if (p && p.isKeeper) yearsKept++;
    else break;
  }
  const last = seasonsDesc.length ? picksByPlayer(seasonsDesc[0]).get(playerId) : undefined;
  return {
    yearsKept,
    basisRound: last ? last.round : 'FA',
    lastPickWasKeeper: Boolean(last && last.isKeeper),
  };
}

export function nominalCost(basisRound, keepNumber) {
  if (basisRound === 'FA') return FA_FIRST_KEEP_ROUND; // only reachable as keepNumber 1
  return Math.max(1, basisRound - KEEP_OFFSETS[keepNumber - 1]);
}

export function evaluatePlayer(playerId, seasonsDesc, overrides = {}) {
  const h = keeperHistory(playerId, seasonsDesc);
  const ov = overrides[playerId];
  if (ov && ov.basisRound != null) h.basisRound = ov.basisRound;
  const keepNumber = h.yearsKept + 1;
  if (h.yearsKept >= MAX_CONSECUTIVE_KEEPS) {
    return { ...h, eligible: false, costRound: null,
             reason: `kept ${MAX_CONSECUTIVE_KEEPS} consecutive seasons — must re-enter draft` };
  }
  if (h.basisRound !== 'FA' && h.basisRound <= BANNED_DRAFT_ROUNDS && !h.lastPickWasKeeper) {
    return { ...h, eligible: false, costRound: null,
             reason: `drafted in round ${h.basisRound} last year` };
  }
  return { ...h, eligible: true, reason: null, costRound: nominalCost(h.basisRound, keepNumber) };
}
