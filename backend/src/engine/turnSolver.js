const {API_CONTRACT_VERSION,chipValuation}=require('@river-poker-lab/core');
const {performance}=require('node:perf_hooks');
const {createHash}=require('node:crypto');
const {ValidationError}=require('./errors');
const {cardFromString,cardToString}=require('./card');
const {prepareRanges}=require('./rangeSampler');
const {walkDeals}=require('./exact');
const {evaluatePlayer}=require('./engine');
const {validateRiverInput,buildRiverTreeFromModel}=require('./riverTree');
const {solverOptions}=require('./riverSolver');
const LIMITS=Object.freeze({privateDeals:16,scenarios:704,nodes:3000,informationSets:6000,nodeDealVisits:120000,work:60000000,maxIterations:2000});
const fail=message=>{throw new ValidationError(message);};
function turnSolverOptions(input){
  const options=solverOptions(input);
  if(input.solver?.maxIterations===undefined)options.maxIterations=500;
  if(options.maxIterations>LIMITS.maxIterations)fail('Turn solver supports 100–2000 iterations.');
  return options;
}
function prepareTurnGame(input){
  if(!input||typeof input!=='object'||Array.isArray(input))fail('Turn input must be an object.');
  if(input.solverStreet!==undefined&&input.solverStreet!=='turn')fail('Turn solver requires solverStreet turn.');
  if(input.maxRaises!==undefined&&input.maxRaises!==0||input.raiseSizes!==undefined&&(!Array.isArray(input.raiseSizes)||input.raiseSizes.length))fail('This turn abstraction supports no raises on either street.');
  const model=validateRiverInput({...input,betSizes:input.betSizes===undefined?[.5]:input.betSizes,raiseSizes:[],maxRaises:0},{street:'turn'});
  const riverModel=validateRiverInput({...input,betSizes:input.riverBetSizes===undefined?[.5]:input.riverBetSizes,raiseSizes:[],maxRaises:0},{street:'turn'});
  if(model.betSizes.length>1||riverModel.betSizes.length>1)fail('Choose at most one opening bet size per street, plus the optional all-in.');
  const board=model.board.map(cardFromString),prepared=prepareRanges(model.players.map(p=>p.input),model.board,1),pairs=[];
  const enumeration=walkDeals(prepared.candidates,board,{maxDeals:LIMITS.privateDeals,maxSteps:20000,candidateWeights:prepared.candidateWeights},(hands,weight)=>{if(weight>0)pairs.push({hands:hands.map(h=>[...h]),weight});});
  if(enumeration.overflow)fail('Turn private-deal limit exceeded (16 legal pairs). Narrow both ranges; no sampled or partial game is returned.');
  const mass=pairs.reduce((s,p)=>s+p.weight,0);if(!mass)fail('No compatible positive-weight private deals remain.');
  const hands=[[],[]],maps=[new Map(),new Map()],scenarios=[],partitions=new Map();
  function handIndex(cards,p){const sorted=[...cards].sort((a,b)=>a-b),key=sorted.join(',');if(!maps[p].has(key)){maps[p].set(key,hands[p].length);hands[p].push(sorted.map(cardToString));}return maps[p].get(key);}
  const scores=[new Map(),new Map()];
  for(const pair of pairs){
    const indices=pair.hands.map(handIndex),used=new Set([...board,...pair.hands.flat()]);
    for(let r=0;r<52;r++)if(!used.has(r)){
      const values=pair.hands.map((cards,p)=>{const key=indices[p]+':'+r;if(!scores[p].has(key))scores[p].set(key,evaluatePlayer(cards,[...board,r],'holdem'));return scores[p].get(key);});
      const id=scenarios.length;scenarios.push({hands:indices,river:r,probability:pair.weight/mass/44,winner:values[0]===values[1]?null:values[0]>values[1]?0:1});
      if(!partitions.has(r))partitions.set(r,[]);partitions.get(r).push(id);
    }
  }
  const prior=hands.map(()=>[]);for(let p=0;p<2;p++)prior[p]=hands[p].map((_,h)=>scenarios.reduce((s,d)=>s+(d.hands[p]===h?d.probability:0),0));
  const all=scenarios.map((_,i)=>i),nodes=[],P=model.pot*model.denomination/100;
  let visits=0,informationSets=0;
  const neutral={winProbability:[.5,.5],tieProbability:0,deals:[],totalMass:1,availableCombos:hands.map(h=>h.length)};
  function add(publicNode,active,parentId,incoming){
    if(nodes.length>=LIMITS.nodes)fail('Turn public-node limit exceeded. Reduce configured sizes.');
    visits+=active.length;if(visits>LIMITS.nodeDealVisits)fail('Turn memory/workspace limit exceeded. Narrow ranges or sizes.');
    const n={...publicNode,id:nodes.length,parentId,incoming,actions:[],active,value:new Float64Array(active.length),r0:new Float64Array(active.length),r1:new Float64Array(active.length)};nodes.push(n);return n;
  }
  function terminal(n,local,turnContributions){
    const o=local.outcome,unit=model.denomination/100;
    n.outcome={reason:o.reason,winner:o.winner,contestPot:o.contestPot,refunds:o.refunds};
    n.utility=Float64Array.from(n.active,id=>{
      const d=scenarios[id],winner=o.reason==='fold'?o.winner:d.winner;
      const award=winner===0?o.contestPot:winner===1?0:Math.ceil(Math.round(o.contestPot/unit)/2)*unit;
      return (o.refunds[0]+award-turnContributions[0]-local.contributions[0]-P/2)/P;
    });n.value=n.utility;
  }
  function copy(localTree,id,active,parent,incoming,street,previous){
    const local=localTree.nodes[id],n=add({kind:local.kind,actor:local.actor,street,board:localTree.input.board,pot:local.pot,
      contributions:local.contributions.map((v,p)=>v+previous[p]),remaining:local.remaining,toCall:local.toCall},active,parent,incoming);
    if(local.kind==='terminal'){
      if(street==='river'||local.outcome.reason==='fold'){terminal(n,local,previous);return n.id;}
      n.kind='chance';n.actor=null;
      const invested=local.contributions,remaining=model.players.map((p,i)=>p.stack-Math.round(invested[i]*100/model.denomination));
      for(const [river,ids] of [...partitions.entries()].sort((a,b)=>a[0]-b[0])){
        const card=cardToString(river),newBoard=[...model.board,card];let child;
        if(Math.min(...remaining)===0){
          const t=add({kind:'terminal',actor:null,street:'river',board:newBoard,pot:local.pot,contributions:[...invested],remaining:[...local.remaining]},ids,n.id,`Deal ${card}`);
          terminal(t,{contributions:[0,0],outcome:{reason:'showdown',winner:null,contestPot:local.outcome.contestPot,refunds:[0,0]}},invested);child=t.id;
        }else{
          const next={...model,board:newBoard,pot:Math.round(local.pot*100/model.denomination),betSizes:riverModel.betSizes,players:model.players.map((p,i)=>({...p,stack:remaining[i]}))};
          child=copy(buildRiverTreeFromModel(next,neutral),0,ids,n.id,`Deal ${card}`,'river',invested);
        }
        n.actions.push({type:'deal',card,label:`Deal ${card}`,nodeId:child});
      }
      return n.id;
    }
    const A=local.actions.length,H=hands[n.actor].length;
    n.handIds=[...new Set(active.map(i=>scenarios[i].hands[n.actor]))];informationSets+=n.handIds.length;
    if(informationSets>LIMITS.informationSets)fail('Turn information-set limit exceeded. Narrow ranges.');
    n.policy=new Float64Array(H*A).fill(1/A);n.regret=new Float64Array(H*A);n.sum=new Float64Array(H*A);
    for(const a of local.actions)n.actions.push({...a,nodeId:copy(localTree,a.nodeId,active,n.id,a.label,street,previous)});
    return n.id;
  }
  copy(buildRiverTreeFromModel(model,neutral),0,all,null,null,'turn',[0,0]);
  // Child slots map sparse river scenarios to their parent's local array. Chance
  // probabilities are already represented exactly once in the latent joint prior.
  for(const n of nodes)if(n.parentId!==null){const parent=nodes[n.parentId],slots=new Map(parent.active.map((id,i)=>[id,i]));n.parentSlots=Uint32Array.from(n.active,id=>slots.get(id));}
  const inputCanonical={...buildRiverTreeFromModel(model,neutral).input,solverStreet:'turn',riverBetSizes:riverModel.betSizes};
  return {nodes,scenarios,hands,prior,P,privateDeals:pairs.length,informationSets,visits,input:inputCanonical,limits:LIMITS};
}
function forward(game,policy,respondingPlayer=null){
  const {nodes,scenarios}=game;nodes[0].r0.fill(1);nodes[0].r1.fill(1);
  for(const n of nodes){
    if(n.parentId===null)continue;const parent=nodes[n.parentId],a=parent.actions.findIndex(a=>a.nodeId===n.id),A=parent.actions.length;
    for(let i=0;i<n.active.length;i++){
      const at=n.parentSlots[i],d=scenarios[n.active[i]],prob=parent.kind==='decision'&&parent.actor!==respondingPlayer?policy[parent.id][d.hands[parent.actor]*A+a]:1;
      n.r0[i]=parent.r0[at]*(parent.actor===0?prob:1);n.r1[i]=parent.r1[at]*(parent.actor===1?prob:1);
    }
  }
}
function evaluateProfile(game,policy,brPlayer=null){
  const {nodes,scenarios}=game;forward(game,policy,brPlayer);
  for(let id=nodes.length-1;id>=0;id--){const n=nodes[id];
    if(n.kind==='terminal')continue;
    if(n.kind==='chance'){
      n.value.fill(0);for(const a of n.actions){const child=nodes[a.nodeId];for(let i=0;i<child.active.length;i++)n.value[child.parentSlots[i]]=child.value[i];}continue;
    }
    const A=n.actions.length,children=n.actions.map(a=>nodes[a.nodeId]);
    if(n.actor===brPlayer){
      const scores=new Float64Array(game.hands[n.actor].length*A),opponent=brPlayer===0?n.r1:n.r0,sign=brPlayer===0?1:-1;
      for(let i=0;i<n.active.length;i++){const d=scenarios[n.active[i]],offset=d.hands[n.actor]*A;for(let a=0;a<A;a++)scores[offset+a]+=d.probability*opponent[i]*sign*children[a].value[i];}
      const choices=game.hands[n.actor].map((_,h)=>{let best=0;for(let a=1;a<A;a++)if(scores[h*A+a]>scores[h*A+best])best=a;return best;});
      for(let i=0;i<n.active.length;i++)n.value[i]=children[choices[scenarios[n.active[i]].hands[n.actor]]].value[i];
    }else{
      for(let i=0;i<n.active.length;i++){const offset=scenarios[n.active[i]].hands[n.actor]*A;let v=0;for(let a=0;a<A;a++)v+=policy[n.id][offset+a]*children[a].value[i];n.value[i]=v;}
    }
  }
  return nodes[0].active.reduce((s,id,i)=>s+scenarios[id].probability*nodes[0].value[i],0);
}
function assessTurnPolicy(game,policy,details=false){
  const value=evaluateProfile(game,policy),br=[evaluateProfile(game,policy,0),-evaluateProfile(game,policy,1)],P=game.P;
  const gains=[Math.max(0,br[0]-value),Math.max(0,br[1]+value)],nash=gains[0]+gains[1];
  const result={normalizedValue:value,expectedNet:[(value+.5)*P,(.5-value)*P],bestResponseNet:br.map(v=>(v+.5)*P),deviationGains:gains.map(v=>v*P),nashConv:nash*P,exploitability:nash*P/2,exploitabilityPotPct:nash*50};
  if(!details)return result;
  evaluateProfile(game,policy);const nodePolicies=[],publicValues=[];
  for(const n of game.nodes){
    let mass=0,net=0;for(let i=0;i<n.active.length;i++){const q=game.scenarios[n.active[i]].probability*n.r0[i]*n.r1[i];mass+=q;net+=q*n.value[i];}
    const publicValue={nodeId:n.id,reachProbability:mass,net:mass>0?[(net/mass+.5)*P,(.5-net/mass)*P]:null};
    if(n.kind==='chance')publicValue.riverProbabilities=n.actions.map(a=>{const child=game.nodes[a.nodeId];let m=0;for(let i=0;i<child.active.length;i++)m+=game.scenarios[child.active[i]].probability*child.r0[i]*child.r1[i];return {card:a.card,probability:mass>0?m/mass:null};});
    publicValues.push(publicValue);if(n.kind!=='decision')continue;
    const p=n.actor,A=n.actions.length,H=game.hands[p].length,actual=new Float64Array(H),cf=new Float64Array(H),ev=Array.from({length:H},()=>new Float64Array(A));
    for(let i=0;i<n.active.length;i++){
      const d=game.scenarios[n.active[i]],h=d.hands[p],m=d.probability*n.r0[i]*n.r1[i],c=d.probability*(p===0?n.r1[i]:n.r0[i]);actual[h]+=m;cf[h]+=c;
      for(let a=0;a<A;a++)ev[h][a]+=c*(p===0?1:-1)*game.nodes[n.actions[a].nodeId].value[i];
    }
    const combos=n.handIds.map(h=>({cards:game.hands[p][h],priorProbability:game.prior[p][h],reachProbability:actual[h],conditionalProbability:mass>0?actual[h]/mass:null,
      valueKind:cf[h]===0?'unreachable':actual[h]===0?'counterfactual-only':'reached',frequencies:Array.from(policy[n.id].slice(h*A,(h+1)*A)),actionEv:Array.from(ev[h],v=>cf[h]>0?(v/cf[h]+.5)*P:null)}));
    nodePolicies.push({nodeId:n.id,actor:p,reachProbability:mass,combos,
      frequencies:n.actions.map((_,a)=>mass>0?combos.reduce((s,c)=>s+c.reachProbability*c.frequencies[a],0)/mass:null),actionEv:n.actions.map((_,a)=>mass>0?combos.reduce((s,c)=>s+c.reachProbability*(c.actionEv[a]??0),0)/mass:null)});
  }
  return {...result,nodePolicies,publicValues};
}
function turnStep(game){
  const policy=game.nodes.map(n=>n.policy||null);
  for(const n of game.nodes)if(n.kind==='decision'){const A=n.actions.length;for(const h of n.handIds){let positive=0;for(let a=0;a<A;a++)positive+=Math.max(0,n.regret[h*A+a]);for(let a=0;a<A;a++)n.policy[h*A+a]=positive>0?Math.max(0,n.regret[h*A+a])/positive:1/A;}}
  evaluateProfile(game,policy);
  for(const n of game.nodes)if(n.kind==='decision'){
    const p=n.actor,A=n.actions.length;for(let i=0;i<n.active.length;i++){
      const d=game.scenarios[n.active[i]],offset=d.hands[p]*A,other=d.probability*(p===0?n.r1[i]:n.r0[i])*(p===0?1:-1),own=d.probability*(p===0?n.r0[i]:n.r1[i]);
      for(let a=0;a<A;a++){n.regret[offset+a]+=other*(game.nodes[n.actions[a].nodeId].value[i]-n.value[i]);n.sum[offset+a]+=own*n.policy[offset+a];}
    }
  }
}
function averageTurnPolicy(game){return game.nodes.map(n=>{if(n.kind!=='decision')return null;const A=n.actions.length,result=new Float64Array(n.policy.length);for(let h=0;h<game.hands[n.actor].length;h++){let sum=0;for(let a=0;a<A;a++)sum+=n.sum[h*A+a];for(let a=0;a<A;a++)result[h*A+a]=sum>0?n.sum[h*A+a]/sum:1/A;}return result;});}
function solveTurnTree(input,{onProgress=()=>{}}={}){
  const started=performance.now(),options=turnSolverOptions(input);onProgress({phase:'preparing',completedIterations:0,maxIterations:options.maxIterations});
  const game=prepareTurnGame(input),estimatedWork=(options.maxIterations+60)*game.visits;
  if(estimatedWork>LIMITS.work)fail('Turn work budget exceeded. Reduce iterations, ranges or optional all-in sizes.');
  let policy=game.nodes.map(n=>n.policy||null),assessment=assessTurnPolicy(game,policy),completed=0;const history=[];
  const record=()=>history.push({iteration:completed,exploitability:assessment.exploitability,exploitabilityPotPct:assessment.exploitabilityPotPct,expectedNet:assessment.expectedNet});record();
  const report=phase=>onProgress({phase,completedIterations:completed,maxIterations:options.maxIterations,checkpoint:history.at(-1)}),checkEvery=Math.max(10,Math.ceil(options.maxIterations/10));
  let targetReached=assessment.exploitabilityPotPct<=options.targetPotPct;report('solving');
  while(completed<options.maxIterations&&!targetReached){turnStep(game);completed++;if(completed%checkEvery===0||completed===options.maxIterations){report('evaluating');policy=averageTurnPolicy(game);assessment=assessTurnPolicy(game,policy);record();targetReached=assessment.exploitabilityPotPct<=options.targetPotPct;}if(completed%Math.max(1,Math.ceil(options.maxIterations/100))===0||targetReached)report('solving');}
  report('evaluating');const metrics=assessTurnPolicy(game,policy,true);
  const nodes=game.nodes.map(n=>({id:n.id,parentId:n.parentId,incoming:n.incoming,kind:n.kind,actor:n.actor,street:n.street,board:n.board,pot:n.pot,remaining:n.remaining,contributions:n.contributions,toCall:n.toCall,actions:n.actions,...(n.outcome?{outcome:n.outcome}:{})}));
  return {contractVersion:API_CONTRACT_VERSION,valuation:chipValuation('turn',metrics.expectedNet,game.P),version:1,algorithm:'full-traversal-simultaneous-CFR',strategy:'reach-weighted-average',scope:'heads-up-turn-river-holdem-cash',input:game.input,
    fingerprint:createHash('sha256').update(JSON.stringify(game.input)).digest('hex'),options,iterationsCompleted:completed,targetReached,stopReason:targetReached?'target-reached':'iteration-limit',runtimeMs:Math.round(performance.now()-started),
    jointDeals:game.scenarios.length,privateDeals:game.privateDeals,informationSets:game.informationSets,estimatedWork,limits:LIMITS,metrics,history,
    turnTree:{input:game.input,nodes,privateDeals:game.privateDeals,scenarios:game.scenarios.length,nodeDealVisits:game.visits,limits:LIMITS},
    notes:['Complete four-card turn start; heads-up Hold\'em cash only. One configured opening size plus optional effective all-in on each street; no raises.',
      'Every compatible private pair has exactly 44 equally likely legal river cards. Future rivers are hidden at turn information sets; river strategies condition on the revealed public card.',
      'Chance is represented once by the joint private-pair/river prior. Sparse chance branches select consistent scenarios without resampling or double weighting.',
      'Net EV includes all turn and river investments relative to stacks at TURN start. Net EVs sum to the original turn pot. OOP receives an odd split chip.',
      'Exploitability is half the sum of exact information-set-constrained unilateral best-response gains in this configured two-street game.',
      'No rake, side pots, outstanding bets, Omaha, tournament ICM or unrestricted-game guarantee. Temporary job retention follows the existing background calculation rules.']};
}
module.exports={LIMITS,turnSolverOptions,prepareTurnGame,evaluateProfile,assessTurnPolicy,turnStep,averageTurnPolicy,solveTurnTree};
