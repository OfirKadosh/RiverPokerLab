const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
// Compile the standalone TypeScript service with the frontend's existing compiler.
// No DOM, server credentials, React mount or network is involved in these race tests.
const ts=require('../node_modules/typescript');
const source=fs.readFileSync(path.join(__dirname,'../src/lib/riverJobClient.ts'),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const clientModule=import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<100;i++){if(fn())return;await pause(5);}throw Error('Client did not reach the expected state.');}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
const snapshot=(status='running',extra={})=>({id:'fixture-job',requestId:'fixture-request',status,progress:{phase:'solving',completedIterations:20,maxIterations:100},...extra});
test('App-owned polling survives panel absence and yields a matching solution',async()=>{
  const {RiverJobClient}=await clientModule,changes=[];let polls=0;
  const c=new RiverJobClient(async(path,init)=>init?.method==='POST'?{job:snapshot('queued')}:{job:++polls<2?snapshot():snapshot('completed',{solution:{iterationsCompleted:80}})},j=>changes.push(j),1);
  try{await c.start('draft-A',{},100);await until(()=>c.current.status==='completed');assert.equal(c.current.key,'draft-A');assert.equal(c.current.solution.iterationsCompleted,80);assert.ok(changes.some(j=>j.status==='running'));}finally{c.dispose();}
});
test('Cancel during creation waits for the job ID and cancels the accepted server task',async()=>{
  const {RiverJobClient}=await clientModule,post=deferred(),calls=[];
  const c=new RiverJobClient(async(path,init)=>{calls.push([path,init?.method]);return init?.method==='POST'?post.promise:{job:snapshot('cancelled')};},()=>{},1);
  try{const creating=c.start('A',{},100);await c.cancel();assert.equal(c.current.status,'cancelling');post.resolve({job:snapshot('queued')});await creating;assert.equal(c.current.status,'cancelled');assert.equal(calls.filter(x=>x[1]==='DELETE').length,1);}finally{c.dispose();}
});
test('A delayed poll cannot overwrite cancellation or attach an old result',async()=>{
  const {RiverJobClient}=await clientModule,poll=deferred();let reading=false;
  const c=new RiverJobClient(async(path,init)=>{if(init?.method==='POST')return {job:snapshot()};if(init?.method==='DELETE')return {job:snapshot('cancelled')};reading=true;return poll.promise;},()=>{},1);
  try{await c.start('A',{},100);await until(()=>reading);c.invalidate('B');await until(()=>c.current.status==='cancelled');poll.resolve({job:snapshot('completed',{solution:{stale:true}})});await pause(10);assert.equal(c.current.status,'cancelled');assert.equal(c.current.solution,undefined);}finally{c.dispose();}
});
test('A lost creation reply retries with the same idempotency token',async()=>{
  const {RiverJobClient}=await clientModule,tokens=[];
  const c=new RiverJobClient(async(path,init)=>{if(init?.method==='POST'){tokens.push(JSON.parse(init.body).requestId);if(tokens.length===1)throw Error('Lost response');return {job:snapshot('completed',{solution:{ok:true}})};}return {job:snapshot('cancelled')};},()=>{},1);
  try{await c.start('A',{},100);assert.equal(tokens.length,2);assert.equal(tokens[0],tokens[1]);assert.equal(c.current.status,'completed');}finally{c.dispose();}
});
test('Transient polling failure reconnects without creating a duplicate job',async()=>{
  const {RiverJobClient}=await clientModule;let posts=0,polls=0;const changes=[];
  const c=new RiverJobClient(async(path,init)=>{if(init?.method==='POST'){posts++;return {job:snapshot()};}if(++polls===1)throw Error('Offline');return {job:snapshot('completed',{solution:{ok:true}})};},j=>changes.push(j),1);
  try{await c.start('A',{},100);await until(()=>c.current.status==='completed');assert.equal(posts,1);assert.ok(changes.some(j=>j.connectionError));assert.equal(c.current.connectionError,null);}finally{c.dispose();}
});
test('Expired server jobs become unavailable rather than claiming successful completion',async()=>{
  const {RiverJobClient}=await clientModule;
  const c=new RiverJobClient(async(path,init)=>{if(init?.method==='POST')return {job:snapshot()};throw Object.assign(Error('Expired or server restarted'),{status:404});},()=>{},1);
  try{await c.start('A',{},100);await until(()=>c.current.status==='unavailable');assert.match(c.current.error,/restarted/);assert.equal(c.current.solution,undefined);}finally{c.dispose();}
});
test('Owner unmount during submission suppresses notifications and cleans up the created task',async()=>{
  const {RiverJobClient}=await clientModule,post=deferred(),changes=[];let deletes=0;
  const c=new RiverJobClient(async(path,init)=>{if(init?.method==='POST')return post.promise;if(init?.method==='DELETE')deletes++;return {job:snapshot('cancelled')};},j=>changes.push(j),1);
  const pending=c.start('owner-A',{},100);c.dispose();const count=changes.length;post.resolve({job:snapshot('queued')});await pending;await pause(1);assert.equal(changes.length,count);assert.equal(deletes,1);
});
test('Duplicate submission is blocked and a completed old draft is cleared on invalidation',async()=>{
  const {RiverJobClient}=await clientModule,post=deferred();let posts=0;
  const c=new RiverJobClient(async()=>{posts++;return post.promise;},()=>{},1);
  try{const pending=c.start('A',{},100);await c.start('A',{},100);assert.equal(posts,1);post.resolve({job:snapshot('completed',{solution:{ok:true}})});await pending;c.invalidate('B');assert.equal(c.current,null);}finally{c.dispose();}
});
