import { registrationOpen } from './live-state.js';
import { assignSeat } from './seating.js';

export function pools(tournament) {
  return (tournament?.entries ?? []).reduce((total, entry) => {
    const rake = Number(entry.rake ?? 0);
    const bounty = Number(entry.bounty ?? 0);
    return { collected: total.collected + entry.fee, rake: total.rake + rake,
      bounty: total.bounty + bounty, prizes: total.prizes + entry.fee - rake - bounty };
  }, { collected: 0, rake: 0, bounty: 0, prizes: 0 });
}

export function prizeShares(tournament) {
  return tournament?.prizeShares ?? [[10000], [6500, 3500], [5000, 3000, 2000]][
    Math.max(0, Math.min(2, (tournament?.players?.length ?? 0) - 1))];
}

// Allocate whole agorot by largest fractional remainder, then by finishing place.
export function allocatePrizes(total, shares) {
  const rows = shares.map((share, index) => {
    const numerator = BigInt(total) * BigInt(share);
    return { place: index + 1, amount: Number(numerator / 10000n), remainder: Number(numerator % 10000n) };
  });
  const remaining = total - rows.reduce((sum, row) => sum + row.amount, 0);
  const order = [...rows].sort((a, b) => b.remainder - a.remainder || a.place - b.place);
  for (let i = 0; i < remaining; i++) order[i].amount++;
  return rows.map(({ place, amount }) => ({ place, amount }));
}

function requireClosed(tournament, now) {
  if (!tournament?.live || registrationOpen(tournament, now)) throw new Error('הפרסים זמינים לאחר סגירת ההרשמה.');
}

function requireReason(reason) {
  if (!reason.trim()) throw new Error('יש להזין סיבה לתיקון.');
}

function log(tournament, event) {
  return [...(tournament.resultLog ?? []), event];
}

export function setPrizeShares(tournament, shares, reason, now = Date.now()) {
  requireClosed(tournament, now);
  if (tournament.results) throw new Error('חלוקת הפרסים ננעלה עם סיום הטורניר.');
  if (!shares.length || shares.length > Math.min(30, tournament.players?.length ?? 0) ||
      shares.some((share) => !Number.isInteger(share) || share <= 0) ||
      shares.reduce((sum, share) => sum + share, 0) !== 10000) {
    throw new Error('יש לבחור עד 30 מקומות מזכים, עד מספר השחקנים, וסך של 100%.');
  }
  requireReason(reason);
  return { ...tournament, prizeShares: shares, resultLog: log(tournament, {
    type: 'shares', at: now, before: prizeShares(tournament), after: shares, reason: reason.trim(),
  }) };
}

export function saveResults(tournament, playerIds, reason, expectedShares, expectedResults, now = Date.now()) {
  requireClosed(tournament, now);
  const shares = prizeShares(tournament);
  if (shares.join() !== expectedShares.join() ||
      JSON.stringify(tournament.results ?? null) !== expectedResults) {
    throw new Error('חלוקת הפרסים או התוצאות השתנו. בדקו את הנתונים ונסו שוב.');
  }
  const players = new Map((tournament.players ?? []).map((player) => [player.id, player]));
  if (playerIds.length !== shares.length || new Set(playerIds).size !== shares.length ||
      playerIds.some((id) => !players.has(id))) throw new Error('יש לבחור שחקן שונה לכל מקום מזכה.');
  if (tournament.results) requireReason(reason);
  const rows = allocatePrizes(pools(tournament).prizes, shares).map((row, index) => ({
    ...row, playerId: playerIds[index], name: players.get(playerIds[index]).name,
  }));
  const previousStandings = tournament.results?.standings;
  const standings = previousStandings && [
    ...rows.map(({ playerId, name }) => ({ playerId, name })),
    ...previousStandings.filter((row) => !playerIds.includes(row.playerId)),
  ].map((row, index) => ({ ...row, place: index + 1 }));
  return { ...tournament, status: 'finished', results: { finishedAt: tournament.results?.finishedAt ?? now, rows, standings },
    resultLog: log(tournament, { type: tournament.results ? 'correction' : 'finish', at: now,
      before: tournament.results?.rows ?? null, after: rows, reason: reason.trim() }) };
}

export function finishAutomatically(tournament, now = Date.now()) {
  if (!tournament?.live || tournament.status !== 'registration' || registrationOpen(tournament, now)) return tournament;
  const players = tournament.players ?? [];
  const active = players.filter((player) => player.table != null);
  const eliminated = players.filter((player) => player.table == null);
  if (active.length !== 1 || !eliminated.length ||
      eliminated.some((player) => !Number.isFinite(player.elimination?.at))) return tournament;
  eliminated.sort((a, b) => a.elimination.order && b.elimination.order ?
    b.elimination.order - a.elimination.order : b.elimination.at - a.elimination.at);
  const standings = [...active, ...eliminated].map((player, index) => ({
    place: index + 1, playerId: player.id, name: player.name,
  }));
  const shares = prizeShares(tournament);
  const final = saveResults(tournament, standings.slice(0, shares.length).map((row) => row.playerId),
    'סיום אוטומטי לפי סדר ההדחות', shares, 'null', now);
  return { ...final, results: { ...final.results, standings } };
}

export function itmWarning(tournament, active, now = Date.now()) {
  if (!tournament?.live || !registrationOpen(tournament, now)) return 0;
  const paid = prizeShares(tournament).length;
  return active > 0 && active <= paid && (tournament.players ?? []).some((player) => player.elimination) ? paid : 0;
}

export function restoreElimination(tournament, id, reason, expectedElimination, now = Date.now()) {
  if (tournament?.results) throw new Error('לא ניתן להחזיר שחקן אחרי סיום הטורניר.');
  requireReason(reason);
  const player = tournament?.players?.find((item) => item.id === id);
  if (!player?.elimination || player.table !== null) throw new Error('השחקן אינו זמין להחזרת הדחה.');
  if (JSON.stringify(player.elimination) !== expectedElimination) throw new Error('ההדחה השתנתה. בחרו שוב.');
  const location = assignSeat(tournament, player.elimination.table, player.elimination.seat);
  const restored = { ...player, ...location, elimination: null };
  return { ...tournament, players: tournament.players.map((item) => item.id === id ? restored : item),
    resultLog: log(tournament, { type: 'restore', at: now, before: player, after: restored, reason: reason.trim() }) };
}
