const test=require('node:test'),assert=require('node:assert/strict');
const {once}=require('node:events');
const {randomUUID}=require('node:crypto');
const express=require('express');
const {SolverJobs}=require('../../compute/solverJobs');
const {ComputePool,ComputeError}=require('../../compute/pool');
const {createApp}=require('../../server');
const {solveRiverTree}=require('../riverSolver');
const input=()=>({players:[{name:'OOP',stack:1,input:{type:'range',range:'2h2c,3h3c,4h4c'}},{name:'IP',stack:1,input:{type:'range',range:'2h2c,3h3c,4h4c'}}],board:['As','Ks','Qh','9d','7c'],potSize:2,minBet:1,chipUnit:1,betSizes:[.5],raiseSizes:[],maxRaises:0,includeAllIn:false,solver:{maxIterations:100,targetPotPct:0}});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function controlled(){const calls=[];return {calls,run(kind,input,options){return new Promise((resolve,reject)=>{const call={kind,input,options,resolve,reject};calls.push(call);options.signal?.addEventListener('abort',()=>reject(Object.assign(Error('Cancelled'),{name:'AbortError'})),{once:true});});}};}
const completed=()=>({options:{maxIterations:100},iterationsCompleted:100,history:[{iteration:100,exploitabilityPotPct:.1}],metrics:{value:'fixture'}});
test('Jobs keep private owner-scoped snapshots and deduplicate retries without duplicate CPU work',()=>{
  const pool=controlled(),jobs=new SolverJobs({pool}),token=randomUUID(),a=jobs.create('A',input(),token);
  assert.equal(a.status,'queued');assert.equal(pool.calls.length,1);
  assert.equal(jobs.create('A',input(),token).id,a.id);assert.equal(pool.calls.length,1);
  assert.throws(()=>jobs.create('A',{...input(),potSize:3},token),e=>e.status===409);
  assert.throws(()=>jobs.create('A',input(),randomUUID()),e=>e.status===409);
  for(const op of [()=>jobs.get('B',a.id),()=>jobs.cancel('B',a.id),()=>jobs.get('B','missing')])assert.throws(op,e=>e.status===404);
  assert.deepEqual(jobs.list('B'),[]);assert.equal(jobs.get('A',a.id).owner,undefined);assert.equal(jobs.get('A',a.id).fingerprint,undefined);
  assert.equal(jobs.create('B',input(),token).status,'queued');jobs.close();
});
test('Actual worker progress is monotonic and leaves the mathematical solution unchanged',async()=>{
  const pool=new ComputePool(),progress=[];
  try{const body=input();body.solver.maxIterations=1000;
    const result=await pool.run('riverSolve',body,{owner:'A',onProgress:p=>progress.push(p)}),direct=solveRiverTree(body);
    assert.deepEqual(result.metrics,direct.metrics);assert.deepEqual(result.history,direct.history);
    assert.ok(progress.some(p=>p.phase==='preparing'));assert.ok(progress.some(p=>p.phase==='evaluating'));
    assert.ok(progress.some(p=>p.completedIterations>0&&p.completedIterations<1000));
    for(let i=1;i<progress.length;i++)assert.ok(progress[i].completedIterations>=progress[i-1].completedIterations);
    for(const p of progress){assert.ok(p.completedIterations<=p.maxIterations);if(p.checkpoint)assert.ok(p.checkpoint.iteration<=p.completedIterations);}
    assert.equal(progress.at(-1).completedIterations,result.iterationsCompleted);
  }finally{await pool.close();}
});
test('Cancellation releases work, is idempotent, and cannot be overwritten by late progress/results',async()=>{
  const pool=controlled(),jobs=new SolverJobs({pool}),job=jobs.create('A',input(),randomUUID()),call=pool.calls[0];
  call.options.onProgress({phase:'solving',completedIterations:40,maxIterations:100});assert.equal(jobs.get('A',job.id).progress.completedIterations,40);
  assert.equal(jobs.cancel('A',job.id).status,'cancelled');assert.equal(call.options.signal.aborted,true);
  call.options.onProgress({phase:'solving',completedIterations:80,maxIterations:100});call.resolve(completed());await flush();
  assert.equal(jobs.get('A',job.id).status,'cancelled');assert.equal(jobs.get('A',job.id).solution,undefined);assert.equal(jobs.cancel('A',job.id).status,'cancelled');
});
test('Completion, rejection, timeout and failure report final outcomes honestly',async()=>{
  const pool=controlled(),jobs=new SolverJobs({pool});
  for(const [error,status] of [[null,'completed'],[new ComputeError('Timed out','TIMEOUT',504),'failed'],[Object.assign(Error('Bad cards'),{name:'ValidationError'}),'failed']]){
    const job=jobs.create('A',input(),randomUUID()),call=pool.calls.at(-1);
    if(error)call.reject(error);else call.resolve(completed());await flush();const result=jobs.get('A',job.id);assert.equal(result.status,status);
    if(!error){assert.equal(result.progress.completedIterations,100);assert.ok(result.solution);assert.equal(jobs.cancel('A',job.id).status,'completed');assert.ok(jobs.cancel('A',job.id).solution);}
    else assert.equal(result.solution,undefined);
  }
});
test('TTL, owner retention and memory bounds evict terminal results without cancelling other owners',async()=>{
  let now=100;const pool=controlled(),jobs=new SolverJobs({pool,now:()=>now,ttlMs:50,maxJobs:3,maxPerOwner:2,maxResultBytes:500});
  const active=jobs.create('B',input(),randomUUID());
  const ids=[];for(let i=0;i<3;i++){const j=jobs.create('A',input(),randomUUID());ids.push(j.id);pool.calls.at(-1).resolve(completed());await flush();now++;}
  assert.ok(jobs.resultBytes<=500);assert.equal(jobs.get('B',active.id).status,'queued');assert.throws(()=>jobs.get('A',ids[0]),e=>e.status===404);
  now+=60;assert.deepEqual(jobs.list('A'),[]);assert.equal(jobs.resultBytes,0);assert.equal(jobs.get('B',active.id).status,'queued');jobs.close();
});
test('Oversized retained results and full capacity fail explicitly',async()=>{
  const pool=controlled(),jobs=new SolverJobs({pool,maxJobs:1,maxResultBytes:20}),j=jobs.create('A',input(),randomUUID());
  assert.throws(()=>jobs.create('B',input(),randomUUID()),e=>e.status===503);
  pool.calls[0].resolve(completed());await flush();assert.equal(jobs.get('A',j.id).status,'failed');assert.equal(jobs.get('A',j.id).error.status,413);assert.equal(jobs.resultBytes,0);
});
test('Progress observers cannot corrupt the pool or swallow its final result',async()=>{
  const pool=new ComputePool();try{const r=await pool.run('riverSolve',input(),{onProgress:()=>{throw Error('Observer fixture');}});assert.equal(r.iterationsCompleted,100);}finally{await pool.close();}
});
test('Job API continues independently of the creation response and isolates GET/DELETE by authenticated owner',async()=>{
  const pool=controlled(),jobs=new SolverJobs({pool});
  const auth={router:express.Router(),config:{origins:[]},middleware(req,res,next){req.user={id:req.get('x-fixture-owner')||'A'};next();}};
  const server=createApp({auth,jobs,databaseReady:()=>true}).listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
  async function request(path,method='GET',body,owner='A'){return fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json','x-fixture-owner':owner},...(body?{body:JSON.stringify(body)}:{})});}
  try{
    const response=await request('/river-jobs','POST',{input:input(),requestId:randomUUID()});assert.equal(response.status,202);const j=(await response.json()).job;
    assert.equal(pool.calls[0].options.signal.aborted,false); // Creation response is finished, task survives.
    assert.equal((await fetch(base+'/healthz')).status,200);
    assert.equal((await request('/river-jobs/'+j.id,'GET',undefined,'B')).status,404);
    assert.equal((await request('/river-jobs/'+j.id,'DELETE',undefined,'B')).status,404);
    assert.deepEqual((await(await request('/river-jobs','GET',undefined,'B')).json()).jobs,[]);
    pool.calls[0].options.onProgress({phase:'solving',completedIterations:50,maxIterations:100});
    assert.equal((await(await request('/river-jobs/'+j.id)).json()).job.progress.completedIterations,50);
    pool.calls[0].resolve(completed());await flush();assert.equal((await(await request('/river-jobs/'+j.id)).json()).job.status,'completed');
    assert.equal((await request('/river-jobs','POST',{input:null,requestId:randomUUID()})).status,400);
  }finally{jobs.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('Production job create, read, list and cancellation all require login',async()=>{
  const {createAuth}=require('../../auth');const auth=createAuth({config:{secret:'background-tests-secret-never-real',origins:[],secure:false,cookieName:'jobs_test'},delivery:{config:{channels:[]}}});
  const server=createApp({auth}).listen(0,'127.0.0.1');await once(server,'listening');
  try{for(const [method,path] of [['POST','/river-jobs'],['GET','/river-jobs'],['GET','/river-jobs/missing'],['DELETE','/river-jobs/missing']]){const r=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method,headers:{'Content-Type':'application/json','X-Requested-With':'RiverPokerLab'},...(['POST','DELETE'].includes(method)?{body:'{}'}:{})});assert.equal(r.status,401);}}
  finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('Local preview creates real background results without persistence and rejects cross-origin job access',async()=>{
  const {createPreviewApp}=require('../../dev/preview'),mongoose=require('mongoose'),Spot=require('../../models/Spot');
  const saved=Spot.prototype.save;let writes=0;Spot.prototype.save=async()=>{writes++;throw Error('No preview writes');};
  const server=createPreviewApp({NODE_ENV:'development'}).listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
  try{
    const created=await fetch(base+'/api/river-jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({input:input(),requestId:randomUUID()})});assert.equal(created.status,202);const id=(await created.json()).job.id;
    let job;for(let i=0;i<100;i++){job=(await(await fetch(base+'/api/river-jobs/'+id)).json()).job;if(!['queued','running'].includes(job.status))break;await new Promise(r=>setTimeout(r,10));}
    assert.equal(job.status,'completed');assert.equal(job.solution.jointDeals,6);assert.equal(job.progress.completedIterations,job.solution.iterationsCompleted);
    assert.equal((await fetch(base+'/api/river-jobs/'+id,{headers:{Origin:'https://evil.invalid'}})).status,403);
    assert.equal((await fetch(base+'/api/river-jobs/'+id,{method:'DELETE',headers:{'Content-Type':'application/json',Origin:'https://evil.invalid'},body:'{}'})).status,403);
    assert.equal(writes,0);assert.equal(mongoose.connection.readyState,0);
  }finally{Spot.prototype.save=saved;server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('Malformed worker completion becomes a bounded failed job without retaining partial bytes',async()=>{
  const pool=controlled(),jobs=new SolverJobs({pool}),j=jobs.create('A',input(),randomUUID());pool.calls[0].resolve({invalid:true});await flush();
  const result=jobs.get('A',j.id);assert.equal(result.status,'failed');assert.equal(result.solution,undefined);assert.equal(jobs.resultBytes,0);assert.ok(Number.isFinite(result.expiresAt));
});
