import { registrationOpen } from './live-state.js';

function fail(message) {
  throw new Error(message);
}

export function seats(tournament, table, except) {
  const taken = new Set((tournament.players ?? [])
    .filter((player) => player.id !== except && player.table === table.id)
    .map((player) => player.seat));
  return Array.from({ length: table.capacity }, (_, index) => index + 1)
    .filter((seat) => !taken.has(seat));
}

function requireTournament(tournament) {
  if (!tournament) fail('יש להקים ולשמור טורניר בעמדת הפלור.');
}

export function addTable(tournament, capacity, status) {
  requireTournament(tournament);
  if (!Number.isInteger(capacity) || capacity < 2 || capacity > 12) fail('קיבולת שולחן חייבת להיות בין 2 ל־12.');
  if (status !== 'ready' && status !== 'open') fail('מצב שולחן לא תקין.');
  const tables = tournament.tables ?? [];
  return { ...tournament, tables: [...tables, { id: (tables.at(-1)?.id ?? 0) + 1, capacity, status }] };
}

export function assignSeat(tournament, tableId, seat, except) {
  const table = (tournament.tables ?? []).find((item) => item.id === tableId && item.status === 'open');
  if (!table || !seats(tournament, table, except).includes(seat)) fail('המושב כבר אינו פנוי. בחרו מושב אחר.');
  return { table: tableId, seat };
}

export function movePlayer(tournament, id, table, seat) {
  requireTournament(tournament);
  if (!(tournament.players ?? []).some((player) => player.id === id && player.table !== null)) {
    fail('השחקן כבר אינו יושב בשולחן.');
  }
  const location = assignSeat(tournament, table, seat, id);
  return { ...tournament, players: tournament.players.map((player) => player.id === id ? { ...player, ...location } : player) };
}

export function register(tournament, request) {
  requireTournament(tournament);
  if (!registrationOpen(tournament)) fail('ההרשמה סגורה.');
  if (!request.paid) fail('יש לאשר קבלת תשלום.');
  const entries = tournament.entries ?? [];
  if (entries.some((entry) => entry.id === request.id)) return tournament;
  const fee = Math.round(Number(tournament.fee) * 100);
  if (request.fee !== fee) fail('דמי הכניסה השתנו. בדקו את הסכום ואשרו שוב את התשלום.');
  const players = tournament.players ?? [];
  const previous = request.playerId ? players.find((player) => player.id === request.playerId) : null;
  if (request.playerId && (!previous || previous.table !== null)) fail('השחקן עדיין יושב בשולחן או אינו קיים.');
  if (previous && tournament.reentries !== 'unlimited' &&
      entries.filter((entry) => entry.playerId === previous.id && entry.kind === 'reentry').length >= Number(tournament.reentries)) {
    fail('מכסת הכניסות החוזרות נוצלה.');
  }
  const name = previous?.name ?? request.name.trim();
  if (!name || name.length > 100) fail('יש להזין שם שחקן עד 100 תווים.');

  let tables = tournament.tables ?? [];
  let location;
  if (request.table !== null) {
    location = assignSeat(tournament, request.table, request.seat);
  } else {
    let open = tables.filter((table) => table.status === 'open');
    const threshold = tournament.openThreshold ?? 7;
    if (open.every((table) => table.capacity - seats(tournament, table).length >= Math.min(threshold, table.capacity))) {
      const ready = tables.find((table) => table.status === 'ready');
      if (ready) {
        const activated = { ...ready, status: 'open' };
        tables = tables.map((table) => table.id === ready.id ? activated : table);
        open = [...open, activated];
      }
    }
    const candidates = open.map((table) => ({ table, available: seats(tournament, table) }))
      .filter(({ available }) => available.length)
      .sort((a, b) => (a.table.capacity - a.available.length) - (b.table.capacity - b.available.length) || a.table.id - b.table.id);
    if (!candidates.length) fail('אין מושבים פנויים. בקשו מהפלור לפתוח שולחן.');
    location = { table: candidates[0].table.id, seat: candidates[0].available[0] };
  }

  const player = { id: previous?.id ?? request.id, name, ...location };
  const entry = { id: request.id, playerId: player.id, kind: previous ? 'reentry' : 'first', name,
    ...location, fee, rake: tournament.rake, bounty: tournament.bounty };
  return { ...tournament, tables,
    players: previous ? players.map((item) => item.id === player.id ? player : item) : [...players, player],
    entries: [...entries, entry] };
}
