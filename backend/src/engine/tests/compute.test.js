const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { ComputePool, ComputeError } = require('../../compute/pool');
const { ValidationError } = require('../../engine/errors');
const { createApp } = require('../../server');
const workerPath = path.join(__dirname, 'support/computeWorker.js');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

test('Real worker preserves exact equity, range and ICM results and validation errors', async () => {
  const pool = new ComputePool();
  try {
    const result = await pool.run('calculate', {
      players: [['Ah','Ac'],['Kh','Kc']], board: ['2s','3d','7h','8c','9s'],
      gameType: 'holdem', gameMode: 'cash', iterations: 1,
      settings: { method: 'exact', chipUnit: 0.01 },
    });
    assert.deepEqual(result.analysis.results.map(player => player.equity), [100,0]);
    assert.equal(result.analysis.method, 'exact');
    const range = await pool.run('range', { range: 'AA' });
    assert.ok(range);
    const icm = await pool.run('icm', { players: [{name:'A',stack:100},{name:'B',stack:100}], payouts:[100,0] });
    assert.equal(icm.results[0].prizeEquity, 50);
    await assert.rejects(pool.run('icm', { players: [] }), ValidationError);
  } finally { await pool.close(); }
});

test('Worker queue bounds global and per-user work, and cancels queued and active tasks', async () => {
  const pool = new ComputePool({ workerPath, maxQueued: 2, maxPerUser: 2 });
  const active = new AbortController(), queued = new AbortController();
  try {
    const first = pool.run('slow', { ms: 1000 }, { owner: 'A', signal: active.signal }).catch(e => e);
    const second = pool.run('slow', { ms: 100 }, { owner: 'A', signal: queued.signal }).catch(e => e);
    await assert.rejects(pool.run('slow', {}, { owner:'A' }), e => e.code === 'COMPUTE_BUSY');
    const third = pool.run('slow', { value: 'B' }, { owner:'B' });
    await assert.rejects(pool.run('slow', {}, { owner:'C' }), e => e.code === 'COMPUTE_BUSY');
    queued.abort(); active.abort();
    assert.equal((await second).name, 'AbortError'); assert.equal((await first).name, 'AbortError');
    assert.equal(await third, 'B');
    const aborted = new AbortController(); aborted.abort();
    await assert.rejects(pool.run('slow', {}, { signal: aborted.signal }), e => e.name === 'AbortError');
  } finally { await pool.close(); }
});

test('Worker timeout/crash recovers and queued work continues; shutdown settles promises', async () => {
  const pool = new ComputePool({ workerPath, timeoutMs: 400 });
  try {
    await assert.rejects(pool.run('slow', { ms: 2000 }), e => e.code === 'COMPUTE_TIMEOUT' && e.status === 504);
    assert.equal(await pool.run('fast', { value: 'recovered' }), 'recovered');
    await assert.rejects(pool.run('crash', {}), ComputeError);
    assert.equal(await pool.run('fast', { value: 'again' }), 'again');
    const pending = pool.run('slow', { ms: 2000 }).catch(e => e);
    await pool.close(); assert.equal((await pending).status, 503);
    await assert.rejects(pool.run('fast', {}), ComputeError);
  } finally { await pool.close(); }
});

test('HTTP health and account endpoints remain responsive while CPU worker is busy; overload is retryable', async () => {
  const pool = new ComputePool({ workerPath, maxQueued: 1 });
  const app = createApp({ databaseReady: () => true,
    auth: { router: express.Router().get('/me', (req,res) => res.json({user:null})), config:{origins:[]}, middleware(req,res,next) {req.user={id:'A'};next();} },
    compute: (req,res,kind,input) => pool.run('slow', { ms: 500, value: { results: [] } }, { owner: req.user.id }),
  });
  const server = app.listen(0,'127.0.0.1'); await once(server,'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = () => fetch(base+'/api/icm',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  try {
    const first = post(); await pause(70);
    const start = Date.now(); assert.equal((await fetch(base+'/healthz')).status,200);
    assert.equal((await fetch(base+'/api/auth/me')).status,200);
    assert.ok(Date.now()-start < 350, 'HTTP should not wait for the 500ms CPU task');
    const second = post(); await pause(30);
    const third = await post(); assert.equal(third.status,503); assert.equal(third.headers.get('retry-after'),'1');
    assert.match((await third.json()).error,/queue is full/);
    assert.equal((await first).status,200); assert.equal((await second).status,200);
  } finally { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); await pool.close(); }
});

test('Disconnecting a calculation cancels its real worker before persistence and later requests still succeed', async () => {
  const Spot = require('../../models/Spot');
  const { pool } = require('../../compute/pool');
  const save = Spot.prototype.save;
  let writes = 0;
  Spot.prototype.save = async function () { writes++; return this; };
  const app = createApp({ databaseReady: () => true, auth: {
    router: express.Router(), config: { origins: [] },
    middleware(req,res,next) { req.user={id:'000000000000000000000001'}; next(); },
  } });
  const server = app.listen(0,'127.0.0.1'); await once(server,'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const controller = new AbortController();
  try {
    const request = fetch(base+'/api/calculate', { method:'POST', headers:{'Content-Type':'application/json'}, signal:controller.signal,
      body:JSON.stringify({players:[['Ah','Ac','Qh','Qc'],['Kh','Kc','Jh','Jc']],board:[],gameType:'omaha',gameMode:'cash',potSize:100,callAmount:0,iterations:100000,saveSpot:true,calculationMethod:'monteCarlo'}) }).catch(error=>error);
    for (let i=0;i<100 && !pool.active;i++) await pause(10);
    assert.ok(pool.active, 'Request should enter the CPU worker before cancellation');
    controller.abort(); await request;
    for (let i=0;i<100 && (pool.active || pool.restarting);i++) await pause(10);
    assert.equal(pool.active,null); assert.equal(writes,0);
    const response = await fetch(base+'/api/icm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({players:[{name:'A',stack:100},{name:'B',stack:100}],payouts:[100]})});
    assert.equal(response.status,200); assert.equal((await response.json()).results[0].prizeEquity,50);
  } finally { Spot.prototype.save=save; server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); await pool.close(); }
});
