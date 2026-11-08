const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
function adapter(transport){
  const source=fs.readFileSync(path.join(__dirname,'../src/lib/api.ts'),'utf8').replace('import.meta.env.VITE_API_URL',JSON.stringify('/api'));
  const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
  const module={exports:{}},events=[];
  vm.runInNewContext(code,{module,exports:module.exports,require,URL,Request,Headers,Event,fetch:transport,window:{location:{href:'https://app.example.test/'},dispatchEvent:event=>events.push(event.type)}},{filename:'api-adapter.js'});
  return {...module.exports,events};
}
test('Browser adapter preserves Request bodies, headers, overrides and cookie credentials',async()=>{
  const calls=[],a=adapter(async(url,init)=>{calls.push({url,init});return new Response('{"success":true}');});
  const request=new Request('https://app.example.test/api/calculate',{method:'POST',headers:{'Content-Type':'application/json','X-Fixture':'retained'},body:JSON.stringify({potSize:100})});
  await a.apiFetch(request);assert.equal(calls[0].url,'/api/calculate');assert.equal(calls[0].init.credentials,'include');assert.equal(calls[0].init.headers.get('X-Fixture'),'retained');assert.equal(JSON.parse(new TextDecoder().decode(calls[0].init.body)).potSize,100);
  await a.apiFetch(new Request('https://app.example.test/api/calculate',{method:'POST',body:'old'}),{body:'new'});assert.equal(new TextDecoder().decode(calls[1].init.body),'new');
});
test('Browser host dispatches session expiry only for private API 401 and blocks foreign destinations',async()=>{
  let calls=0;const a=adapter(async()=>{calls++;return new Response('{"success":false}',{status:401});});
  await a.apiFetch('/api/spots');await a.apiFetch('/api/auth/login');assert.deepEqual(a.events,['river-auth-expired']);
  await assert.rejects(a.apiFetch('https://foreign.example.test/api/spots'),/configured API/);assert.equal(calls,2);
});
