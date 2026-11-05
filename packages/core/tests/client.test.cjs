const test=require('node:test'),assert=require('node:assert/strict');
const {createApiClient,ApiError,ContractError,RiverJobClient}=require('..');
const response=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json',...headers}});
test('Native-style transport uses an absolute API URL, injected headers and JSON cancellation without DOM globals',async()=>{
  const seen=[];const client=createApiClient({baseUrl:'https://api.example.test/api/',credentials:'omit',headers:async()=>({forEach:callback=>callback('fixture','X-Host-Adapter')}),fetch:async(url,init)=>{seen.push({url,init});return response({success:true,job:{id:'fixture'}});}});
  await client.cancelSolverJob('fixture-job',{headers:new Headers({'X-Test':'retained'})});const {url,init}=seen[0];assert.equal(url,'https://api.example.test/api/river-jobs/fixture-job');assert.equal(init.method,'DELETE');assert.equal(init.body,'{}');assert.equal(init.credentials,'omit');assert.equal(init.headers.get('Content-Type'),'application/json');assert.equal(init.headers.get('X-Requested-With'),'RiverPokerLab');assert.equal(init.headers.get('X-Test'),'retained');assert.equal(init.headers.get('X-Host-Adapter'),'fixture');
});
test('Browser cookie transport reports private 401 once and preserves server error status/retry guidance',async()=>{
  let expired=0;const client=createApiClient({baseUrl:'/api',onUnauthorized:()=>expired++,fetch:async()=>response({success:false,error:'Sign in'},401,{'Retry-After':'1'})});
  await assert.rejects(client.getSolverJob('fixture'),e=>e instanceof ApiError&&e.status===401&&e.retryAfter==='1');assert.equal(expired,1);
  await assert.rejects(client.request('/auth/login'),ApiError);assert.equal(expired,1);
});
test('API paths cannot redirect credential-bearing requests outside their configured service',async()=>{
  let requests=0;const client=createApiClient({baseUrl:'https://api.example.test/api',fetch:async()=>{requests++;return response({success:true});}});
  for(const path of ['https://other.test/api','//other.test/api','/../auth','/spots/../../auth','/%2e%2e/auth','/spots\\x'])await assert.rejects(client.raw(path),ContractError);
  assert.equal(requests,0);assert.throws(()=>createApiClient({baseUrl:'https://username:password@api.test/api'}),ContractError);
});
test('Invalid JSON and unsupported contract versions are explicit client errors',async()=>{
  const invalid=createApiClient({baseUrl:'/api',fetch:async()=>new Response('not-json')});await assert.rejects(invalid.request('/spots'),e=>e.code==='INVALID_RESPONSE');
  const future=createApiClient({baseUrl:'/api',fetch:async()=>response({success:true,capabilities:{contractVersion:2}})});await assert.rejects(future.capabilities(),e=>e.code==='CONTRACT_VERSION');
});
test('Request timeouts and external cancellation abort the injected transport',async()=>{
  const seen=[];const client=createApiClient({baseUrl:'/api',timeoutMs:10,fetch:async(url,init)=>new Promise((resolve,reject)=>{seen.push(init.signal);const abort=()=>reject(Object.assign(Error('Cancelled'),{name:'AbortError'}));if(init.signal.aborted)abort();else init.signal.addEventListener('abort',abort,{once:true});})});
  await assert.rejects(client.request('/spots'),{name:'AbortError'});assert.equal(seen[0].aborted,true);
  const controller=new AbortController();controller.abort();await assert.rejects(client.request('/spots',{signal:controller.signal}),{name:'AbortError'});assert.equal(seen[1].aborted,true);
});
test('The shared controller accepts a platform UUID adapter without browser crypto',async()=>{
  let token;const job=new RiverJobClient(async(path,init)=>{if(init?.method==='POST')token=JSON.parse(init.body).requestId;return {job:{id:'native-fixture',requestId:token,status:'completed',progress:{phase:'completed',completedIterations:100,maxIterations:100},solution:{fixture:true}}};},()=>{},1,{createRequestId:()=> 'native-host-secure-uuid-fixture'});
  try{await job.start('native-key',{},100);assert.equal(token,'native-host-secure-uuid-fixture');assert.equal(job.current.status,'completed');}finally{job.dispose();}
});
test('Importing the package needs no browser objects, React, Node builtin or crypto implementation',()=>{
  const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),cache=new Map();
  function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file).exports;const module={exports:{}};cache.set(file,module);const context={module,exports:module.exports,require:name=>{assert.ok(name.startsWith('./'),'Portable modules must have only internal imports.');return load(path.join(path.dirname(file),name+'.js'));}};vm.runInNewContext(fs.readFileSync(file,'utf8'),context,{filename:file});return module.exports;}
  const core=load(path.join(__dirname,'../src/index.js'));assert.equal(core.API_CONTRACT_VERSION,1);assert.equal(typeof core.createApiClient,'function');assert.equal(typeof core.RiverJobClient,'function');
});
test('Account convenience methods retain the existing cookie-session JSON wire format',async()=>{
  const calls=[];const api=createApiClient({baseUrl:'/api',fetch:async(url,init)=>{calls.push({url,init});return response({success:true,user:null});}});
  await api.login({identifier:'fixture',password:'fixture-only-password',remember:true});await api.logout();await api.me();
  assert.equal(calls[0].url,'/api/auth/login');assert.equal(JSON.parse(calls[0].init.body).remember,true);assert.equal(calls[0].init.credentials,'include');assert.equal(calls[1].url,'/api/auth/logout');assert.equal(calls[1].init.body,'{}');assert.equal(calls[2].url,'/api/auth/me');
});
test('The same package supports native-style ESM imports and Node CommonJS imports',async()=>{
  const {pathToFileURL}=require('node:url');const esm=await import(pathToFileURL(require.resolve('..')).href);
  assert.equal(esm.API_CONTRACT_VERSION,1);assert.equal(esm.createApiClient,createApiClient);assert.equal(esm.RiverJobClient,RiverJobClient);
});
