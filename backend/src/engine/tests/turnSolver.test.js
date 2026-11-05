const test=require('node:test'),assert=require('node:assert/strict');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
const {prepareTurnGame,assessTurnPolicy,evaluateProfile,solveTurnTree}=require('../turnSolver');
const {runEquitySimulation}=require('../engine');
const {ComputePool}=require('../../compute/pool');
const {createPreviewApp}=require('../../dev/preview');
const near=(a,b,eps=1e-9)=>assert.ok(Math.abs(a-b)<eps,`${a} != ${b}`);
const input=()=>({solverStreet:'turn',players:[{name:'OOP',stack:4,input:['Ah','Kh']},{name:'IP',stack:4,input:['Qs','Qc']}],board:['2h','7d','Th','9s'],potSize:2,chipUnit:1,minBet:1,betSizes:[.5],riverBetSizes:[.5],raiseSizes:[],maxRaises:0,includeAllIn:false,solver:{maxIterations:100,targetPotPct:0}});
const policy=g=>g.nodes.map(n=>n.policy||null);
test('Every private pair has all 44 legal equally likely rivers, with a normalized chance prior',()=>{
  const x=input();x.players[0].input={type:'range',range:'AhKh@25%,AsKs@75%'};x.players[1].input={type:'range',range:'AhAd@50%,QsQc@50%'};const g=prepareTurnGame(x);
  assert.equal(g.privateDeals,3);assert.equal(g.scenarios.length,132);near(g.scenarios.reduce((s,d)=>s+d.probability,0),1);
  const grouped=new Map();for(const d of g.scenarios){const k=d.hands.join();if(!grouped.has(k))grouped.set(k,[]);grouped.get(k).push(d);}
  for(const list of grouped.values()){assert.equal(list.length,44);assert.equal(new Set(list.map(d=>d.river)).size,44);assert.ok(list.every(d=>d.probability===list[0].probability));}
  const h=g.hands[0].findIndex(c=>c.includes('Ah'));near(g.prior[0][h],1/7);
  const a=assessTurnPolicy(g,policy(g),true),chance=g.nodes.find(n=>n.kind==='chance');
  const cards=a.publicValues.find(n=>n.nodeId===chance.id).riverProbabilities;near(cards.reduce((s,c)=>s+c.probability,0),1);near(cards.find(c=>c.card==='Ah').probability,3/308);
  const branch=g.nodes[chance.actions.find(a=>a.card==='Ah').nodeId];assert.ok(branch.handIds.every(h=>!g.hands[0][h].includes('Ah')));
});
test('Check-only turn game agrees with the independent exhaustive equity engine without double-counting chance',()=>{
  const x=input();x.betSizes=[];x.riverBetSizes=[];const r=solveTurnTree(x),equity=runEquitySimulation(x.players.map(p=>p.input),x.board,'holdem',1,{method:'exact'});
  assert.equal(r.iterationsCompleted,0);assert.equal(r.metrics.exploitability,0);assert.equal(Number((r.metrics.expectedNet[0]/2*100).toFixed(2)),equity.results[0].equity);near(r.metrics.expectedNet[0],15/22);
});
test('Best response matches an independent public-chance dynamic program for fixed private hands',()=>{
  const g=prepareTurnGame(input()),p=policy(g),a=assessTurnPolicy(g,p);
  function visit(id,player){const n=g.nodes[id],sign=player===0?1:-1;
    if(n.kind==='terminal')return sign*n.utility[0];
    const children=n.actions.map(a=>visit(a.nodeId,player));
    if(n.kind==='chance')return children.reduce((s,v)=>s+v,0)/44;
    return n.actor===player?Math.max(...children):children.reduce((s,v,j)=>s+p[n.id][j]*v,0);
  }
  for(let player=0;player<2;player++)near(a.bestResponseNet[player],(visit(0,player)+.5)*2);
  // A cheating response sees the latent future river at TURN and optimizes per scenario.
  function cheating(id,scenario,player){const n=g.nodes[id],i=n.active.indexOf(scenario),sign=player===0?1:-1;if(n.kind==='terminal')return sign*n.utility[i];
    if(n.kind==='chance'){const child=n.actions.find(a=>g.nodes[a.nodeId].active.includes(scenario));return cheating(child.nodeId,scenario,player);}
    const children=n.actions.map(a=>cheating(a.nodeId,scenario,player));return n.actor===player?Math.max(...children):children.reduce((s,v,j)=>s+p[n.id][j]*v,0);
  }
  const oracle=g.scenarios.reduce((s,d,i)=>s+d.probability*cheating(0,i,0),0);assert.ok((oracle+.5)*2>a.bestResponseNet[0]+.01,'Future river information must not enter turn best responses.');
});
test('Independent average profile integration matches the root EV and conserves the starting pot',()=>{
  const g=prepareTurnGame(input()),p=policy(g),a=assessTurnPolicy(g,p,true);
  function visit(id){const n=g.nodes[id];if(n.kind==='terminal')return n.utility[0];if(n.kind==='chance')return n.actions.reduce((s,a)=>s+visit(a.nodeId),0)/44;return n.actions.reduce((s,a,j)=>s+p[id][j]*visit(a.nodeId),0);}
  near(a.expectedNet[0],(visit(0)+.5)*2);near(a.expectedNet[0]+a.expectedNet[1],2);
  for(const n of a.nodePolicies){near(n.combos.reduce((s,c)=>s+c.reachProbability,0),n.reachProbability);for(const c of n.combos)near(c.frequencies.reduce((s,f)=>s+f,0),1);}
});
test('Chance-card frequencies use solved turn posteriors rather than unchanged input priors',()=>{
  const x=input();x.players[0].input={type:'range',range:'AhKh,AsKs'};x.players[1].input=['Qs','Qc'];const g=prepareTurnGame(x),p=policy(g);
  const h=g.hands[0].findIndex(c=>c.includes('Ah')),A=g.nodes[0].actions.length;
  for(let hand=0;hand<g.hands[0].length;hand++){p[0][hand*A]=hand===h?1:0;p[0][hand*A+1]=hand===h?0:1;}
  const checked=g.nodes[g.nodes[0].actions[0].nodeId],chance=g.nodes[checked.actions[0].nodeId],result=assessTurnPolicy(g,p,true);
  const cards=result.publicValues.find(n=>n.nodeId===chance.id).riverProbabilities;assert.ok(!cards.some(c=>c.card==='Ah'&&c.probability>0));near(cards.reduce((s,c)=>s+c.probability,0),1);
});
test('Turn all-in call has a river chance reveal followed directly by settlement, without phantom betting',()=>{
  const x=input();x.players.forEach(p=>p.stack=1);x.includeAllIn=true;const g=prepareTurnGame(x),bet=g.nodes[0].actions.find(a=>a.type==='bet'),response=g.nodes[bet.nodeId];
  const fold=g.nodes[response.actions.find(a=>a.type==='fold').nodeId];near((fold.utility[0]+.5)*2,2);near(fold.outcome.refunds[0],1);
  const chance=g.nodes[response.actions.find(a=>a.type==='call').nodeId];assert.equal(chance.kind,'chance');assert.equal(chance.actions.length,44);assert.ok(chance.actions.every(a=>g.nodes[a.nodeId].kind==='terminal'));
});
test('Split settlement respects chip denomination and the original TURN-start baseline',()=>{
  const x=input();x.board=['As','Ks','Qs','Js'];x.players[0].input=['2h','2c'];x.players[1].input=['3h','3c'];x.potSize=1.05;x.chipUnit=.05;x.minBet=.1;x.betSizes=[];x.riverBetSizes=[];
  const r=solveTurnTree(x),chance=r.turnTree.nodes.find(n=>n.kind==='chance'),river=r.turnTree.nodes[chance.actions.find(a=>a.card==='Ts').nodeId];let leaf=river;while(leaf.kind!=='terminal')leaf=r.turnTree.nodes[leaf.actions[0].nodeId];
  const value=r.metrics.publicValues.find(v=>v.nodeId===leaf.id);near(value.net[0],.55);near(value.net[1],.5);near(r.metrics.expectedNet[0]+r.metrics.expectedNet[1],1.05);
});
test('All river continuations preserve their public turn histories rather than merging equal-pot subgames',()=>{
  const g=prepareTurnGame(input()),chance=g.nodes.filter(n=>n.kind==='chance');assert.equal(chance.length,3);
  const withBet=chance.filter(n=>n.pot===4);assert.equal(withBet.length,2);assert.notEqual(withBet[0].actions[0].nodeId,withBet[1].actions[0].nodeId);
});
test('CFR is deterministic, preserves probabilities and reduces measured exploitability',()=>{
  const x=input();x.solver.maxIterations=500;const a=solveTurnTree(x),b=solveTurnTree(x);assert.deepEqual(a.metrics,b.metrics);assert.deepEqual(a.history,b.history);
  assert.ok(a.metrics.exploitability<a.history[0].exploitability);near(a.metrics.expectedNet[0]+a.metrics.expectedNet[1],2);
  assert.equal(a.iterationsCompleted,500);assert.equal(a.targetReached,false);
});
for(const changes of [{board:['2h','7d','Th']},{board:['2h','7d','Th','9s','Ac']},{maxRaises:1},{raiseSizes:[.5]},{betSizes:[.5,1]},{riverBetSizes:null},{gameType:'omaha'},{gameMode:'tournament'},{solver:{maxIterations:2001}},{players:[{name:'OOP',stack:4,input:{type:'range',range:'random'}},{name:'IP',stack:4,input:{type:'range',range:'random'}}]}])test(`Rejects unsupported turn input ${JSON.stringify(changes).slice(0,70)}`,()=>assert.throws(()=>solveTurnTree({...input(),...changes}),{name:'ValidationError'}));
test('Turn background jobs use the real bounded worker and local preview preserves scope',async()=>{
  const pool=new ComputePool();try{const r=await pool.run('turnSolve',input());assert.equal(r.scope,'heads-up-turn-river-holdem-cash');assert.equal(r.jointDeals,44);}finally{await pool.close();}
  const server=createPreviewApp({NODE_ENV:'development'}).listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
  try{const response=await fetch(base+'/api/river-jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({input:input(),requestId:randomUUID()})});assert.equal(response.status,202);const id=(await response.json()).job.id;let j;
    for(let i=0;i<150;i++){j=(await(await fetch(base+'/api/river-jobs/'+id)).json()).job;if(!['queued','running'].includes(j.status))break;await new Promise(r=>setTimeout(r,10));}
    assert.equal(j.status,'completed');assert.equal(j.solution.scope,'heads-up-turn-river-holdem-cash');assert.equal(j.progress.completedIterations,j.solution.iterationsCompleted);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('River refunds and calls retain both-street contributions in the TURN-start EV',()=>{
  const g=prepareTurnGame(input()),bet=g.nodes[g.nodes[0].actions.find(a=>a.type==='bet').nodeId],chance=g.nodes[bet.actions.find(a=>a.type==='call').nodeId];
  const river=g.nodes[chance.actions.find(a=>a.card==='5h').nodeId],response=g.nodes[river.actions.find(a=>a.type==='bet').nodeId];
  const fold=g.nodes[response.actions.find(a=>a.type==='fold').nodeId],call=g.nodes[response.actions.find(a=>a.type==='call').nodeId];
  near(fold.contributions[0],3);near(fold.outcome.refunds[0],2);near((fold.utility[0]+.5)*g.P,3);near((call.utility[0]+.5)*g.P,5);
});
test('Turn work overflow rejects a complete request before strategy iterations',()=>{
  const x=input();x.players[0].input={type:'range',range:'AhKh,AdKd,AcKc,AsKs'};x.players[1].input={type:'range',range:'QsQc,QsQd,QhQc,QhQd'};x.includeAllIn=true;x.solver.maxIterations=2000;
  assert.throws(()=>solveTurnTree(x),/budget|limit/);
});
test('Weighted river-only continuations equal independently solved river best responses after exact public chance conditioning',()=>{
  const {prepareRiverGame,uniformPolicy,assessPolicy}=require('../riverSolver');
  const x=input();x.betSizes=[];x.players[0].input={type:'range',range:'AhKh@25%,AsKs@75%'};x.players[1].input={type:'range',range:'AhAd@50%,QsQc@50%'};
  const g=prepareTurnGame(x),a=assessTurnPolicy(g,policy(g)),chance=new Map();for(const d of g.scenarios)chance.set(d.river,(chance.get(d.river)||0)+d.probability);
  const net=[0,0],br=[0,0];for(const [river,q] of chance){const r=prepareRiverGame({...x,board:[...x.board,require('../card').cardToString(river)],betSizes:x.riverBetSizes});const v=assessPolicy(r,uniformPolicy(r));for(let p=0;p<2;p++){net[p]+=q*v.expectedNet[p];br[p]+=q*v.bestResponseNet[p];}}
  for(let p=0;p<2;p++){near(a.expectedNet[p],net[p]);near(a.bestResponseNet[p],br[p]);}
});
test('The 16-pair boundary enumerates every scenario; broader private ranges fail without truncation',()=>{
  const x=input();x.players[0].input={type:'range',range:'AhKh,AdKd,AcKc,AsKs'};x.players[1].input={type:'range',range:'QsQc,QsQd,QhQc,QhQd'};
  const g=prepareTurnGame(x);assert.equal(g.privateDeals,16);assert.equal(g.scenarios.length,704);
  x.players[1].input.range+=',QhQs';assert.throws(()=>prepareTurnGame(x),/private-deal limit/);
});
