import { balanceAfterElimination } from './seating.js';
import { waitingTables } from './table-occupancy.js';
import { finishAutomatically } from './results-state.js';

export const dealers = [
  { id: 'dana', name: 'דנה ברק' },
  { id: 'lior', name: 'ליאור כהן' },
  { id: 'noam', name: 'נועם לוי' },
];

export function openTables(tournament) {
  return (tournament?.tables ?? []).filter((table) => table.status === 'open');
}

function requireTable(tournament, tableId) {
  const table = openTables(tournament).find((item) => item.id === tableId);
  if (!table) throw new Error('השולחן אינו פתוח.');
  return table;
}

function changeTable(tournament, tableId, change) {
  const next = change(requireTable(tournament, tableId));
  return { ...tournament, tables: tournament.tables.map((table) => table.id === tableId ? next : table) };
}

export function issueCode(tournament, tableId, now = Date.now()) {
  const used = new Set(openTables(tournament).filter((table) => table.code?.expires > now).map((table) => table.code.value));
  let value;
  do {
    value = String(100000 + crypto.getRandomValues(new Uint32Array(1))[0] % 900000);
  } while (used.has(value));
  return changeTable(tournament, tableId, (table) => ({ ...table, code: { value, expires: now + 300000 } }));
}

export function pair(tournament, code, token, now = Date.now()) {
  const table = openTables(tournament).find((item) => item.code?.value === code && item.code.expires > now);
  if (!table) throw new Error('קוד השיוך שגוי או פג. בקשו קוד חדש מהפלור.');
  return changeTable(tournament, table.id, (current) => ({ ...current, code: null, tablet: token }));
}

export function pairedTable(tournament, token) {
  return token ? openTables(tournament).find((table) => table.tablet === token) : undefined;
}

export function disconnectTablet(tournament, tableId) {
  return changeTable(tournament, tableId, (table) => ({ ...table, tablet: null, code: null }));
}

export function changeShift(tournament, dealerId, start, now = Date.now(), roster = dealers) {
  if (!tournament || !roster.some((dealer) => dealer.id === dealerId)) throw new Error('יש לשמור טורניר ולבחור דילר.');
  const shifts = tournament.shifts ?? {};
  if (start === Boolean(shifts[dealerId])) throw new Error('מצב המשמרת כבר השתנה.');
  const next = { ...shifts };
  if (start) next[dealerId] = { startedAt: now, statusSince: now, history: [{ at: now, table: null }] };
  else delete next[dealerId];
  const closedShifts = start ? tournament.closedShifts : [...(tournament.closedShifts ?? []),
    { dealerId, ...shifts[dealerId], endedAt: now }];
  return { ...tournament, shifts: next, closedShifts, tables: tournament.tables?.map((table) =>
    table.dealer === dealerId ? { ...table, dealer: null } : table) };
}

export function assignDealer(tournament, tableId, dealerId, now = Date.now()) {
  const table = requireTable(tournament, tableId);
  const shifts = { ...tournament.shifts };
  if (!shifts[dealerId] || openTables(tournament).some((item) => item.id !== tableId && item.dealer === dealerId)) {
    throw new Error('הדילר חייב להיות במשמרת ופנוי.');
  }
  if (table.dealer === dealerId) return tournament;
  const transition = (id, table) => ({
    ...shifts[id], statusSince: now, history: [...(shifts[id].history ?? []), { at: now, table }],
  });
  if (shifts[table.dealer]) shifts[table.dealer] = transition(table.dealer, null);
  shifts[dealerId] = transition(dealerId, tableId);
  return { ...changeTable(tournament, tableId, (current) => ({ ...current, dealer: dealerId })), shifts };
}

function requirePair(tournament, token) {
  const table = pairedTable(tournament, token);
  if (!table) throw new Error('שיוך הטאבלט בוטל.');
  return table;
}

export function swapDealer(tournament, token, dealerId, expectedDealer) {
  const table = requirePair(tournament, token);
  if ((table.dealer ?? null) !== expectedDealer) throw new Error('הדילר בשולחן השתנה. בחרו שוב.');
  return assignDealer(tournament, table.id, dealerId);
}

export function eliminate(tournament, token, playerId, expectedSeat, now = Date.now()) {
  const table = requirePair(tournament, token);
  if (tournament.status === 'finished') throw new Error('הטורניר הסתיים.');
  if (!table.dealer) throw new Error('יש לשבץ דילר לפני ביצוע הדחה.');
  if (waitingTables(tournament).some((item) => item.id === table.id)) throw new Error('השולחן ממתין לאיזון מהפלור.');
  const player = (tournament.players ?? []).find((item) => item.id === playerId);
  if (!player || player.table !== table.id || player.seat !== expectedSeat) {
    throw new Error('המושב השתנה. בחרו מחדש ממפת השולחן.');
  }
  const order = (tournament.eliminationOrder ?? 0) + 1;
  const updated = { ...tournament, eliminationOrder: order, players: tournament.players.map((item) =>
    item.id === playerId ? { ...item, table: null, seat: null,
      elimination: { table: table.id, seat: expectedSeat, at: now, order } } : item) };
  return finishAutomatically(tournament.live ? balanceAfterElimination(updated, table.id, now) : updated, now);
}

export function clockLeft(clock, now = Date.now()) {
  return Math.max(0, clock?.deadline ? clock.deadline - now : clock?.remaining ?? 0);
}

export function updateClock(tournament, token, action, now = Date.now()) {
  const table = requirePair(tournament, token);
  if (tournament.status === 'finished') throw new Error('הטורניר הסתיים.');
  if (!table.dealer) throw new Error('יש לשבץ דילר לפני הפעלת השעון.');
  if (waitingTables(tournament).some((item) => item.id === table.id)) throw new Error('השולחן ממתין לאיזון מהפלור.');
  const remaining = clockLeft(table.clock, now);
  if (action === 'pause' && (!table.clock?.deadline || remaining === 0)) return tournament;
  const clock = action === 'pause'
    ? { remaining }
    : { deadline: now + (table.clock && !table.clock.deadline && remaining > 0 ? remaining : 30000) };
  return changeTable(tournament, table.id, (current) => ({ ...current, clock }));
}
