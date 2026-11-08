export const minimumPlayers = 4;

export function occupiedTables(tournament) {
  const counts = new Map();
  for (const player of tournament?.players ?? []) {
    if (player.table != null) counts.set(player.table, (counts.get(player.table) ?? 0) + 1);
  }
  return (tournament?.tables ?? []).filter((table) => table.status === 'open' && counts.has(table.id))
    .map((table) => ({ ...table, count: counts.get(table.id) }));
}

export function waitingTables(tournament) {
  const occupied = occupiedTables(tournament);
  return tournament?.live && occupied.length > 1 ? occupied.filter((table) => table.count < minimumPlayers) : [];
}
