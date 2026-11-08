import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { dealers } from './public/dealer-state.js';

const databasePath = resolve(process.env.TOURNAMENTS_DB ?? fileURLToPath(new URL('./data/club.sqlite', import.meta.url)));
mkdirSync(dirname(databasePath), { recursive: true });
const db = new DatabaseSync(databasePath);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS clubs (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, location TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS employees (
    id TEXT PRIMARY KEY, club_id TEXT NOT NULL REFERENCES clubs(id),
    name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('floor','cashier','dealer')),
    created_at TEXT NOT NULL
  );
`);
if (!db.prepare('PRAGMA table_info(employees)').all().some((column) => column.name === 'archived_at')) {
  db.exec('ALTER TABLE employees ADD COLUMN archived_at INTEGER');
}
db.exec(`
  CREATE TABLE IF NOT EXISTS attendance (
    id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employees(id),
    started_at INTEGER NOT NULL, ended_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS tournament_archive (
    club_id TEXT NOT NULL REFERENCES clubs(id), tournament_id TEXT NOT NULL,
    title TEXT NOT NULL, finished_at INTEGER NOT NULL, entries INTEGER NOT NULL, prize_pool INTEGER NOT NULL,
    PRIMARY KEY(club_id, tournament_id)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS attendance_one_open ON attendance(employee_id) WHERE ended_at IS NULL;
`);
const clubId = 'local-club';
const employeeInsert = db.prepare('INSERT INTO employees (id, club_id, name, role, created_at) VALUES (?, ?, ?, ?, ?)');
db.exec('BEGIN IMMEDIATE');
try {
  const seed = db.prepare('INSERT OR IGNORE INTO clubs VALUES (?, ?, ?)').run(clubId, 'הג׳וקר', 'ראשון לציון');
  if (seed.changes) {
    const createdAt = new Date().toISOString();
    for (const employee of [
      { id: 'floor-demo', name: 'נועה לוי', role: 'floor' },
      { id: 'cashier-demo', name: 'שיר נוי', role: 'cashier' },
      ...dealers.map((dealer) => ({ ...dealer, role: 'dealer' })),
    ]) employeeInsert.run(employee.id, clubId, employee.name, employee.role, createdAt);
  }
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}

const publicDirectory = fileURLToPath(new URL('./public/', import.meta.url));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const club = db.prepare('SELECT id, name, location FROM clubs WHERE id = ?');
const employees = db.prepare('SELECT id, name, role, created_at AS createdAt FROM employees WHERE club_id = ? AND archived_at IS NULL ORDER BY created_at, id');
const updateClub = db.prepare('UPDATE clubs SET name = ?, location = ? WHERE id = ?');
const port = Number(process.env.PORT ?? 8080);
const ownerPassword = process.env.TOURNAMENTS_OWNER_PASSWORD;
const hash = (value) => createHash('sha256').update(value).digest();
const ownerSecret = ownerPassword ? hash(ownerPassword) : null;
const ownerSessions = new Map();
const sessionAge = 8 * 60 * 60 * 1000;
const cookieName = 'tournaments_owner';
let nextLoginAttempt = 0;

function sessionToken(request) {
  return request.headers.cookie?.match(/(?:^|;\s*)tournaments_owner=([a-f0-9-]{36})(?:;|$)/)?.[1];
}

function isOwner(request) {
  const token = sessionToken(request);
  const expiry = ownerSessions.get(token);
  if (expiry > Date.now()) return true;
  ownerSessions.delete(token);
  return false;
}

const localTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jerusalem', year: 'numeric', month: 'numeric', day: 'numeric',
  hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23',
});
function monthBounds(month) {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month ?? '')) throw new Error('יש לבחור חודש תקין.');
  const [year, index] = month.split('-').map(Number);
  function boundary(monthIndex) {
    const target = Date.UTC(year, monthIndex, 1);
    let candidate = target;
    for (let pass = 0; pass < 2; pass++) {
      const parts = Object.fromEntries(localTime.formatToParts(candidate).map(({ type, value }) => [type, Number(value)]));
      const actual = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
      candidate += target - actual;
    }
    return candidate;
  }
  return [boundary(index - 1), boundary(index)];
}

const activeAttendance = db.prepare(`
  SELECT a.employee_id AS employeeId, a.started_at AS startedAt
  FROM attendance a JOIN employees e ON a.employee_id = e.id
  WHERE e.club_id = ? AND a.ended_at IS NULL
`);
const lookupEmployee = db.prepare('SELECT id FROM employees WHERE id = ? AND club_id = ? AND archived_at IS NULL');

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function text(value, max = 100) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new Error('יש להזין ערך תקין באורך של עד ' + max + ' תווים.');
  }
  return value.trim();
}

async function body(request) {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') {
    throw new Error('נדרש JSON.');
  }
  let data = '';
  for await (const chunk of request) {
    data += chunk;
    if (Buffer.byteLength(data) > 4096) {
      request.resume();
      throw new Error('הבקשה ארוכה מדי.');
    }
  }
  return JSON.parse(data);
}

const server = createServer(async (request, response) => {
  const host = request.headers.host;
  if (!['127.0.0.1:' + port, 'localhost:' + port].includes(host)) return json(response, 403, { error: 'גישה מקומית בלבד.' });
  const url = new URL(request.url, 'http://localhost');
  const path = url.pathname;
  if (path.startsWith('/api/')) {
    const origin = request.headers.origin;
    if (origin && origin !== 'http://' + host) return json(response, 403, { error: 'מקור בקשה לא מורשה.' });
    try {
      const method = request.method;
      if (path === '/api/club/owner') {
        if (method === 'GET') return json(response, 200, { authenticated: isOwner(request), configured: Boolean(ownerSecret) });
        if (method === 'DELETE') {
          ownerSessions.delete(sessionToken(request));
          response.setHeader('Set-Cookie', cookieName + '=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict');
          return json(response, 200, { authenticated: false });
        }
        if (method === 'POST') {
          if (!ownerSecret) return json(response, 503, { error: 'יש להגדיר סיסמת בעלים בהפעלת השרת.' });
          const data = await body(request);
          const now = Date.now();
          if (now < nextLoginAttempt) return json(response, 429, { error: 'יש להמתין לפני ניסיון נוסף.' });
          if (typeof data.password !== 'string' || !timingSafeEqual(hash(data.password), ownerSecret)) {
            nextLoginAttempt = now + 1500;
            return json(response, 401, { error: 'סיסמת בעלים שגויה.' });
          }
          for (const [token, expiry] of ownerSessions) if (expiry <= now) ownerSessions.delete(token);
          ownerSessions.delete(sessionToken(request));
          const token = randomUUID();
          ownerSessions.set(token, now + sessionAge);
          response.setHeader('Set-Cookie', cookieName + '=' + token + '; Max-Age=' + sessionAge / 1000 + '; Path=/; HttpOnly; SameSite=Strict');
          return json(response, 200, { authenticated: true });
        }
      }
      const ownerRoute = path === '/api/club/report' || path === '/api/club/tournaments' || path.startsWith('/api/club/employees') ||
        (path === '/api/club' && method === 'PATCH');
      if (ownerRoute && !isOwner(request)) return json(response, 401, { error: 'נדרשת כניסת בעלים.' });
      if (path === '/api/club/tournaments' && method === 'GET') {
        return json(response, 200, { tournaments: db.prepare(`
          SELECT title, finished_at AS finishedAt, entries, prize_pool AS prizePool
          FROM tournament_archive WHERE club_id = ? ORDER BY finished_at DESC
        `).all(clubId) });
      }
      if (path === '/api/club/tournaments' && method === 'POST') {
        const data = await body(request);
        const { finishedAt, entries, prizePool } = data;
        if (![finishedAt, entries, prizePool].every((value) => Number.isSafeInteger(value) && value >= 0) ||
            !finishedAt || finishedAt > Date.now() || !entries) {
          return json(response, 400, { error: 'נדרש סיכום תקין של טורניר שהסתיים.' });
        }
        db.prepare(`
          INSERT INTO tournament_archive VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (club_id, tournament_id) DO UPDATE SET
            title = excluded.title, finished_at = excluded.finished_at, entries = excluded.entries, prize_pool = excluded.prize_pool
        `).run(clubId, text(data.id), text(data.title), finishedAt, entries, prizePool);
        return json(response, 200, { archived: true });
      }
      if (path === '/api/club/report' && method === 'GET') {
        const [start, end] = monthBounds(url.searchParams.get('month'));
        const now = Date.now();
        const roster = db.prepare('SELECT id, name, role, archived_at AS archivedAt FROM employees WHERE club_id = ? ORDER BY name, id').all(clubId);
        const shifts = db.prepare(`
          SELECT a.employee_id AS employeeId, a.started_at AS startedAt, a.ended_at AS endedAt
          FROM attendance a JOIN employees e ON a.employee_id = e.id
          WHERE e.club_id = ? AND a.started_at < ? AND COALESCE(a.ended_at, ?) > ?
          ORDER BY a.started_at
        `).all(clubId, Math.min(end, now), now, start).map((row) => ({
          ...row, durationMs: Math.min(row.endedAt ?? now, end) - Math.max(row.startedAt, start),
        }));
        return json(response, 200, { employees: roster, shifts });
      }
      if (path === '/api/club/attendance' && method === 'GET') {
        return json(response, 200, { active: activeAttendance.all(clubId) });
      }
      if (path === '/api/club/attendance' && method === 'POST') {
        const { employeeId, action } = await body(request);
        if (typeof employeeId !== 'string' || !lookupEmployee.get(employeeId, clubId)) {
          return json(response, 404, { error: 'עובד פעיל לא נמצא.' });
        }
        const now = Date.now();
        if (action === 'start') {
          const result = db.prepare('INSERT OR IGNORE INTO attendance VALUES (?, ?, ?, NULL)').run(randomUUID(), employeeId, now);
          if (!result.changes) return json(response, 409, { error: 'כבר קיימת משמרת פתוחה.' });
        } else if (action === 'end') {
          const result = db.prepare('UPDATE attendance SET ended_at = MAX(started_at, ?) WHERE employee_id = ? AND ended_at IS NULL').run(now, employeeId);
          if (!result.changes) return json(response, 409, { error: 'אין משמרת פתוחה.' });
        } else return json(response, 400, { error: 'פעולת נוכחות לא תקינה.' });
        return json(response, 200, { active: activeAttendance.all(clubId) });
      }
      const employeePath = path.match(/^\/api\/club\/employees\/([\w-]+)$/);
      if (employeePath && method === 'DELETE') {
        const result = db.prepare(`
          UPDATE employees SET archived_at = ?
          WHERE id = ? AND club_id = ? AND archived_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM attendance WHERE employee_id = employees.id AND ended_at IS NULL)
        `).run(Date.now(), employeePath[1], clubId);
        if (!result.changes) return json(response, 409, { error: 'העובד כבר הוסר או שיש לסגור את משמרתו תחילה.' });
        return json(response, 200, { archived: true });
      }
      if (request.method === 'GET' && path === '/api/club') {
        return json(response, 200, { ...club.get(clubId), employees: employees.all(clubId) });
      }
      if (request.method === 'PATCH' && path === '/api/club') {
        const data = await body(request);
        updateClub.run(text(data.name), text(data.location), clubId);
        return json(response, 200, club.get(clubId));
      }
      if (request.method === 'POST' && path === '/api/club/employees') {
        const data = await body(request);
        const name = text(data.name);
        const role = data.role;
        if (!['floor', 'cashier', 'dealer'].includes(role)) return json(response, 400, { error: 'יש לבחור תפקיד מוכר.' });
        const id = randomUUID();
        const createdAt = new Date().toISOString();
        employeeInsert.run(id, clubId, name, role, createdAt);
        return json(response, 201, { id, name, role, createdAt });
      }
      return json(response, 404, { error: 'הנתיב אינו קיים.' });
    } catch (error) {
      const storageError = error.code?.startsWith('ERR_SQLITE');
      if (storageError) console.error(error);
      return json(response, storageError ? 500 : 400, { error: storageError ? 'השמירה במסד הנתונים נכשלה.' : error.message });
    }
  }
  const file = path === '/' ? 'index.html' : path.slice(1);
  if (request.method !== 'GET' || !/^[\w.-]+\.(html|js|css)$/.test(file)) return json(response, 404, { error: 'הקובץ אינו קיים.' });
  try {
    const content = readFileSync(resolve(publicDirectory, file));
    response.writeHead(200, { 'Content-Type': mime[extname(file)] + '; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
    response.end(content);
  } catch {
    json(response, 404, { error: 'הקובץ אינו קיים.' });
  }
});

server.listen(port, '127.0.0.1', () => console.log('Tournaments listening on http://127.0.0.1:' + port));
