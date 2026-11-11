const express = require('express');
const { createApp } = require('../server');
const { memoryHomeCashStore } = require('../homeCash/store');
const { memoryPracticeProgress } = require('../practice/progress');
const USER = Object.freeze({
  id: '00000000000000000000de01', username: 'UI Preview', role: 'user',
  email: null, phone: null, emailVerified: false, phoneVerified: false,
});
const loopback = value => ['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost', '[::1]'].includes(value);
function createPreviewApp(env = process.env) {
  if (env.NODE_ENV !== 'development' || env.RENDER === 'true')
    throw Error('UI preview is available only in local development.');
  const app = express();
  app.use((req,res,next) => {
    let local = false;
    try {
      const host = new URL(`http://${req.headers.host}`);
      local = loopback(host.hostname) && loopback(req.socket.remoteAddress) &&
        (!req.get('origin') || req.get('origin') === host.origin) && req.get('sec-fetch-site') !== 'cross-site';
    } catch {}
    if (!local) return res.status(403).json({success:false,error:'UI preview accepts local same-origin requests only.'});
    res.set('Cache-Control','no-store'); next();
  });
  app.use(express.json({limit:'2mb'}));
  app.get('/api/spots', (req,res) => res.json({success:true,spots:[],preview:true}));
  app.use((req,res,next) => {
    const localJob = req.path === '/api/river-jobs' && ['POST','GET'].includes(req.method) || /^\/api\/river-jobs\/[a-zA-Z0-9-]+$/.test(req.path) && ['GET','DELETE'].includes(req.method);
    const practice = req.method === 'POST' && /^\/api\/practice\/spots(?:\/[0-9a-f-]{36}\/answer)?$/.test(req.path);
    const homeCash = ['GET', 'POST'].includes(req.method) && req.path === '/api/home-cash' ||
      req.method === 'GET' && /^\/api\/home-cash\/history(?:\/[0-9a-f-]{36})?$/.test(req.path) ||
      req.method === 'POST' && /^\/api\/home-cash\/[0-9a-f-]{36}\/actions$/.test(req.path);
    const permitted = homeCash || localJob || practice || req.method === 'GET' && ['/api/auth/me','/api/auth/config','/api/capabilities','/api/bankroll','/api/practice/progress'].includes(req.path) ||
      req.method === 'POST' && ['/api/calculate','/api/icm','/api/analyze-decision','/api/ranges/preview','/api/river-tree','/api/river-solve','/api/tournament-tree'].includes(req.path);
    if (!permitted || (req.path === '/api/calculate' && req.body?.saveSpot !== undefined && req.body.saveSpot !== false))
      return res.status(403).json({success:false,error:'Saving and account actions are disabled in UI preview. Use authenticated development for persistence.'});
    next();
  });
  const router = express.Router();
  router.get('/me', (req,res) => res.json({success:true,user:USER,preview:true}));
  router.get('/config', (req,res) => res.json({success:true,configured:true,channels:[],development:false,preview:true}));
  const bankrollStore = { get: () => ({
    currency: "ILS", openingBalance: 100000,
    entries: [
      { id: "preview-cash", kind: "cash", venue: "online", date: "2026-10-31", buyIn: 20000, cashOut: 27500, note: "Cash session" },
      { id: "preview-tournament", kind: "tournament", venue: "live", date: "2026-10-30", buyIn: 12000, cashOut: 0, note: "Two entries" },
      { id: "preview-deposit", kind: "deposit", date: "2026-10-29", amount: 50000, note: "" },
    ],
  }) };
  app.use(createApp({bankrollStore,homeCashStore:memoryHomeCashStore(),practiceProgress:memoryPracticeProgress(),auth:{preview:true,router,config:{origins:[]},middleware(req,res,next) {req.user=USER;next();}}}));
  return app;
}
module.exports = { createPreviewApp };
