const test=require('node:test'),assert=require('node:assert/strict');
const reference=require('./support/riverSolverReference');
const {solveRiverTree,prepareRiverGame,uniformPolicy,LIMITS}=require('../riverSolver');
const {createCfrKernel}=require('../riverKernel');
const {riverResourcePlan,enforceRiverBudget}=require('../riverBudget');
const {riverCase}=require('../../../scripts/benchmarks/riverCases');
const {ComputePool}=require('../../compute/pool');
function compare(a,b,path='metrics'){
  if(typeof a==='number'){assert.ok(Math.abs(a-b)<1e-7,`${path}: ${a} != ${b}`);return;}
  if(a===null||typeof a!=='object'){assert.equal(a,b,path);return;}
  assert.deepEqual(Object.keys(a),Object.keys(b),path);for(const k of Object.keys(a))compare(a[k],b[k],`${path}.${k}`);
}
for(const name of ['kuhn-6','pairs-456','weighted-456','raised-12'])test(`Compiled CFR preserves every combo, action EV and best-response metric: ${name}`,()=>{
  const input=riverCase(name);input.solver.maxIterations=1000;
  const old=reference.solveRiverTree(input),next=solveRiverTree(input);
  compare(old.metrics,next.metrics);compare(old.history,next.history);assert.equal(next.iterationsCompleted,old.iterationsCompleted);assert.equal(next.stopReason,old.stopReason);
});
test('Quality-based early stopping preserves the known reference checkpoint',()=>{
  const input=riverCase('kuhn-6');input.solver.targetPotPct=.1;const old=reference.solveRiverTree(input),next=solveRiverTree(input);
  assert.equal(next.iterationsCompleted,14000);assert.equal(next.iterationsCompleted,old.iterationsCompleted);assert.equal(next.targetReached,true);compare(old.metrics,next.metrics);
});
test('Compiled averaging remains correct for very unequal chance weights and branch-specific own reach',()=>{
  const input=riverCase('raised-12');input.solver.maxIterations=1000;input.players[0].input.range='AhAc@0.01%,KhKc@1%,QhQc@99%,JhJc';input.players[1].input.range='AhAc@30%,KhKc@50%,QhQc@70%,JhJc@90%';
  compare(reference.solveRiverTree(input).metrics,solveRiverTree(input).metrics);
});
test('Compiled buffers agree exactly with the planner without double-counting shared opponent reach',()=>{
  for(const name of ['kuhn-6','pairs-456','raised-12','expanded-2064']){
    const input=riverCase(name),game=prepareRiverGame(input),policy=uniformPolicy(game);
    const arrays=()=>game.layout.map(l=>l?new Float64Array(l.count*l.actions):null),regrets=arrays(),sums=arrays();
    const kernel=createCfrKernel(game,policy,regrets,sums),plan=riverResourcePlan(game.tree,game.hands,game.deals,game.layout,input.solver.maxIterations);
    assert.equal(kernel.bytes,plan.kernelBytes);
    const strategyBytes=[...policy,...regrets,...sums].reduce((s,a)=>s+(a?.byteLength||0),0);
    assert.equal(strategyBytes,plan.strategyBytes);assert.equal(plan.coreTypedArrayBytes,plan.kernelBytes+plan.strategyBytes+plan.terminalBytes);
    assert.ok(plan.coreTypedArrayBytes<LIMITS.typedArrayBytes);
  }
});
test('Every resource boundary allows equality and rejects an over-budget request',()=>{
  const within={jointDeals:LIMITS.jointDeals,informationSets:LIMITS.informationSets,estimatedWork:LIMITS.work,dealNodeCells:LIMITS.dealNodeCells,coreTypedArrayBytes:LIMITS.typedArrayBytes};
  assert.doesNotThrow(()=>enforceRiverBudget(within));
  for(const [field,bound] of [['jointDeals',LIMITS.jointDeals],['informationSets',LIMITS.informationSets],['estimatedWork',LIMITS.work],['dealNodeCells',LIMITS.dealNodeCells],['coreTypedArrayBytes',LIMITS.typedArrayBytes]])
    assert.throws(()=>enforceRiverBudget({...within,[field]:bound+1}),{name:'ValidationError'});
});
test('An over-work request fails before the training loop, without partial output or solved progress',()=>{
  const input=riverCase('expanded-2064');input.solver.maxIterations=20000;const reports=[];
  assert.throws(()=>solveRiverTree(input,{onProgress:p=>reports.push(p)}),/work budget/);assert.ok(reports.every(p=>p.phase==='preparing'));
});
test('Check-only and denomination-aware split pots preserve exact zero-iteration solutions',()=>{
  const input=riverCase('kuhn-6');input.board=['As','Ks','Qs','Js','Ts'];input.potSize=1.05;input.chipUnit=.05;input.minBet=.1;input.betSizes=[];
  const result=solveRiverTree(input);assert.equal(result.iterationsCompleted,0);compare(reference.solveRiverTree(input).metrics,result.metrics);
  assert.equal(result.performance.timingsMs.iterations>=0,true);
});
test('Expanded exact range runs inside the real bounded worker with normalized policies and conserved chips',async()=>{
  const input=riverCase('expanded-2064');assert.throws(()=>reference.solveRiverTree(input),/limit/);
  const pool=new ComputePool();try{
    const r=await pool.run('riverSolve',input);assert.equal(r.jointDeals,2064);assert.equal(r.informationSets,192);assert.equal(r.iterationsCompleted,3000);
    assert.ok(r.estimatedWork<=LIMITS.work);assert.ok(r.performance.resources.coreTypedArrayBytes<=LIMITS.typedArrayBytes);
    assert.ok(Math.abs(r.metrics.expectedNet[0]+r.metrics.expectedNet[1]-2)<1e-12);
    for(const n of r.metrics.nodePolicies)for(const c of n.combos){assert.ok(Math.abs(c.frequencies.reduce((s,x)=>s+x,0)-1)<1e-12);assert.ok(c.actionEv.every(x=>x===null||Number.isFinite(x)));}
    for(const ms of Object.values(r.performance.timingsMs))assert.ok(Number.isFinite(ms)&&ms>=0);
    assert.equal(r.performance.kernel,'compiled-public-tree');
    const nearCap=riverCase('expanded-2064');nearCap.players.forEach(p=>p.input.range='22+');nearCap.solver.maxIterations=100;
    const large=await pool.run('riverSolve',nearCap);assert.equal(large.jointDeals,3684);assert.equal(large.informationSets,252);
    assert.ok(Math.abs(large.metrics.expectedNet[0]+large.metrics.expectedNet[1]-2)<1e-12);
  }finally{await pool.close();}
});
