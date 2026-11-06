const {test}=require('node:test');
const assert=require('node:assert/strict');
const {once}=require('node:events');
const mongoose=require('mongoose');
const {createPreviewApp}=require('../../dev/preview');
const Spot=require('../../models/Spot');
test('UI preview refuses production/hosted environments',()=>{
  assert.throws(()=>createPreviewApp({NODE_ENV:'production'}),/local development/);
  assert.throws(()=>createPreviewApp({NODE_ENV:'development',RENDER:'true'}),/local development/);
  assert.throws(()=>createPreviewApp({}),/local development/);
});
test('Local preview has an ephemeral identity and real math without any database operations',async()=>{
  const oldSave=Spot.prototype.save,oldFind=Spot.find;let calls=0;
  Spot.prototype.save=async()=>{calls++;throw Error('No writes allowed');};
  Spot.find=()=>{calls++;throw Error('No reads allowed');};
  const app=createPreviewApp({NODE_ENV:'development'}),server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=(url,body,headers={})=>fetch(base+'/api'+url,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  try{
    const me=await(await request('/auth/me')).json();assert.equal(me.preview,true);assert.equal(me.user.username,'UI Preview');
    const icm=await(await request('/icm',{players:[{name:'A',stack:100},{name:'B',stack:100}],payouts:[100]})).json();assert.equal(icm.results[0].prizeEquity,50);
    assert.deepEqual((await(await request('/spots')).json()).spots,[]);
    assert.equal((await request('/calculate',{saveSpot:true})).status,403);
    assert.equal((await request('/auth/register',{})).status,403);
    assert.equal((await request('/auth/login',{})).status,403);
    assert.equal((await request('/auth/logout',{})).status,403);
    assert.equal((await request('/auth/me',undefined,{Origin:'https://evil.invalid'})).status,403);
    const spoofed = await new Promise((resolve,reject) => { const req = require('node:http').get(base+'/api/auth/me',{headers:{Host:'evil.invalid'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject); });
    assert.equal(spoofed,403);
    assert.equal((await request('/auth/me',undefined,{'Sec-Fetch-Site':'cross-site'})).status,403);
    assert.equal(calls,0);assert.equal(mongoose.connection.readyState,0);
  }finally{Spot.prototype.save=oldSave;Spot.find=oldFind;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
