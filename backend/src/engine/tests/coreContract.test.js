const test=require('node:test'),assert=require('node:assert/strict');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
const {createApiClient,buildSolverRequest,buildRiverTreeRequest,parseValuation,API_CONTRACT_VERSION}=require('@river-poker-lab/core');
const {createPreviewApp}=require('../../dev/preview');
const {createApp}=require('../../server');
const {createAuth}=require('../../auth');
function draft(turn=false){return {players:[{name:'OOP',stack:turn?'4':'200',mode:'hand',cards:['Ah',turn?'Kh':'Ac']},{name:'IP',stack:turn?'4':'200',mode:'hand',cards:turn?['Qs','Qc']:['Kh','Kc']}],board:turn?['2h','7d','Th','9s']:['2s','3d','7h','8c','9s'],pot:turn?'2':'100',chipUnit:'1',minBet:turn?'1':'2',bets:'50',raises:'',riverBets:'50',maxRaises:'0',includeAllIn:false};}
test('Portable SDK and builders round-trip both solver streets against the real preview API without database writes',async()=>{
  const mongoose=require('mongoose'),Spot=require('../../models/Spot');let writes=0;const save=Spot.prototype.save;Spot.prototype.save=async()=>{writes++;throw Error('Unexpected DB write');};
  const server=createPreviewApp({NODE_ENV:'development'}).listen(0,'127.0.0.1');await once(server,'listening');const api=createApiClient({baseUrl:`http://127.0.0.1:${server.address().port}/api`,fetch});
  try{const caps=(await api.capabilities()).capabilities;assert.equal(caps.contractVersion,API_CONTRACT_VERSION);assert.equal(caps.authentication.mode,'local-preview');assert.equal(caps.authentication.bearerTokens,false);assert.equal(caps.solvers.icmTree.enabled,false);assert.equal(caps.jobs.survivesServerRestart,false);
    const built=await api.buildRiverTree(buildRiverTreeRequest(draft()));assert.equal(built.tree.chance.jointDeals,1);
    for(const street of ['river','turn']){const request=buildSolverRequest(draft(street==='turn'),{iterations:'100',target:'0'},street),accepted=await api.createSolverJob(request,randomUUID());assert.ok(accepted.job.id);let result;
      for(let i=0;i<200;i++){result=(await api.getSolverJob(accepted.job.id)).job;if(!['queued','running'].includes(result.status))break;await new Promise(r=>setTimeout(r,10));}
      assert.equal(result.status,'completed');assert.equal(result.solution.contractVersion,1);const value=parseValuation(result.solution.valuation);assert.equal(value.kind,'chip-ev');assert.equal(value.baseline,street+'-start-stack');assert.deepEqual(value.expectedNet,result.solution.metrics.expectedNet);
    }
    assert.equal(writes,0);assert.equal(mongoose.connection.readyState,0);
  }finally{Spot.prototype.save=save;server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('Capabilities stay behind production authentication and do not advertise native token or ICM-tree support',async()=>{
  const auth=createAuth({config:{secret:'shared-contract-fixture-secret-never-real',origins:[],secure:false,cookieName:'core_test'},delivery:{config:{channels:[]}}}),server=createApp({auth}).listen(0,'127.0.0.1');await once(server,'listening');
  try{const r=await fetch(`http://127.0.0.1:${server.address().port}/api/capabilities`);assert.equal(r.status,401);assert.equal(r.headers.get('X-River-Contract-Version'),'1');}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
  const caps=require('../../capabilities').capabilities();assert.equal(caps.authentication.mode,'cookie-session');assert.equal(caps.icm.maxRemainingPlayers,9);assert.equal(caps.offlineSolving,false);assert.equal(caps.solvers.river.limits.work,60000000);
});
test('An ICM request marker cannot silently enter a cash strategy solver through raw API input',()=>{
  const raw=buildSolverRequest(draft(),{iterations:'100',target:'0'});raw.valuation={kind:'icm-prize-ev'};
  assert.throws(()=>require('../riverSolver').solveRiverTree(raw),{name:'ValidationError'});
  const turn=buildSolverRequest(draft(true),{iterations:'100',target:'0'},'turn');turn.valuation={kind:'icm-prize-ev'};assert.throws(()=>require('../turnSolver').solveTurnTree(turn),{name:'ValidationError'});
});
test('Existing outcome-weighted ICM comparison carries absolute prize-value metadata without changing its recommendations',()=>{
  const {replayBetting}=require('../betting'),{validateTournament}=require('../tournament'),{analyzeClosingCall}=require('../analysis');
  const players=[['9s','9d'],['Ah','Kh'],['5s','6s']],actions=[{type:'call',seatId:0},{type:'call',seatId:1},{type:'check',seatId:2},{type:'advance'},{type:'check',seatId:1},{type:'check',seatId:2},{type:'check',seatId:0},{type:'advance'},{type:'allin',seatId:1},{type:'fold',seatId:2}];
  const tableState={seats:players.map((cards,id)=>({id,name:`P${id}`,stack:100,startingStack:100,cards})),heroSeatId:0,bigBlind:2,handSetup:{dealerSeatId:0,smallBlind:1},betting:{actions}};
  const tournament=validateTournament({fieldConfirmed:true,eliminationRule:'starting-stack-split',tableSeats:players.map((_,seatId)=>({seatId,startingStack:100})),otherPlayers:[],payouts:[50,50,0]},tableState,'tournament');
  const bettingState=replayBetting({seats:players.map((_,id)=>({id,startingStack:100})),dealerSeatId:0,smallBlind:1,bigBlind:2,gameType:'holdem'},actions,4);
  const r=analyzeClosingCall({players,board:['Jh','Th','2c','8s'],gameType:'holdem',gameMode:'tournament',iterations:1,tableState,tournament,bettingState,settings:{method:'exact',chipUnit:1}});
  assert.equal(r.icm.available,true);const value=parseValuation(r.icm.valuation);assert.equal(value.kind,'icm-prize-ev');assert.equal(value.expectedByAction.call,r.icm.expectedCallPrize);assert.equal(value.expectedByAction.fold,r.icm.expectedFoldPrize);assert.ok(Math.abs(value.difference.value-r.icm.deltaCallVsFold)<1e-9);assert.equal(r.icm.decision,'Fold');assert.ok(r.callEV>0);
});
