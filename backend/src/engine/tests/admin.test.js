const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once, EventEmitter } = require('node:events');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { provisionAdmin } = require('../../admin/provision');
const { registration, checkPassword } = require('../../auth/security');
const { createAuth } = require('../../auth');
const { MemoryAuthStore } = require('./support/authStore');
const { createApp } = require('../../server');
const User = require('../../models/User');
const { readSecret } = require('../../../scripts/secretPrompt');
const password = 'admin private test password';

test('Admin provisioning creates an approved contact-free salted account and never resets an existing account', async () => {
  const store = new MemoryAuthStore();
  assert.deepEqual(await provisionAdmin(store,password), {created:true});
  const admin = await store.findUser('admin');
  assert.equal(admin.role,'admin'); assert.equal(admin.email,undefined); assert.equal(admin.phone,undefined);
  assert.ok(admin.accountApprovedAt); assert.equal(await checkPassword(password,admin.passwordHash),true);
  assert.deepEqual(await provisionAdmin(store,'another private test password'),{created:false});
  assert.equal((await store.findUser('admin')).passwordHash,admin.passwordHash);
  const occupied = new MemoryAuthStore();
  await occupied.createUser({username:'admin',usernameKey:'admin',role:'user',passwordHash:'unchanged'});
  await assert.rejects(provisionAdmin(occupied,password),/non-admin/);
  assert.equal((await occupied.findUser('admin')).passwordHash,'unchanged');
});
test('Only admin schema records may omit contacts; public registration cannot reserve admin or assign roles', () => {
  const base={username:'admin',usernameKey:'admin',passwordHash:'schema-test-only'};
  assert.equal(new User({...base,role:'admin'}).validateSync(),undefined);
  const regular=new User({...base,username:'Member',usernameKey:'member'}).validateSync();
  assert.ok(regular.errors.email); assert.ok(regular.errors.phone);
  const input={email:'member@example.invalid',username:'Member',phone:'+15550000001',password,channel:'email',role:'admin'};
  assert.equal(registration(input).role,undefined);
  assert.throws(()=>registration({...input,username:'AdMiN'}),/reserved/);
});
test('Production admin logs in by username without OTP; cookies and private API access remain enforced', async () => {
  const store=new MemoryAuthStore(); await provisionAdmin(store,password);
  const auth=createAuth({store,config:{secret:'admin-test-only-secret-not-for-production',origins:['https://app.example.invalid'],secure:true,cookieName:'__Host-river_session'},delivery:{config:{channels:[],development:false}}});
  const app=createApp({auth});app.set('trust proxy',1);
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const request=(url,options={})=>fetch(`http://127.0.0.1:${server.address().port}/api${url}`,{...options,headers:{'X-Forwarded-Proto':'https','Content-Type':'application/json','X-Requested-With':'RiverPokerLab',...options.headers}});
  try {
    assert.equal((await request('/anything')).status,401);
    assert.equal((await request('/auth/me')).status,200);
    const login=await request('/auth/login',{method:'POST',body:JSON.stringify({identifier:'ADMIN',password})});
    assert.equal(login.status,200);const data=await login.json();
    assert.equal(data.user.role,'admin');assert.equal(data.user.email,null);assert.equal(data.user.phone,null);
    assert.equal(data.user.emailVerified,false);assert.equal(data.user.phoneVerified,false);
    assert.equal(data.verification,undefined);assert.match(login.headers.get('set-cookie'),/Secure/);
    const cookie=login.headers.get('set-cookie').split(';')[0];
    assert.equal((await request('/anything',{headers:{Cookie:cookie}})).status,404);
    assert.equal((await request('/auth/login',{method:'POST',body:JSON.stringify({identifier:'admin',password:'wrong'})})).status,401);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('Private input has no echo and restores terminal state on completion and cancellation', async () => {
  const input=new EventEmitter();Object.assign(input,{isTTY:true,isRaw:false,setEncoding(){},setRawMode(value){this.isRaw=value;},resume(){},pause(){}});
  const output={isTTY:true,text:'',write(value){this.text+=value;}};
  const answer=readSecret('Password: ',input,output);input.emit('data','secret hidden value\r');
  assert.equal(await answer,'secret hidden value');assert.equal(output.text,'Password: \n');assert.equal(input.isRaw,false);
  const cancel=readSecret('Password: ',input,output);input.emit('data','must not echo\u0003');
  await assert.rejects(cancel,/Cancelled/);assert.equal(input.isRaw,false);assert.ok(!output.text.includes('must not echo'));
});
test('Admin CLI rejects secret arguments and noninteractive execution without leaking values', () => {
  const script=path.join(__dirname,'../../../scripts/createAdmin.js');
  const args=spawnSync(process.execPath,[script,'--password=never-log-this-value'],{encoding:'utf8'});
  assert.equal(args.status,1);assert.ok(!`${args.stdout}${args.stderr}`.includes('never-log-this-value'));
  const piped=spawnSync(process.execPath,[script,'--production'],{input:'never-log-piped-password',encoding:'utf8'});
  assert.equal(piped.status,1);assert.ok(!`${piped.stdout}${piped.stderr}`.includes('never-log-piped-password'));
});
