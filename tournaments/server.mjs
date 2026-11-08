import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
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
const clubId = 'local-club';
const employeeInsert = db.prepare('INSERT INTO employees VALUES (?, ?, ?, ?, ?)');
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
const employees = db.prepare('SELECT id, name, role, created_at AS createdAt FROM employees WHERE club_id = ? ORDER BY created_at, id');
const updateClub = db.prepare('UPDATE clubs SET name = ?, location = ? WHERE id = ?');
const port = Number(process.env.PORT ?? 8080);

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
  const path = new URL(request.url, 'http://localhost').pathname;
  if (path.startsWith('/api/')) {
    const origin = request.headers.origin;
    if (origin && origin !== 'http://' + host) return json(response, 403, { error: 'מקור בקשה לא מורשה.' });
    try {
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
