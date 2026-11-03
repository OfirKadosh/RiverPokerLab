const test=require('node:test');
const assert=require('node:assert/strict');
const {once}=require('node:events');
const {prepareRiverGame,uniformPolicy,profileValues,bestResponse,assessPolicy,solveRiverTree}=require('../riverSolver');
const {ComputePool}=require('../../compute/pool');
const {createPreviewApp}=require('../../dev/preview');
const near=(a,b,eps=1e-9)=>assert.ok(Math.abs(a-b)<=eps,`${a} != ${b}`);
function benchmark(){return {players:[{name:'OOP',stack:1,input:{type:'range',range:'2h2c,3h3c,4h4c'}},{name:'IP',stack:1,input:{type:'range',range:'2h2c,3h3c,4h4c'}}],board:['As','Ks','Qh','9d','7c'],potSize:2,minBet:1,chipUnit:1,betSizes:[.5],raiseSizes:[],maxRaises:0,includeAllIn:false,solver:{maxIterations:20000,targetPotPct:0}};}
// Independent exhaustive enumeration of pure information-set policies. Each own hand
// chooses one action per public history, shared across all compatible opponent hands.
function exhaustiveBR(game,opponent,player){
  const infos=[];for(const n of game.tree.nodes)if(n.actor===player)for(let h=0;h<game.hands[player].length;h++)infos.push([n.id,h,n.actions.length]);
  let best=-Infinity;const choices=new Map();
  function evaluate(){
    function visit(id,d){const n=game.tree.nodes[id];if(n.kind==='terminal')return game.utilities[id][d]*(player===0?1:-1);
      if(n.actor===player)return visit(n.actions[choices.get(`${id}:${game.deals[d].hands[player]}`)].nodeId,d);
      return n.actions.reduce((sum,a,j)=>sum+opponent[id][game.deals[d].hands[n.actor]*n.actions.length+j]*visit(a.nodeId,d),0);
    }
    return game.deals.reduce((sum,d,j)=>sum+d.probability*visit(0,j),0);
  }
  function enumerate(i){if(i===infos.length){best=Math.max(best,evaluate());return;}const [id,h,A]=infos[i];for(let a=0;a<A;a++){choices.set(`${id}:${h}`,a);enumerate(i+1);}}
  enumerate(0);return best;
}
test('River benchmark is the six-deal Kuhn game and converges to its analytic value',()=>{
  const input=benchmark(),game=prepareRiverGame(input),r=solveRiverTree(input);
  assert.equal(game.deals.length,6);assert.equal(r.iterationsCompleted,20000);
  near(r.metrics.expectedNet[0],17/18,.003);near(r.metrics.expectedNet[1],19/18,.003);
  assert.ok(r.metrics.exploitability<.005);assert.ok(r.metrics.exploitability<r.history[0].exploitability/10);
  assert.equal(r.stopReason,'iteration-limit');assert.equal(r.targetReached,false);
  const middle=r.metrics.nodePolicies[0].combos.find(c=>c.cards.includes('3h'));
  assert.ok(middle.frequencies[1]<.01);
});
test('Exact best responses agree with independent exhaustive pure-policy search',()=>{
  const game=prepareRiverGame(benchmark()),policy=uniformPolicy(game);
  // Asymmetric policies exercise opponent posterior conditioning beyond uniform play.
  for(const n of game.tree.nodes)if(n.kind==='decision')for(let h=0;h<game.hands[n.actor].length;h++){
    policy[n.id][h*2]=(.15+.21*h);policy[n.id][h*2+1]=1-policy[n.id][h*2];
  }
  for(let p=0;p<2;p++)near(bestResponse(game,policy,p),exhaustiveBR(game,policy,p));
  function clairvoyant(id,d,p){const n=game.tree.nodes[id];if(n.kind==='terminal')return game.utilities[id][d]*(p===0?1:-1);
    const values=n.actions.map(a=>clairvoyant(a.nodeId,d,p));return n.actor===p?Math.max(...values):values.reduce((s,v,a)=>s+policy[id][game.deals[d].hands[n.actor]*n.actions.length+a]*v,0);}
  const cheating=game.deals.reduce((s,d,i)=>s+d.probability*clairvoyant(0,i,0),0);
  assert.ok(cheating>bestResponse(game,policy,0)+.01,'Private opponent cards must not be revealed to a best response.');
});
test('Strategy probabilities, unilateral gains and root accounting remain consistent',()=>{
  const input=benchmark();input.solver={maxIterations:1000,targetPotPct:0};const r=solveRiverTree(input);
  near(r.metrics.expectedNet.reduce((a,b)=>a+b),2);near(r.metrics.nashConv,r.metrics.exploitability*2);
  r.metrics.deviationGains.forEach((v,p)=>near(v,r.metrics.bestResponseNet[p]-r.metrics.expectedNet[p]));
  for(const n of r.metrics.nodePolicies){near(n.combos.reduce((s,c)=>s+c.reachProbability,0),n.reachProbability);
    for(const c of n.combos){near(c.frequencies.reduce((a,b)=>a+b),1);assert.ok(c.frequencies.every(x=>Number.isFinite(x)&&x>=0&&x<=1));}
    n.frequencies.forEach((f,a)=>near(f,n.combos.reduce((s,c)=>s+c.conditionalProbability*c.frequencies[a],0)));
  }
});
test('Blockers condition weighted priors jointly before strategic play',()=>{
  const input=benchmark();input.players[0].input.range='2h2c@25%,3h3c@75%';input.players[1].input.range='2h2c@50%,4h4c@50%';
  const g=prepareRiverGame(input);assert.equal(g.deals.length,3);
  const h=g.hands[0].findIndex(c=>c.includes('2h'));near(g.prior[0][h],1/7);
});
test('Unreachable opponent paths have null EV, own zero reach keeps counterfactual values',()=>{
  const g=prepareRiverGame(benchmark()),policy=uniformPolicy(g);
  // OOP always bets. The IP after-check node is unreachable from opponent play.
  policy[0].fill(0);for(let h=0;h<g.hands[0].length;h++)policy[0][h*2+1]=1;
  let a=assessPolicy(g,policy,true),afterCheck=g.tree.nodes[0].actions[0].nodeId;
  const unreachable=a.nodePolicies.find(n=>n.nodeId===afterCheck);
  assert.equal(unreachable.reachProbability,0);assert.ok(unreachable.combos.every(c=>c.valueKind==='unreachable'&&c.actionEv.every(v=>v===null)));
  const ownOffpath=a.nodePolicies.find(n=>n.actor===0&&n.nodeId!==0);
  assert.ok(ownOffpath.combos.every(c=>c.valueKind==='counterfactual-only'&&c.actionEv.every(Number.isFinite)));
});
test('Scaling chip denomination scales EV and exploitability without changing strategy',()=>{
  const a=benchmark();a.solver={maxIterations:500,targetPotPct:0};const b=structuredClone(a);
  b.potSize*=10;b.minBet*=10;b.chipUnit*=10;b.players.forEach(p=>p.stack*=10);
  const x=solveRiverTree(a),y=solveRiverTree(b);near(y.metrics.exploitability,10*x.metrics.exploitability);
  x.metrics.nodePolicies.forEach((n,i)=>n.combos.forEach((c,h)=>c.frequencies.forEach((v,a)=>near(v,y.metrics.nodePolicies[i].combos[h].frequencies[a]))));
});
test('Check-only odd-chip showdown is already solved, with no invented iterations',()=>{
  const i=benchmark();i.board=['As','Ks','Qs','Js','Ts'];i.potSize=3;i.betSizes=[];
  const r=solveRiverTree(i);assert.equal(r.iterationsCompleted,0);assert.equal(r.targetReached,true);assert.deepEqual(r.metrics.expectedNet,[2,1]);assert.equal(r.metrics.exploitability,0);
});
test('Solved action EV equals independent forced-action continuation evaluation',()=>{
  const g=prepareRiverGame(benchmark()),policy=uniformPolicy(g),values=profileValues(g,policy),a=assessPolicy(g,policy,true);
  for(const c of a.nodePolicies[0].combos){const h=g.hands[0].findIndex(cards=>cards.join()===c.cards.join());
    const deals=g.deals.map((d,i)=>[d,i]).filter(([d])=>d.hands[0]===h),mass=deals.reduce((s,[d])=>s+d.probability,0);
    g.tree.nodes[0].actions.forEach((action,j)=>near(c.actionEv[j],(deals.reduce((s,[d,i])=>s+d.probability*values[action.nodeId][i],0)/mass+.5)*2));
  }
});
for(const value of [null,[],{maxIterations:0},{maxIterations:99},{maxIterations:20001},{maxIterations:100.5},{maxIterations:'100'},{targetPotPct:-1},{targetPotPct:6},{targetPotPct:NaN},{targetPotPct:'1'}])test(`Rejects invalid solver options ${JSON.stringify(value)}`,()=>assert.throws(()=>solveRiverTree({...benchmark(),solver:value}),{name:'ValidationError'}));
test('Rejects missing input and oversized exact workload explicitly',()=>{
  assert.throws(()=>solveRiverTree(null),{name:'ValidationError'});
  const input=benchmark();input.players.forEach(p=>p.input.range='random');assert.throws(()=>solveRiverTree(input),/limit|Narrow/);
  const big=benchmark();big.players.forEach(p=>p.input.range='22,33,44,55');assert.throws(()=>solveRiverTree(big),/work budget/);
});
test('Deterministic CFR and target stopping report the policy actually assessed',()=>{
  const i=benchmark();i.solver={maxIterations:2000,targetPotPct:.5};const a=solveRiverTree(i),b=solveRiverTree(i);
  assert.deepEqual(a.metrics,b.metrics);assert.deepEqual(a.history,b.history);assert.equal(a.targetReached,true);
  near(a.metrics.exploitability,a.history.at(-1).exploitability);assert.ok(a.iterationsCompleted<=2000);
});
test('Solver runs in the real CPU worker and preview API rejects invalid input',async()=>{
  const input=benchmark();input.solver={maxIterations:100,targetPotPct:0};
  const pool=new ComputePool();try{assert.equal((await pool.run('riverSolve',input)).iterationsCompleted,100);}finally{await pool.close();}
  const server=createPreviewApp({NODE_ENV:'development'}).listen(0,'127.0.0.1');await once(server,'listening');
  try{const url=`http://127.0.0.1:${server.address().port}/api/river-solve`;
    const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});assert.equal(r.status,200);assert.equal((await r.json()).solution.jointDeals,6);
    const bad=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(bad.status,400);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('New solver endpoint preserves production authentication and compute failure statuses',async()=>{
  const {createApp}=require('../../server'),{createAuth}=require('../../auth'),express=require('express'),{ComputeError}=require('../../compute/pool');
  const auth=createAuth({config:{secret:'solver-test-only-secret-long-enough',origins:[],secure:false,cookieName:'solver_test'},delivery:{config:{channels:[]}}});
  let calls=0;const denied=createApp({auth,compute:async()=>{calls++;}}).listen(0,'127.0.0.1');await once(denied,'listening');
  try{const r=await fetch(`http://127.0.0.1:${denied.address().port}/api/river-solve`,{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'RiverPokerLab'},body:JSON.stringify(benchmark())});assert.equal(r.status,401);assert.equal(calls,0);}finally{denied.closeAllConnections();await new Promise(r=>denied.close(r));}
  const stub={router:express.Router(),config:{origins:[]},middleware(req,res,next){req.user={id:'fixture'};next();}};
  for(const status of [503,504]){
    const server=createApp({auth:stub,compute:async(req,res,kind)=>{assert.equal(kind,'riverSolve');throw new ComputeError('Fixture compute failure','TEST',status);}}).listen(0,'127.0.0.1');await once(server,'listening');
    try{const r=await fetch(`http://127.0.0.1:${server.address().port}/api/river-solve`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(r.status,status);assert.equal(r.headers.get('retry-after'),'1');assert.equal((await r.json()).success,false);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
  }
});
test('Best-response calculation also matches exhaustive play with raised fixed-hand trees',()=>{
  const input=benchmark();input.players[0].input=['Ah','Ac'];input.players[1].input=['Kh','Kc'];input.players.forEach(p=>p.stack=4);input.board=['2s','3d','7h','8c','9s'];input.maxRaises=1;input.raiseSizes=[.5];input.includeAllIn=true;
  const g=prepareRiverGame(input),policy=uniformPolicy(g);
  // Fixed private hands reduce each information set to a singleton. A separate
  // perfect-information dynamic program then gives an independent raised-tree BR.
  function visit(id,p){const n=g.tree.nodes[id];if(n.kind==='terminal')return g.utilities[id][0]*(p===0?1:-1);const v=n.actions.map(a=>visit(a.nodeId,p));return n.actor===p?Math.max(...v):v.reduce((s,x)=>s+x/v.length,0);}
  for(let p=0;p<2;p++)near(bestResponse(g,policy,p),visit(0,p));
  near(assessPolicy(g,policy).expectedNet.reduce((a,b)=>a+b),2);
});
