const {performance}=require('node:perf_hooks');
const {createHash}=require('node:crypto');
const {API_CONTRACT_VERSION,normalizeCard,icmTreeValuation}=require('@river-poker-lab/core');
const {ValidationError}=require('./errors');
const {chipUnits}=require('./payouts');
const {validateICMInput}=require('./icm');
const {resolveTournamentOutcome}=require('./tournament');
const {prepareRiverGame}=require('./riverSolver');
const {prepareTurnGame,evaluateProfile}=require('./turnSolver');
const LIMITS=Object.freeze({nodeDealVisits:120000,uniqueOutcomes:128,comboOverrides:128});
const ACTIONS=['check','bet','raise','call','fold','allin'];
const fail=message=>{throw new ValidationError(message);};
function riverGame(input){
  const g=prepareRiverGame(input),active=g.deals.map((_,i)=>i),slots=Uint32Array.from(active),nodes=g.tree.nodes.map(n=>({...n,street:'river',board:g.tree.input.board,active,parentSlots:n.parentId===null?undefined:slots,
    r0:new Float64Array(active.length),r1:new Float64Array(active.length),value:g.utilities[n.id]||new Float64Array(active.length),utility:g.utilities[n.id],
    ...(n.kind==='decision'?{handIds:g.hands[n.actor].map((_,i)=>i)}:{})}));
  return {nodes,scenarios:g.deals,hands:g.hands,prior:g.prior,P:g.tree.input.potSize,privateDeals:g.deals.length,visits:nodes.length*active.length,input:g.tree.input};
}
function checkedField(tournament,game){
  if(!tournament||typeof tournament!=='object'||Array.isArray(tournament)||tournament.fieldConfirmed!==true)fail('Confirm the entire remaining field and payouts.');
  if(tournament.eliminationRule!=='starting-stack-split')fail('Use starting-stack-split for hand eliminations.');
  if(!Array.isArray(tournament.handStartStacks)||tournament.handStartStacks.length!==2||!Array.isArray(tournament.otherPlayers))fail('Supply both actual hand-start stacks and the fixed outside players.');
  const behind=game.input.players.map(p=>chipUnits(p.stack,'Stack behind')),starting=tournament.handStartStacks.map(s=>chipUnits(s,'Hand-start stack')),pot=chipUnits(game.P),unit=chipUnits(game.input.chipUnit);
  if(starting.some((s,i)=>s<behind[i]||s===0||s%unit)||starting[0]+starting[1]!==behind[0]+behind[1]+pot)fail('Hand-start stacks must fund the pot exactly: sum(hand-start − behind) = starting pot. This model requires the pot to be funded only by these two players.');
  const checked=validateICMInput({players:[...game.input.players.map((p,i)=>({name:p.name,stack:tournament.handStartStacks[i]})),...tournament.otherPlayers],payouts:tournament.payouts});
  if(checked.players.some(p=>chipUnits(p.stack)%unit))fail('Every field stack must align with the smallest chip.');
  return {players:checked.players,starting:checked.players.map(p=>p.stack),payouts:checked.payouts,behind,unit,totalPrize:checked.payouts.reduce((a,b)=>a+b,0),fieldConfirmed:true,eliminationRule:'starting-stack-split'};
}
function weightMap(value){
  if(!value||typeof value!=='object'||Array.isArray(value))fail('Every street needs explicit action weights.');
  for(const k of Object.keys(value))if(!ACTIONS.includes(k))fail('Unknown response action.');
  return Object.fromEntries(ACTIONS.map(k=>{const n=value[k]===undefined?0:value[k];if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>100)fail('Response weights must be numbers from 0 to 100.');return [k,n];}));
}
function fixedPolicy(game,input){
  if(!input||typeof input!=='object'||input.confirmed!==true||!Array.isArray(input.players)||input.players.length!==2)fail('Confirm explicit response policies for both players.');
  const profiles=input.players.map((p,player)=>{
    if(!p||typeof p!=='object')fail('Invalid player response profile.');
    const base={turn:weightMap(p.turn),river:weightMap(p.river)},overrides=new Map(),combos=p.combos===undefined?[]:p.combos;
    if(!Array.isArray(combos)||combos.length>LIMITS.comboOverrides)fail('Too many combo policy overrides.');
    for(const row of combos){
      if(!row||!Array.isArray(row.cards)||row.cards.length!==2)fail('An override needs two physical cards.');
      let cards;try{cards=row.cards.map(normalizeCard).sort();}catch(e){fail(e.message);}
      const key=cards.join(',');if(!game.hands[player].some(h=>[...h].sort().join(',')===key)||overrides.has(key))fail('Combo overrides must be unique compatible input hands.');
      if(row.turn===undefined&&row.river===undefined)fail('Specify at least one street in a combo override.');
      overrides.set(key,{...(row.turn===undefined?{}:{turn:weightMap(row.turn)}),...(row.river===undefined?{}:{river:weightMap(row.river)})});
    }
    return {base,overrides};
  });
  const policies=game.nodes.map(n=>{
    if(n.kind!=='decision')return null;
    const A=n.actions.length,H=game.hands[n.actor].length,result=new Float64Array(H*A),profile=profiles[n.actor];
    for(const h of n.handIds){
      const key=[...game.hands[n.actor][h]].sort().join(','),weights=profile.overrides.get(key)?.[n.street]||profile.base[n.street];
      const raw=n.actions.map(a=>weights[(a.type==='bet'||a.type==='raise')&&a.effectiveAllIn?'allin':a.type]),sum=raw.reduce((a,b)=>a+b,0);
      if(sum<=0)fail(`Policy has zero weight on every legal action at node ${n.id} (${n.street}, player ${n.actor+1}). Set a positive weight for an available action.`);
      raw.forEach((v,a)=>result[h*A+a]=v/sum);
    }
    return result;
  });
  return {policies,profiles:input};
}
function outcomeStacks(game,n,id,field){
  const o=n.outcome,d=game.scenarios[id],winner=o.reason==='fold'?o.winner:d.winner,pot=chipUnits(o.contestPot),units=pot/field.unit;
  const awards=winner===0?[pot,0]:winner===1?[0,pot]:[Math.ceil(units/2)*field.unit,Math.floor(units/2)*field.unit];
  const active=field.behind.map((start,p)=>(start-chipUnits(n.contributions[p])+chipUnits(o.refunds[p])+awards[p])/100);
  return [...active,...field.players.slice(2).map(p=>p.stack)];
}
function compareTournamentTree(request){
  const started=performance.now();
  if(!request||request.analysisKind!=='fixed-policy-icm'||!['turn','river'].includes(request.street))fail('Choose an explicit fixed-policy ICM turn or river analysis.');
  const spot=request.spot;
  if(!spot||spot.gameMode!=='tournament'||spot.gameType!=='holdem'||spot.solver||spot.tournament||spot.valuation)fail('Supply a Hold\'em tournament spot without cash solver options or nested valuation.');
  if(spot.solverStreet!==undefined&&spot.solverStreet!==request.street)fail('Street selector and spot must agree.');
  const geometry={...spot,gameMode:'cash',solverStreet:request.street},game=request.street==='turn'?prepareTurnGame(geometry):riverGame(geometry);
  if(game.visits>LIMITS.nodeDealVisits)fail('Tournament node/scenario budget exceeded. Narrow ranges or sizes.');
  const field=checkedField(request.tournament,game),{policies}=fixedPolicy(game,request.responsePolicy),N=field.players.length;
  // Cash evaluation is used only for its chip payoffs and actual policy reaches.
  // Monetary utility below is independent for EVERY field player; it is not zero-sum between the two actors.
  evaluateProfile(game,policies);
  const cache=new Map(),prizes=game.nodes.map(n=>Array.from({length:N},()=>new Float64Array(n.active.length)));
  for(let id=game.nodes.length-1;id>=0;id--){const n=game.nodes[id];
    if(n.kind==='terminal'){
      for(let i=0;i<n.active.length;i++){
        const stacks=outcomeStacks(game,n,n.active[i],field),key=stacks.map(s=>chipUnits(s)).join(',');
        if(!cache.has(key)){if(cache.size>=LIMITS.uniqueOutcomes)fail('Unique ICM outcome budget exceeded. Reduce configured sizes.');cache.set(key,resolveTournamentOutcome(stacks,field.starting,field.payouts).values);}
        const values=cache.get(key);for(let p=0;p<N;p++)prizes[id][p][i]=values[p];
      }
    }else if(n.kind==='chance'){
      for(const a of n.actions){const child=game.nodes[a.nodeId];for(let p=0;p<N;p++)for(let i=0;i<child.active.length;i++)prizes[id][p][child.parentSlots[i]]=prizes[child.id][p][i];}
    }else{
      const A=n.actions.length;for(let i=0;i<n.active.length;i++){const offset=game.scenarios[n.active[i]].hands[n.actor]*A;for(let p=0;p<N;p++)for(let a=0;a<A;a++)prizes[id][p][i]+=policies[id][offset+a]*prizes[n.actions[a].nodeId][p][i];}
    }
  }
  const nodes=[],P=game.P;
  for(const n of game.nodes){
    let mass=0;const actual=new Float64Array(game.hands[n.actor??0].length);
    for(let i=0;i<n.active.length;i++){const d=game.scenarios[n.active[i]],m=d.probability*n.r0[i]*n.r1[i];mass+=m;if(n.kind==='decision')actual[d.hands[n.actor]]+=m;}
    const prizeVector=Array.from({length:N},(_,p)=>mass>0?n.active.reduce((s,id,i)=>s+game.scenarios[id].probability*n.r0[i]*n.r1[i]*prizes[n.id][p][i],0)/mass:null);
    const out={nodeId:n.id,reachProbability:mass,expectedPrizes:prizeVector};
    if(n.kind==='chance')out.riverProbabilities=n.actions.map(a=>{const c=game.nodes[a.nodeId];const m=c.active.reduce((s,id,i)=>s+game.scenarios[id].probability*c.r0[i]*c.r1[i],0);return {card:a.card,probability:mass>0?m/mass:null};});
    if(n.kind==='decision'){
      const A=n.actions.length,p=n.actor,combos=n.handIds.map(h=>{
        let cf=0;const chip=new Float64Array(A),icm=new Float64Array(A);
        for(let i=0;i<n.active.length;i++){const d=game.scenarios[n.active[i]];if(d.hands[p]!==h)continue;const q=d.probability*(p===0?n.r1[i]:n.r0[i]);cf+=q;
          for(let a=0;a<A;a++){const child=n.actions[a].nodeId;icm[a]+=q*prizes[child][p][i];chip[a]+=q*(p===0?(game.nodes[child].value[i]+.5)*P:(.5-game.nodes[child].value[i])*P);}}
        return {cards:game.hands[p][h],reachProbability:actual[h],conditionalProbability:mass>0?actual[h]/mass:null,valueKind:cf===0?'unreachable':actual[h]===0?'counterfactual-only':'reached',frequencies:Array.from(policies[n.id].slice(h*A,(h+1)*A)),prizeEv:Array.from(icm,v=>cf>0?v/cf:null),chipNet:Array.from(chip,v=>cf>0?v/cf:null)};
      });
      const reference=Math.max(0,n.actions.findIndex(a=>a.type==='fold'||a.type==='check'));
      const aggregate=values=>mass>0?combos.reduce((s,c)=>s+c.reachProbability*values(c),0)/mass:null;
      const actions=n.actions.map((a,j)=>({index:j,type:a.type,label:a.label,frequency:aggregate(c=>c.frequencies[j]),prizeEv:aggregate(c=>c.prizeEv[j]??0),chipNet:aggregate(c=>c.chipNet[j]??0),
        expectedPrizes:prizeVector.map((_,player)=>mass>0?n.active.reduce((s,id,i)=>s+game.scenarios[id].probability*n.r0[i]*n.r1[i]*prizes[a.nodeId][player][i],0)/mass:null)}));
      for(const a of actions){a.deltaPrize=mass>0?a.prizeEv-actions[reference].prizeEv:null;a.deltaChips=mass>0?a.chipNet-actions[reference].chipNet:null;}
      const best=mass>0?Math.max(...actions.map(a=>a.prizeEv)):null;
      Object.assign(out,{actor:p,referenceAction:reference,actions,combos,preferredActions:best===null?[]:actions.filter(a=>Math.abs(a.prizeEv-best)<1e-8).map(a=>a.index)});
    }
    nodes.push(out);
  }
  const tree=game.nodes.map(n=>({id:n.id,parentId:n.parentId,incoming:n.incoming,kind:n.kind,actor:n.actor,street:n.street,board:n.board,pot:n.pot,remaining:n.remaining,contributions:n.contributions,toCall:n.toCall,actions:n.actions}));
  return {contractVersion:API_CONTRACT_VERSION,analysisKind:'fixed-policy-icm',valuation:icmTreeValuation(),street:request.street,runtimeMs:Math.round(performance.now()-started),
    input:{spot:game.input,tournament:request.tournament,responsePolicy:request.responsePolicy},fingerprint:createHash('sha256').update(JSON.stringify(request)).digest('hex'),
    field:{players:field.players,payouts:field.payouts,totalPrize:field.totalPrize},privateDeals:game.privateDeals,scenarios:game.scenarios.length,nodeDealVisits:game.visits,uniqueOutcomes:cache.size,limits:LIMITS,tree,nodes,
    notes:['Fixed-policy action evaluation, not an ICM equilibrium or tournament GTO solution. No zero-sum exploitability is reported.',
      'Every terminal stack vector is valued separately, including all outside players and elimination awards. ICM is not applied to average stacks.',
      'All monetary values are absolute expected prize units. Deltas compare with Fold where available, otherwise Check.',
      'One action is forced at the inspected node; all subsequent play follows the supplied, street/own-combo response weights, normalized over available actions. Aggregate actions are forced across the currently reached own range.',
      'Hand-start stacks fund the starting pot only from the two active players. Outside stacks stay fixed throughout this modeled hand. Rake, bounties and other dead-money contributors are unsupported.',
      'Zero-reach nodes have no observed aggregate recommendation. Counterfactual-only combo values describe deviations, not observed reached ranges.']};
}
module.exports={LIMITS,checkedField,fixedPolicy,outcomeStacks,compareTournamentTree};
