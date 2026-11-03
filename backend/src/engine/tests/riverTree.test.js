const {test}=require('node:test');
const assert=require('node:assert/strict');
const {once}=require('node:events');
const {buildRiverTree}=require('../riverTree');
const {createApp}=require('../../server');
const {createPreviewApp}=require('../../dev/preview');
const {ComputePool}=require('../../compute/pool');
const base=()=>({gameType:'holdem',gameMode:'cash',players:[{name:'OOP',stack:200,input:['Ah','Ac']},{name:'IP',stack:200,input:['Kh','Kc']}],board:['2s','3d','7h','8c','9s'],potSize:100,chipUnit:1,minBet:2,betSizes:[0.5,1],raiseSizes:[0.5,1],maxRaises:1,includeAllIn:true});
const child=(tree,node,type,to)=>tree.nodes[node.actions.find(a=>a.type===type&&(to===undefined||a.to===to)).nodeId];
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} differs from ${b}`);

test('River tree has a finite connected structure, no solved decision values and conserved terminal chips',()=>{
  const tree=buildRiverTree(base());assert.equal(tree.chance.jointDeals,1);assert.deepEqual(tree.chance.winProbability,[1,0]);
  const reached=new Set();function walk(n,raises=0){assert.ok(!reached.has(n.id));reached.add(n.id);
    if(n.kind==='decision'){assert.equal(n.outcome,undefined);assert.equal(n.value,undefined);assert.equal(n.strategy,undefined);assert.ok(n.actions.length>=2);
      for(const a of n.actions){assert.equal(tree.nodes[a.nodeId].parentId,n.id);assert.ok(raises+(a.type==='raise')<=1);walk(tree.nodes[a.nodeId],raises+(a.type==='raise'));}}
    else{assert.equal(n.actions.length,0);near(n.outcome.netFromRiver[0]+n.outcome.netFromRiver[1],100);near(n.outcome.endingStacks[0]+n.outcome.endingStacks[1],500);assert.ok(n.outcome.endingStacks.every(v=>v>=0));}}
  walk(tree.nodes[0]);assert.equal(reached.size,tree.nodes.length);assert.ok(tree.nodes.length<=tree.limits.nodes);
});
test('Check/check, bet/fold and bet/call use the river-start baseline and refund uncalled chips',()=>{
  const tree=buildRiverTree(base()),root=tree.nodes[0];
  assert.deepEqual(child(tree,child(tree,root,'check'),'check').outcome.netFromRiver,[100,0]);
  const bet=child(tree,root,'bet',50);assert.equal(bet.actor,1);assert.equal(bet.toCall,50);
  const folded=child(tree,bet,'fold');assert.deepEqual(folded.outcome.refunds,[50,0]);assert.equal(folded.outcome.contestPot,100);assert.deepEqual(folded.outcome.netFromRiver,[100,0]);
  const called=child(tree,bet,'call');assert.deepEqual(called.outcome.refunds,[0,0]);assert.equal(called.outcome.contestPot,200);assert.deepEqual(called.outcome.netFromRiver,[150,-50]);
  const ipBet=child(tree,child(tree,root,'check'),'bet',50),oopFold=child(tree,ipBet,'fold');assert.deepEqual(oopFold.outcome.refunds,[0,50]);assert.deepEqual(oopFold.outcome.netFromRiver,[0,100]);
});
test('Raise sizing uses the pot after calling and raised folds return only the unmatched increment',()=>{
  const tree=buildRiverTree(base());const bet=child(tree,tree.nodes[0],'bet',50);
  assert.equal(bet.minRaiseTo,100);
  const raised=child(tree,bet,'raise',150);assert.equal(raised.actor,0);assert.equal(raised.toCall,100);assert.deepEqual(raised.actions.map(a=>a.type),['fold','call']);
  const fold=child(tree,raised,'fold');assert.equal(fold.outcome.contestPot,200);assert.deepEqual(fold.outcome.refunds,[0,100]);assert.deepEqual(fold.outcome.netFromRiver,[-50,150]);
  const call=child(tree,raised,'call');assert.equal(call.outcome.contestPot,400);assert.deepEqual(call.outcome.netFromRiver,[250,-150]);
});
test('Chip rounding merges oversized sizes and unequal stacks retain uncontested chips behind',()=>{
  const input=base();input.players[0].stack=500;input.players[1].stack=50;input.betSizes=[0.5,1,2];
  const tree=buildRiverTree(input);const bets=tree.nodes[0].actions.filter(a=>a.type==='bet');assert.equal(bets.length,1);assert.equal(bets[0].to,50);
  const call=child(tree,child(tree,tree.nodes[0],'bet',50),'call');assert.deepEqual(call.outcome.endingStacks,[650,0]);
  input.players[1].stack=200;input.potSize=101;input.chipUnit=1;input.betSizes=[0.5];input.includeAllIn=false;
  assert.equal(buildRiverTree(input).nodes[0].actions.find(a=>a.type==='bet').to,51);
});
test('Below-minimum sizes are omitted; a short effective all-in is legal, without re-raising',()=>{
  const input=base();input.betSizes=[0.01];input.raiseSizes=[0.01];input.includeAllIn=false;
  const tree=buildRiverTree(input);assert.deepEqual(tree.nodes[0].actions.map(a=>a.type),['check']);assert.ok(tree.nodes[0].omitted.length);
  input.players[0].stack=1;input.players[1].stack=1;input.includeAllIn=true;
  const short=buildRiverTree(input),reply=child(short,short.nodes[0],'bet',1);assert.deepEqual(reply.actions.map(a=>a.type),['fold','call']);
  const minRaise=base();minRaise.betSizes=[0.5];minRaise.raiseSizes=[0.1];minRaise.includeAllIn=false;
  const t=buildRiverTree(minRaise),r=child(t,t.nodes[0],'bet',50);assert.deepEqual(r.actions.map(a=>a.type),['fold','call']);
});
test('Tied showdowns allocate the odd denomination to OOP, including after a called bet',()=>{
  const input=base();input.board=['As','Ks','Qs','Js','Ts'];input.potSize=101;
  const tree=buildRiverTree(input),leaf=child(tree,child(tree,tree.nodes[0],'check'),'check');
  assert.equal(tree.chance.tieProbability,1);assert.deepEqual(leaf.outcome.expectedAwards,[51,50]);
  const bet=tree.nodes[0].actions.find(a=>a.type==='bet'),called=child(tree,tree.nodes[bet.nodeId],'call');
  near(called.outcome.netFromRiver[0],51);near(called.outcome.netFromRiver[1],50);
});
test('Weighted private ranges are exact product priors and are not silently reconditioned by tree actions',()=>{
  const input=base();input.players[0].input={type:'range',range:'AhAc@25%,ThTc@75%'};input.players[1].input=['Qh','Qc'];
  const tree=buildRiverTree(input);assert.equal(tree.chance.jointDeals,2);near(tree.chance.winProbability[0],0.25);near(tree.chance.winProbability[1],0.75);
  const bet=child(tree,tree.nodes[0],'bet',50),call=child(tree,bet,'call');near(call.outcome.netFromRiver[0],0);near(call.outcome.netFromRiver[1],100);
  const profiles=base();profiles.players[0].input={type:'range',range:'AhAc,ThTc',actionRanges:{call:'AhAc@25%,ThTc@75%'},rangeAction:'call'};profiles.players[1].input=['Qh','Qc'];
  near(buildRiverTree(profiles).chance.winProbability[0],0.25);
});
test('Mutual range collisions condition the joint prior rather than independent player marginals',()=>{
  const input=base();input.players[0].input={type:'range',range:'AhAc,KhKc'};input.players[1].input={type:'range',range:'AhAc,QhQc'};
  const t=buildRiverTree(input);assert.equal(t.chance.jointDeals,3);near(t.chance.winProbability[0],2/3);
});
test('Raise cap zero and no configured bets produce a valid check/check abstraction',()=>{
  const input=base();input.betSizes=[];input.raiseSizes=[];input.includeAllIn=false;input.maxRaises=0;
  const t=buildRiverTree(input);assert.equal(t.summary.nodes,3);assert.equal(t.summary.terminals,1);
  const full=base();full.maxRaises=0;assert.ok(buildRiverTree(full).nodes.every(n=>n.actions.every(a=>a.type!=='raise')));
});
const invalid=[
  ['null',null],['null sizes',{betSizes:null}],['null unit',{chipUnit:null}],['null flag',{includeAllIn:null}],['null raise cap',{maxRaises:null}],['Omaha',{gameType:'omaha'}],['tournament',{gameMode:'tournament'}],['flop',{board:['2s','3d','7h']}],['duplicate board',{board:['2s','2s','7h','8c','9s']}],
  ['missing players',{players:[]}],['negative pot',{potSize:-1}],['zero pot',{potSize:0}],['string pot',{potSize:'100'}],['infinite pot',{potSize:Infinity}],['zero unit',{chipUnit:0}],['misaligned pot',{potSize:100.1,chipUnit:1}],['raise cap',{maxRaises:2}],['string flag',{includeAllIn:'true'}],['duplicate sizes',{betSizes:[0.5,0.5]}],['too many bets',{betSizes:[0.1,0.2,0.3,0.4]}],['too many raises',{raiseSizes:[0.5,1,2]}],['invalid fraction',{raiseSizes:[NaN]}],['excessive fraction',{betSizes:[11]}],['outstanding ledger',{betting:{}}],
];
for(const [name,changes] of invalid)test(`Rejects unsupported or malformed river input: ${name}`,()=>assert.throws(()=>buildRiverTree(changes===null?null:{...base(),...changes}),{name:'ValidationError'}));
test('Exact work overflow fails explicitly without returning a partial tree',()=>{
  const input=base();input.players[0].input={type:'range',range:'random'};input.players[1].input={type:'range',range:'random'};
  assert.throws(()=>buildRiverTree(input),/limit|Narrow/);
});
test('Real worker and authenticated API return the tree; anonymous API access stays protected',async()=>{
  const pool=new ComputePool();try{const tree=await pool.run('riverTree',base());assert.equal(tree.chance.jointDeals,1);}finally{await pool.close();}
  const preview=createPreviewApp({NODE_ENV:'development'}),server=preview.listen(0,'127.0.0.1');await once(server,'listening');
  try{const r=await fetch(`http://127.0.0.1:${server.address().port}/api/river-tree`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(base())});assert.equal(r.status,200);assert.ok((await r.json()).tree.nodes.length);
    const bad=await fetch(`http://127.0.0.1:${server.address().port}/api/river-tree`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(bad.status,400);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  const app=createApp({auth:require('../../auth').createAuth({config:{secret:'river-test-secret-long-enough-never-real',origins:[],secure:false,cookieName:'river_session'},delivery:{config:{channels:[]}}})});
  const privateServer=app.listen(0,'127.0.0.1');await once(privateServer,'listening');
  try{const r=await fetch(`http://127.0.0.1:${privateServer.address().port}/api/river-tree`,{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'RiverPokerLab'},body:JSON.stringify(base())});assert.equal(r.status,401);}finally{privateServer.closeAllConnections();await new Promise(resolve=>privateServer.close(resolve));}
});
test('Two weighted ranges preserve product weights after mutual-card conditioning',()=>{
  const input=base();input.players[0].input={type:'range',range:'AhAc@25%,KhKc@75%'};input.players[1].input={type:'range',range:'AhAc@50%,QhQc@50%'};
  const t=buildRiverTree(input);assert.equal(t.chance.jointDeals,3);near(t.chance.totalMass,0.875);near(t.chance.winProbability[0],4/7);
});
test('A short all-in raise is available below the full-raise minimum and leaves only Fold/Call',()=>{
  const input=base();input.players[1].stack=75;
  const t=buildRiverTree(input),bet=child(t,t.nodes[0],'bet',50),raised=child(t,bet,'raise',75);
  assert.equal(bet.minRaiseTo,100);assert.equal(raised.toCall,25);assert.deepEqual(raised.actions.map(a=>a.type),['fold','call']);
  assert.deepEqual(child(t,raised,'fold').outcome.refunds,[0,25]);assert.deepEqual(child(t,raised,'call').outcome.netFromRiver,[175,-75]);
});
test('Odd-chip settlement uses the configured denomination, not a hardcoded whole chip',()=>{
  const input=base();input.board=['As','Ks','Qs','Js','Ts'];input.potSize=1.05;input.chipUnit=0.05;input.minBet=0.1;
  const t=buildRiverTree(input),leaf=child(t,child(t,t.nodes[0],'check'),'check');near(leaf.outcome.expectedAwards[0],0.55);near(leaf.outcome.expectedAwards[1],0.5);
});
