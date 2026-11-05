const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { ValidationError } = require('./errors');
const { cardToString } = require('./card');
const { validateRiverInput, prepareRiverDeals, buildRiverTreeFromModel, LIMITS: TREE_LIMITS } = require('./riverTree');
const { createCfrKernel } = require('./riverKernel');
const { LIMITS, riverResourcePlan, enforceRiverBudget } = require('./riverBudget');
function solverOptions(input) {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new ValidationError('River input must be an object.');
  const options=input.solver===undefined?{}:input.solver;
  if(!options||typeof options!=='object'||Array.isArray(options))throw new ValidationError('solver must be an options object.');
  const maxIterations=options.maxIterations===undefined?2000:options.maxIterations;
  const targetPotPct=options.targetPotPct===undefined?0.5:options.targetPotPct;
  if(!Number.isInteger(maxIterations)||maxIterations<100||maxIterations>LIMITS.maxIterations)
    throw new ValidationError('Solver iterations must be an integer from 100 to 20000.');
  if(typeof targetPotPct!=='number'||!Number.isFinite(targetPotPct)||targetPotPct<0||targetPotPct>5)
    throw new ValidationError('Exploitability target must be a number from 0 to 5 percent of the starting pot.');
  return {maxIterations,targetPotPct};
}
function prepareRiverGame(input) {
  const model=validateRiverInput(input);
  const chance=prepareRiverDeals(model,{...TREE_LIMITS,jointDeals:LIMITS.jointDeals});
  const tree=buildRiverTreeFromModel(model,chance), hands=[[],[]], handMaps=[new Map(),new Map()];
  const prior=[[],[]];
  const deals=chance.deals.filter(d=>d.weight>0).map(d=>({
    probability:d.weight/chance.totalMass,winner:d.winner,
    hands:d.hands.map((cards,p)=>{
      const sorted=[...cards].sort((a,b)=>a-b), key=sorted.join(',');
      if(!handMaps[p].has(key)){handMaps[p].set(key,hands[p].length);hands[p].push(sorted.map(cardToString));prior[p].push(0);}
      return handMaps[p].get(key);
    }),
  }));
  for(const d of deals)for(let p=0;p<2;p++)prior[p][d.hands[p]]+=d.probability;
  let informationSets=0;
  const layout=tree.nodes.map(node=>{
    if(node.kind==='terminal')return null;
    const count=hands[node.actor].length, actions=node.actions.length;
    informationSets+=count;
    return {count,actions};
  });
  if(informationSets>LIMITS.informationSets)throw new ValidationError('Solver information-set limit exceeded. Narrow the private ranges.');
  const plan=riverResourcePlan(tree,hands,deals,layout,0);
  enforceRiverBudget(plan,{checkWork:false});
  const utilities=tree.nodes.map(node=>{
    if(node.kind!=='terminal')return null;
    return Float64Array.from(deals,d=>{
      const o=node.outcome;
      const units=Math.round(o.contestPot/tree.input.chipUnit);
      const award=o.reason==='fold'?(o.winner===0?o.contestPot:0)
        :d.winner===0?o.contestPot:d.winner===1?0:Math.ceil(units/2)*tree.input.chipUnit;
      // Center the fixed existing pot to get a genuine zero-sum payoff, in pot units.
      return (o.refunds[0]+award-node.contributions[0]-tree.input.potSize/2)/tree.input.potSize;
    });
  });
  return {tree,hands,prior,deals,layout,utilities,informationSets};
}
function uniformPolicy(game) {
  return game.layout.map(l=>l?new Float64Array(l.count*l.actions).fill(1/l.actions):null);
}
function averagePolicy(game,sums) {
  return game.layout.map((l,id)=>{
    if(!l)return null;
    const result=new Float64Array(l.count*l.actions);
    for(let h=0;h<l.count;h++){
      const offset=h*l.actions;let total=0;
      for(let a=0;a<l.actions;a++)total+=sums[id][offset+a];
      for(let a=0;a<l.actions;a++)result[offset+a]=total>0?sums[id][offset+a]/total:1/l.actions;
    }
    return result;
  });
}
function profileValues(game,policy) {
  const {tree,deals}=game,D=deals.length;
  const values=Array(tree.nodes.length);
  for(let id=tree.nodes.length-1;id>=0;id--){
    const node=tree.nodes[id];
    if(node.kind==='terminal'){values[id]=game.utilities[id];continue;}
    const value=new Float64Array(D), A=node.actions.length;
    for(let d=0;d<D;d++){
      const offset=deals[d].hands[node.actor]*A;
      for(let a=0;a<A;a++)value[d]+=policy[id][offset+a]*values[node.actions[a].nodeId][d];
    }
    values[id]=value;
  }
  return values;
}
// One best action per (public history, own hand), never per opponent's private deal.
function bestResponse(game,policy,player) {
  const {tree,deals}=game,D=deals.length;
  function visit(id,opponentReach){
    const node=tree.nodes[id];
    if(node.kind==='terminal')return Float64Array.from(game.utilities[id],u=>player===0?u:-u);
    const A=node.actions.length;
    if(node.actor!==player){
      const result=new Float64Array(D);
      for(let a=0;a<A;a++){
        const reach=Float64Array.from(opponentReach,(r,d)=>r*policy[id][deals[d].hands[node.actor]*A+a]);
        const child=visit(node.actions[a].nodeId,reach);
        for(let d=0;d<D;d++)result[d]+=policy[id][deals[d].hands[node.actor]*A+a]*child[d];
      }
      return result;
    }
    const children=node.actions.map(a=>visit(a.nodeId,opponentReach));
    const scores=Array.from({length:game.hands[player].length},()=>new Float64Array(A));
    for(let d=0;d<D;d++)for(let a=0;a<A;a++)scores[deals[d].hands[player]][a]+=deals[d].probability*opponentReach[d]*children[a][d];
    const choices=scores.map(row=>{let best=0;for(let a=1;a<A;a++)if(row[a]>row[best])best=a;return best;});
    return Float64Array.from(deals,(deal,d)=>children[choices[deal.hands[player]]][d]);
  }
  const values=visit(tree.rootId,new Float64Array(D).fill(1));
  return deals.reduce((sum,deal,d)=>sum+deal.probability*values[d],0);
}
function assessPolicy(game,policy,details=false) {
  const values=profileValues(game,policy), P=game.tree.input.potSize;
  const value=game.deals.reduce((sum,deal,d)=>sum+deal.probability*values[0][d],0);
  const br=[bestResponse(game,policy,0),bestResponse(game,policy,1)];
  const gains=[Math.max(0,br[0]-value),Math.max(0,br[1]+value)];
  const nashConv=gains[0]+gains[1], exploitability=nashConv/2;
  const result={normalizedValue:value,expectedNet:[(value+0.5)*P,(0.5-value)*P],
    bestResponseNet:br.map(v=>(v+0.5)*P),deviationGains:gains.map(v=>v*P),nashConv:nashConv*P,
    exploitability:exploitability*P,exploitabilityPotPct:exploitability*100};
  if(!details)return result;
  const D=game.deals.length,reach0=Array(game.tree.nodes.length),reach1=Array(game.tree.nodes.length);
  reach0[0]=new Float64Array(D).fill(1);reach1[0]=new Float64Array(D).fill(1);
  const nodePolicies=[];
  for(const node of game.tree.nodes){
    if(node.kind==='terminal')continue;
    const id=node.id,p=node.actor,A=node.actions.length,H=game.hands[p].length;
    const mass=new Float64Array(H),cfMass=new Float64Array(H),ev=Array.from({length:H},()=>new Float64Array(A));
    let nodeMass=0;
    for(let d=0;d<D;d++){
      const deal=game.deals[d],h=deal.hands[p],opp=p===0?reach1[id][d]:reach0[id][d];
      const actual=deal.probability*reach0[id][d]*reach1[id][d],cf=deal.probability*opp;
      mass[h]+=actual;nodeMass+=actual;cfMass[h]+=cf;
      for(let a=0;a<A;a++)ev[h][a]+=cf*(p===0?values[node.actions[a].nodeId][d]:-values[node.actions[a].nodeId][d]);
    }
    const combos=game.hands[p].map((cards,h)=>({cards,priorProbability:game.prior[p][h],reachProbability:mass[h],
      conditionalProbability:nodeMass>0?mass[h]/nodeMass:null,
      valueKind:cfMass[h]===0?'unreachable':mass[h]===0?'counterfactual-only':'reached',
      frequencies:Array.from(policy[id].slice(h*A,(h+1)*A)),
      actionEv:node.actions.map((a,j)=>cfMass[h]>0?(ev[h][j]/cfMass[h]+0.5)*P:null),
    }));
    const frequencies=node.actions.map((a,j)=>nodeMass>0?combos.reduce((s,c)=>s+c.reachProbability*c.frequencies[j],0)/nodeMass:null);
    const actionEv=node.actions.map((a,j)=>nodeMass>0?combos.reduce((s,c)=>s+c.reachProbability*(c.actionEv[j]??0),0)/nodeMass:null);
    nodePolicies.push({nodeId:id,actor:p,reachProbability:nodeMass,frequencies,actionEv,combos});
    for(let a=0;a<A;a++){
      const child=node.actions[a].nodeId;
      reach0[child]=Float64Array.from(reach0[id],(r,d)=>r*(p===0?policy[id][game.deals[d].hands[0]*A+a]:1));
      reach1[child]=Float64Array.from(reach1[id],(r,d)=>r*(p===1?policy[id][game.deals[d].hands[1]*A+a]:1));
    }
  }
  return {...result,nodePolicies};
}
function solveRiverTree(input, {onProgress = () => {}} = {}) {
  onProgress({phase:"preparing",completedIterations:0,maxIterations:input?.solver?.maxIterations ?? 2000});
  const started=performance.now(), options=solverOptions(input),game=prepareRiverGame(input);
  const plan=riverResourcePlan(game.tree,game.hands,game.deals,game.layout,options.maxIterations);
  enforceRiverBudget(plan);const estimatedWork=plan.estimatedWork;
  const regrets=game.layout.map(l=>l?new Float64Array(l.count*l.actions):null),sums=game.layout.map(l=>l?new Float64Array(l.count*l.actions):null);
  const current=uniformPolicy(game),kernel=createCfrKernel(game,current,regrets,sums);
  const setupMs=performance.now()-started;
  let qualityMs=0;
  const assess=policy=>{const t=performance.now(),result=assessPolicy(game,policy);qualityMs+=performance.now()-t;return result;};
  const history=[];let completed=0,policy=current,assessment=assess(policy);
  const record=()=>history.push({iteration:completed,exploitability:assessment.exploitability,exploitabilityPotPct:assessment.exploitabilityPotPct,expectedNet:assessment.expectedNet});
  record();
  const report=(phase)=>onProgress({phase,completedIterations:completed,maxIterations:options.maxIterations,checkpoint:history.at(-1)});
  report("solving");
  const reportEvery=Math.max(1,Math.ceil(options.maxIterations/100));
  const checkEvery=Math.max(10,Math.ceil(options.maxIterations/10));
  let targetReached=assessment.exploitabilityPotPct<=options.targetPotPct;
  const loopStarted=performance.now(),initialQualityMs=qualityMs;
  while(completed<options.maxIterations&&!targetReached){
    kernel.step();
    completed++;
    if(completed%checkEvery===0||completed===options.maxIterations){
      report("evaluating");
      policy=averagePolicy(game,sums);assessment=assess(policy);record();
      targetReached=assessment.exploitabilityPotPct<=options.targetPotPct;
    }
    if(completed%reportEvery===0||targetReached||completed===options.maxIterations)report("solving");
  }
  const iterationMs=performance.now()-loopStarted-(qualityMs-initialQualityMs),reportStarted=performance.now();
  report("evaluating");
  // Initial uniform policy is retained only when it already meets the target at iteration zero.
  const analysis=assessPolicy(game,policy,true);
  const fingerprint=createHash('sha256').update(JSON.stringify(game.tree.input)).digest('hex');
  return {version:1,algorithm:'full-traversal-simultaneous-CFR',strategy:'reach-weighted-average',scope:game.tree.scope,
    input:game.tree.input,fingerprint,options,iterationsCompleted:completed,stopReason:targetReached?'target-reached':'iteration-limit',
    targetReached,runtimeMs:Math.round(performance.now()-started),jointDeals:game.deals.length,informationSets:game.informationSets,
    estimatedWork,limits:LIMITS,metrics:analysis,history,
    performance:{kernel:'compiled-public-tree',timingsMs:{setup:Math.round(setupMs*10)/10,iterations:Math.round(iterationMs*10)/10,
      quality:Math.round(qualityMs*10)/10,report:Math.round((performance.now()-reportStarted)*10)/10},
      resources:{...plan,kernelBytes:kernel.bytes}},
    notes:[
      'Exploitability is half the sum of exact unilateral best-response gains in this configured zero-sum tree, in chips per deal.',
      'Best responses share one decision for each public history and OWN private combo. Opponent cards are never revealed.',
      'All reported policies are average CFR policies. Action EV is net from river start if this combo forces that action, then both follow the average continuation.',
      'Public-node frequencies use the strategy-dependent reached range, including joint blockers; they are not uniform averages over combos.',
      'Unreachable opponent paths have no defined action EV. Counterfactual-only rows ignore own prior action reach and are not actual on-path observations.',
      'The target and best responses concern the configured sizes and raise cap only, not unrestricted Hold\'em or full-game GTO.',
    ]};
}
module.exports={LIMITS,solverOptions,prepareRiverGame,uniformPolicy,profileValues,bestResponse,assessPolicy,solveRiverTree};
