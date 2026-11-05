const test=require('node:test'),assert=require('node:assert/strict');
const {once}=require('node:events');
const {compareTournamentTree,LIMITS}=require('../tournamentTree');
const {resolveTournamentOutcome}=require('../tournament');
const {calculateICM}=require('../icm');
const {createApiClient,parseValuation,buildTournamentTreeRequest}=require('@river-poker-lab/core');
const passive={check:1,call:1,fold:1,bet:0,raise:0,allin:0};
function input(street='river'){
 return {analysisKind:'fixed-policy-icm',street,spot:{gameType:'holdem',gameMode:'tournament',solverStreet:street,players:[{name:'Hero',stack:98,input:street==='turn'?['9s','9d']:['Qh','Qc']},{name:'IP',stack:98,input:street==='turn'?['Ah','Kh']:{type:'range',range:'AhAc@40%,ThTc@60%'}}],board:street==='turn'?['Jh','Th','2c','8s']:['2s','3d','7h','8c','9s'],potSize:4,minBet:2,chipUnit:1,betSizes:[],riverBetSizes:[],maxRaises:0,raiseSizes:[],includeAllIn:true},tournament:{fieldConfirmed:true,handStartStacks:[100,100],otherPlayers:[{name:'Outside',stack:98}],payouts:[50,50,0],eliminationRule:'starting-stack-split'},responsePolicy:{confirmed:true,players:[{turn:passive,river:passive},{turn:street==='turn'?{...passive,check:0,allin:1}:passive,river:street==='river'?{...passive,check:0,allin:1}:passive}]}};
}
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
function facing(a,street=a.street){const n=a.tree.find(n=>n.actor===0&&n.street===street&&n.toCall>0);return a.nodes[n.id];}
for(const street of ['turn','river'])test(`${street}: exact bubble call wins chips but loses prizes, with full field conservation`,()=>{
 const request=input(street),a=compareTournamentTree(request),n=facing(a),fold=n.actions.find(a=>a.type==='fold'),call=n.actions.find(a=>a.type==='call');
 assert.ok(call.deltaChips>0);assert.ok(call.deltaPrize<0);assert.deepEqual(n.preferredActions,[fold.index]);assert.equal(a.valuation.kind,'icm-tree-ev');assert.equal(parseValuation(a.valuation).evaluation,'fixed-response-policy');assert.equal(a.metrics,undefined);assert.equal(a.exploitability,undefined);
 const foldValue=resolveTournamentOutcome([98,102,98],[100,100,98],[50,50,0]).values;fold.expectedPrizes.forEach((v,i)=>close(v,foldValue[i]));
 close(call.expectedPrizes[2],50);assert.ok(Math.abs(fold.expectedPrizes[2]-call.expectedPrizes[2])>1);
 for(const value of a.nodes){if(value.reachProbability>0)close(value.expectedPrizes.reduce((x,y)=>x+y,0),100);for(const action of value.actions||[])if(value.reachProbability>0)close(action.expectedPrizes.reduce((x,y)=>x+y,0),100);}
 assert.equal(a.scenarios,street==='turn'?44:2);assert.ok(a.nodeDealVisits<=LIMITS.nodeDealVisits);
 if(street==='river')close(call.prizeEv,30);else close(call.prizeEv,50*26/44);
});
test('ICM is averaged over terminal stacks, never applied to the mean stack',()=>{
 const a=compareTournamentTree(input()),call=facing(a).actions.find(a=>a.type==='call'),averaged=calculateICM({players:[{name:'Hero',stack:120},{name:'IP',stack:80},{name:'Outside',stack:98}],payouts:[50,50,0]}).results[0].prizeEquity;
 assert.ok(Math.abs(call.prizeEv-averaged)>1);close(call.prizeEv,.6*50+.4*0);
});
test('Node aggregation uses the reached range and combo overrides change opponent beliefs',()=>{
 const r=input();r.responsePolicy.players[1].combos=[{cards:['Th','Tc'],river:{check:1,allin:0,call:1,fold:1}}];
 const a=compareTournamentTree(r),n=facing(a);close(n.reachProbability,.4);close(n.actions.find(a=>a.type==='call').prizeEv,0);
 const ip=a.nodes.find(n=>n.actor===1&&a.tree[n.nodeId].parentId===0);assert.equal(ip.combos.length,2);assert.ok(ip.combos.some(c=>c.frequencies.some(f=>f===0)));
});
test('Zero own reach has counterfactual combo values but no aggregate recommendation',()=>{
 const r=input();r.responsePolicy.players[0]={turn:{...passive,check:0,allin:1},river:{...passive,check:0,allin:1}};
 const a=compareTournamentTree(r),n=facing(a);close(n.reachProbability,0);assert.deepEqual(n.preferredActions,[]);assert.ok(n.actions.every(a=>a.prizeEv===null&&a.chipNet===null));assert.equal(n.combos[0].valueKind,'counterfactual-only');assert.ok(n.combos[0].prizeEv.every(v=>v!==null));
});
test('A zero opponent reach is unreachable, not a fabricated EV',()=>{
 const r=input();r.responsePolicy.players[1]={turn:passive,river:{...passive,check:1,allin:0}};const a=compareTournamentTree(r),n=facing(a);assert.equal(n.combos[0].valueKind,'unreachable');assert.ok(n.combos[0].prizeEv.every(v=>v===null));
});
test('Turn chance probabilities normalize over hidden private blockers and every legal river',()=>{
 const r=input('turn');r.responsePolicy.players=r.responsePolicy.players.map(()=>({turn:passive,river:passive}));r.spot.players[1].input={type:'range',range:'AhKh@25%,AdKd@75%'};
 const a=compareTournamentTree(r),chance=a.tree.find(n=>n.kind==='chance'&&a.nodes[n.id].reachProbability>0),v=a.nodes[chance.id];close(v.riverProbabilities.reduce((s,v)=>s+v.probability,0),1);
 const ah=v.riverProbabilities.find(v=>v.card==='Ah');close(ah.probability,.75/44);assert.equal(a.scenarios,88);assert.equal(a.tree[0].street,'turn');
});
test('Both-street chip baselines preserve the starting pot and full-field prize total',()=>{
 const r=input('turn');r.spot.betSizes=[.5];r.spot.riverBetSizes=[.5];r.spot.includeAllIn=false;r.responsePolicy.players=r.responsePolicy.players.map(()=>({turn:{check:1,bet:1,call:1,fold:1},river:{check:1,bet:1,call:1,fold:1}}));const a=compareTournamentTree(r),root=a.nodes[0];
 for(const action of root.actions)close(action.expectedPrizes.reduce((s,v)=>s+v,0),100);
 assert.ok(a.tree.some(n=>n.street==='river'&&n.contributions.some(c=>c>0)));
 assert.ok(root.actions.every(v=>Number.isFinite(v.chipNet)));
});
test('Uncalled all-in refunds and odd split chips conserve actual stacks',()=>{
 const r=input();r.spot.players[0].stack=9;r.spot.players[1].stack=4;r.spot.potSize=3;r.spot.players[0].input=['Ah','Ad'];r.spot.players[1].input=['Kh','Kd'];r.spot.board=['2s','3s','4s','5s','6s'];r.spot.minBet=1;r.tournament.handStartStacks=[11,5];r.tournament.otherPlayers=[{name:'Outside',stack:8}];r.tournament.payouts=[12,6,0];
 const a=compareTournamentTree(r),n=facing(a),call=n.actions.find(v=>v.type==='call');const expected=resolveTournamentOutcome([11,5,8],[11,5,8],[12,6,0]).values; // contest pot11 splits6/5; OOP ends9-4+6=11; IP4-4+5=5.
 call.expectedPrizes.forEach((v,i)=>close(v,expected[i]));close(call.chipNet,2);assert.ok(a.tree.some(n=>n.kind==='terminal'));
});
test('Independent two-street terminal recursion agrees with all-field root prizes and chip action values',()=>{
 const r=input('turn');r.spot.betSizes=[.5];r.spot.riverBetSizes=[.5];r.spot.includeAllIn=true;
 const weights={check:2,bet:3,raise:1,call:4,fold:1,allin:1};r.responsePolicy.players=[{turn:weights,river:weights},{turn:weights,river:weights}];
 const a=compareTournamentTree(r),{cardFromString,cardToString}=require('../card'),{evaluatePlayer}=require('../engine');
 const board=r.spot.board.map(cardFromString),hands=r.spot.players.map(p=>p.input.map(cardFromString)),used=new Set([...board,...hands.flat()]),rivers=Array.from({length:52},(_,i)=>i).filter(c=>!used.has(c));
 function walk(id,river){const n=a.tree[id];if(n.kind==='chance')return walk(n.actions.find(v=>v.card===cardToString(river)).nodeId,river);
  if(n.kind==='terminal'){
   const folded=n.incoming==='Fold',scores=hands.map(h=>evaluatePlayer(h,[...board,river],'holdem')),winner=folded?1-a.tree[n.parentId].actor:scores[0]===scores[1]?null:scores[0]>scores[1]?0:1;
   const c=n.contributions,matched=Math.min(...c),pot=4+2*matched,awards=winner===null?[Math.ceil(pot/2),Math.floor(pot/2)]:winner===0?[pot,0]:[0,pot];
   const final=folded?[98+(winner===0?4+c[1]:-c[0]),98+(winner===1?4+c[0]:-c[1]),98]:[98-matched+awards[0],98-matched+awards[1],98];
   return [...resolveTournamentOutcome(final,[100,100,98],[50,50,0]).values,final[0]-98];
  }
  const raw=n.actions.map(v=>weights[(v.type==='bet'||v.type==='raise')&&v.effectiveAllIn?'allin':v.type]),sum=raw.reduce((s,v)=>s+v,0),out=[0,0,0,0];n.actions.forEach((v,i)=>walk(v.nodeId,river).forEach((x,p)=>out[p]+=x*raw[i]/sum));return out;
 }
 const root=rivers.map(river=>walk(0,river)).reduce((s,v)=>s.map((x,p)=>x+v[p]/44),[0,0,0,0]);root.slice(0,3).forEach((v,p)=>close(a.nodes[0].expectedPrizes[p],v));
 a.tree[0].actions.forEach((action,i)=>{const forced=rivers.map(river=>walk(action.nodeId,river)).reduce((s,v)=>s.map((x,p)=>x+v[p]/44),[0,0,0,0]);forced.slice(0,3).forEach((v,p)=>close(a.nodes[0].actions[i].expectedPrizes[p],v));close(a.nodes[0].actions[i].chipNet,forced[3]);});
});
const cases=[
 ['confirmation',r=>r.tournament.fieldConfirmed=false],['funding',r=>r.tournament.handStartStacks=[99,100]],['behind',r=>r.tournament.handStartStacks=[97,103]],['descending payouts',r=>r.tournament.payouts=[10,50]],['empty payouts',r=>r.tournament.payouts=[]],['outside zero',r=>r.tournament.otherPlayers[0].stack=0],['too many players',r=>r.tournament.otherPlayers=Array.from({length:8},(_,i)=>({name:'P'+i,stack:98}))],['denomination',r=>{r.spot.chipUnit=2;r.tournament.otherPlayers[0].stack=99;}],['response confirmation',r=>r.responsePolicy.confirmed=false],['no legal weight',r=>r.responsePolicy.players[0].river={}],['invalid weight',r=>r.responsePolicy.players[0].river={check:101}],['unknown action',r=>r.responsePolicy.players[0].river={limp:1}],['duplicate overrides',r=>r.responsePolicy.players[0].combos=[{cards:['Qh','Qc'],river:passive},{cards:['qc','qh'],river:passive}]],['blocked override',r=>r.responsePolicy.players[0].combos=[{cards:['2s','Qc'],river:passive}]],['invalid override',r=>r.responsePolicy.players[0].combos=[{cards:['junk','Qc'],river:passive}]],['empty override',r=>r.responsePolicy.players[0].combos=[{cards:['Qh','Qc']}]],['cash mode',r=>r.spot.gameMode='cash'],['mixed street',r=>r.spot.solverStreet='turn'],['solver options',r=>r.spot.solver={maxIterations:100}],['valuation marker',r=>r.spot.valuation={kind:'chip-ev'}],['unsupported Omaha',r=>r.spot.gameType='omaha'],['invalid board',r=>r.spot.board=['2s']],['invalid analysis',r=>r.analysisKind='GTO']
];
for(const [label,change] of cases)test('Rejects '+label,()=>{const r=structuredClone(input());change(r);assert.throws(()=>compareTournamentTree(r),{name:'ValidationError'});});
test('Nine-player complete field remains supported',()=>{const r=input();r.tournament.otherPlayers=Array.from({length:7},(_,i)=>({name:'P'+i,stack:98}));const a=compareTournamentTree(r);assert.equal(a.field.players.length,9);close(a.nodes[0].expectedPrizes.reduce((s,v)=>s+v,0),100);});
test('Sized bets and raises remain within the bounded complete outcome model',()=>{const r=input();r.spot.betSizes=[.25,.5,1];r.spot.raiseSizes=[.5,1];r.spot.maxRaises=1;r.spot.players[0].stack=200;r.spot.players[1].stack=200;r.spot.potSize=100;r.tournament.handStartStacks=[250,250];const a=compareTournamentTree(r);assert.ok(a.uniqueOutcomes<=128);});
test('ICM node/scenario cap rejects a valid but oversized river game before returning any partial report',()=>{
 const r=input(),w={fold:1,check:1,call:1,bet:1,raise:1,allin:1};r.spot.players.forEach(p=>{p.stack=200;p.input={type:'range',range:'22,33,44,55,66,88,TT,JJ'};});r.spot.board=['As','Ks','Qh','9d','7c'];r.spot.potSize=100;r.spot.betSizes=[.25,.5,1];r.spot.raiseSizes=[.5,1];r.spot.maxRaises=1;r.tournament.handStartStacks=[250,250];r.responsePolicy.players=[{turn:w,river:w},{turn:w,river:w}];assert.throws(()=>compareTournamentTree(r),/Tournament node\/scenario budget exceeded/);
});
test('New endpoint round-trips through the portable SDK and worker, writes no history, validates and remains authenticated',async()=>{
 const {createPreviewApp}=require('../../dev/preview'),{createApp}=require('../../server'),{createAuth}=require('../../auth');
 const Spot=require('../../models/Spot'),save=Spot.prototype.save;let writes=0;Spot.prototype.save=async()=>{writes++;throw Error('Unexpected persistence');};
 const server=createPreviewApp({NODE_ENV:'development'}).listen(0,'127.0.0.1');await once(server,'listening');
 try{const api=createApiClient({baseUrl:`http://127.0.0.1:${server.address().port}/api`,fetch});const result=await api.compareTournamentTree(input('turn'));assert.equal(result.analysis.street,'turn');assert.equal(result.analysis.valuation.unit,'prize-units');assert.equal((await api.capabilities()).capabilities.icm.treeActions.enabled,true);const bad=input();bad.tournament.fieldConfirmed=false;await assert.rejects(()=>api.compareTournamentTree(bad),e=>e.status===400);assert.equal(writes,0);
 }finally{Spot.prototype.save=save;server.closeAllConnections();await new Promise(r=>server.close(r));}
 const auth=createAuth({config:{secret:'tournament-fixture-secret-only-long',origins:[],secure:false,cookieName:'icm_fixture'},delivery:{config:{channels:[]}}});const live=createApp({auth}).listen(0,'127.0.0.1');await once(live,'listening');try{assert.equal((await fetch(`http://127.0.0.1:${live.address().port}/api/tournament-tree`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input())})).status,403);}finally{live.closeAllConnections();await new Promise(r=>live.close(r));}
});
module.exports={input};
