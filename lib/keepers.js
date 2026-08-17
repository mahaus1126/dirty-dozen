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

// seasonsDesc: [{ year, picks: [{playerId, round, isKeeper, rosterId?}] }] most-recent-first.
// forRosterId: the roster asking. Per the league owner's ruling the keep clock is
// TEAM-scoped — a keeper pick only extends the chain if the same roster made it, so a
// player acquired mid-season starts fresh at his new team's first-keep price. Omit
// forRosterId (or omit rosterId on picks) to count roster-agnostically.
// basisRound stays roster-agnostic: the draft round holds even across a drop/pickup.
export function keeperHistory(playerId, seasonsDesc, forRosterId) {
  const sameTeam = (p) =>
    forRosterId == null || p.rosterId == null || p.rosterId === forRosterId;
  let yearsKept = 0;
  for (const s of seasonsDesc) {
    const p = picksByPlayer(s).get(playerId);
    if (p && p.isKeeper && sameTeam(p)) yearsKept++;
    else break;
  }
  const last = seasonsDesc.length ? picksByPlayer(seasonsDesc[0]).get(playerId) : undefined;
  return {
    yearsKept,
    basisRound: last ? last.round : 'FA',
    // Also team-scoped: the R1/R2 ban is waived only by the asking roster's OWN keeper
    // slot. Otherwise a player kept down to R1 by team A and then traded would arrive at
    // team B with yearsKept reset AND the ban waived — a renewable round-1 keeper.
    lastPickWasKeeper: Boolean(last && last.isKeeper && sameTeam(last)),
  };
}

export function nominalCost(basisRound, keepNumber) {
  if (basisRound === 'FA') return FA_FIRST_KEEP_ROUND; // only reachable as keepNumber 1
  return Math.max(1, basisRound - KEEP_OFFSETS[keepNumber - 1]);
}

export function evaluatePlayer(playerId, seasonsDesc, overrides = {}, forRosterId) {
  const h = keeperHistory(playerId, seasonsDesc, forRosterId);
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

// Resolve final draft-slot assignments for one team's chosen keeper set (<= 3).
// keepers: [{playerId, name, costRound, yearsKept, basisRound}]
// ownedRounds: rounds where the team still holds its own original pick.
// Seniority (more years kept, then earlier basis, then name) holds its round;
// juniors slide up (r17-r20); if blocked all the way past round 1, push down (r14).
// Note: a senior keeper's slide can cascade into juniors who had no conflict
// of their own — their `moved` flag will be true with no direct cause.
export function resolveKeeperSlots(keepers, ownedRounds) {
  const owned = new Set(ownedRounds);
  const num = (b) => (b === 'FA' ? 99 : b);
  const seniority = (a, b) =>
    (b.yearsKept - a.yearsKept) || (num(a.basisRound) - num(b.basisRound)) ||
    String(a.name).localeCompare(String(b.name));
  const taken = new Set();
  const out = [];
  for (const k of [...keepers].sort(seniority)) {
    let r = k.costRound;
    while (r >= 1 && (!owned.has(r) || taken.has(r))) r--;
    if (r < 1) {
      r = 1;
      while (taken.has(r) || !owned.has(r)) r++;
    }
    taken.add(r);
    out.push({ ...k, assignedRound: r, moved: r !== k.costRound });
  }
  return out.sort((a, b) => a.assignedRound - b.assignedRound);
}

// Raw Sleeper shapes in, per-team keeper board out.
// seasons: [{year, picks: [raw sleeper picks]}] any order (sorted DESC internally).
export function computeKeeperBoard({ seasons, rosters, users, tradedPicks = [],
                                     upcomingSeason, rounds = 15, overrides = {},
                                     playerNames = {} }) {
  const seasonsDesc = [...seasons]
    .filter(s => Number(s.year) < Number(upcomingSeason))
    .sort((a, b) => b.year - a.year)
    .map(s => ({
      year: s.year,
      picks: s.picks.map(p => ({
        playerId: p.player_id, round: p.round, isKeeper: p.is_keeper === true,
        rosterId: p.roster_id,
      })),
    }));
  const userById = new Map(users.map(u => [u.user_id, u]));
  const teams = rosters.map(r => {
    const tradedAway = new Set(
      tradedPicks
        .filter(t => String(t.season) === String(upcomingSeason)
                     && t.roster_id === r.roster_id && t.owner_id !== r.roster_id)
        .map(t => t.round),
    );
    const ownedRounds = [];
    for (let i = 1; i <= rounds; i++) if (!tradedAway.has(i)) ownedRounds.push(i);
    const owner = userById.get(r.owner_id);
    const players = (r.players ?? []).map(pid => {
      const ev = evaluatePlayer(pid, seasonsDesc, overrides, r.roster_id);
      const meta = playerNames[pid] ?? {};
      return { playerId: pid, name: meta.name ?? pid, position: meta.position ?? '', ...ev };
    }).sort((a, b) => ((a.costRound ?? 99) - (b.costRound ?? 99))
                      || String(a.name).localeCompare(String(b.name)));
    return {
      rosterId: r.roster_id,
      ownerId: r.owner_id,
      ownerName: owner ? owner.display_name : `roster ${r.roster_id}`,
      teamName: owner && owner.metadata ? (owner.metadata.team_name ?? '') : '',
      ownedRounds,
      players,
    };
  });
  return { upcomingSeason, teams };
}
