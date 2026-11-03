const { ValidationError } = require('./errors');
const { validateSimulationInput } = require('./validation');
const { chipUnits } = require('./payouts');
const { cardFromString } = require('./card');
const { prepareRanges } = require('./rangeSampler');
const { walkDeals } = require('./exact');
const { evaluatePlayer } = require('./engine');
const LIMITS = Object.freeze({ jointDeals: 20000, searchSteps: 200000, nodes: 512 });
const fail = message => { throw new ValidationError(message); };
const optional = (value, fallback) => value === undefined ? fallback : value;
function sizes(value, maximum, label) {
  if (!Array.isArray(value) || value.length > maximum || value.some(n => typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || n > 10))
    fail(`${label} must contain at most ${maximum} positive pot fractions, no greater than 10 (1000%).`);
  if (new Set(value).size !== value.length) fail(`${label} must not contain duplicates.`);
  return [...value].sort((a,b) => a-b);
}
function validateRiverInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('River tree input must be an object.');
  if ((optional(input.gameType, 'holdem')) !== 'holdem' || (optional(input.gameMode, 'cash')) !== 'cash')
    fail('Stage 10 supports heads-up no-limit Hold\'em cash Chip EV only; Omaha and tournament ICM trees are not supported.');
  if (input.tournament || input.betting || input.initialContributions) fail('Start at a fresh river decision with no outstanding bet or imported action ledger.');
  if (!Array.isArray(input.players) || input.players.length !== 2) fail('Exactly two players are required: OOP first, IP second.');
  if (!Array.isArray(input.board) || input.board.length !== 5) fail('A complete five-card river board is required.');
  const simulation = validateSimulationInput(input.players.map(p => p?.input), input.board, 'holdem', 1);
  const denomination = chipUnits(optional(input.chipUnit, 1), 'Smallest chip');
  if (!denomination) fail('Smallest chip must be positive.');
  const amount = (value,label,positive=true) => {
    const cents = chipUnits(value,label);
    if ((positive && cents <= 0) || cents % denomination !== 0) fail(`${label} must be positive and divisible by the smallest chip.`);
    return cents / denomination;
  };
  const pot = amount(input.potSize, 'River-start pot');
  const minBet = amount(optional(input.minBet, 2), 'Minimum full bet');
  const players = input.players.map((p,index) => {
    if (typeof p.name !== 'string' || !p.name.trim() || p.name.trim().length > 40) fail('Each player needs a name of 1–40 characters.');
    return { name: p.name.trim(), position:index === 0 ? 'OOP' : 'IP', stack:amount(p.stack, 'Stack behind'), input:simulation.players[index] };
  });
  if (!Number.isSafeInteger((pot + players[0].stack + players[1].stack) * denomination) || pot + players[0].stack + players[1].stack > 1e12) fail('Combined amounts exceed the river tree numeric work limit.');
  const maxRaises = optional(input.maxRaises, 1);
  if (![0,1].includes(maxRaises)) fail('This restricted tree permits zero or one raise per betting sequence.');
  const includeAllIn = optional(input.includeAllIn, true);
  if (typeof includeAllIn !== 'boolean') fail('includeAllIn must be a boolean.');
  return { players, board:simulation.board, pot, minBet, denomination,
    betSizes:sizes(optional(input.betSizes, [0.5,1]),3,'Bet sizes'),
    raiseSizes:sizes(optional(input.raiseSizes, [0.5,1]),2,'Raise sizes'), maxRaises, includeAllIn };
}
// Exact product-weighted private deals conditioned on all known and mutual blockers.
// Shared by the tree now; stage 11 can use these private outcomes for information sets.
function prepareRiverDeals(model) {
  const prepared = prepareRanges(model.players.map(p => p.input),model.board,1);
  const board = model.board.map(cardFromString), caches=[new Map(),new Map()];
  const deals=[]; let mass=0; const wins=[0,0]; let ties=0;
  const score=(index,cards) => {
    const key=[...cards].sort((a,b)=>a-b).join(',');
    if (!caches[index].has(key)) caches[index].set(key,evaluatePlayer(cards,board,'holdem'));
    return caches[index].get(key);
  };
  const result=walkDeals(prepared.candidates,board,{maxDeals:LIMITS.jointDeals,maxSteps:LIMITS.searchSteps,candidateWeights:prepared.candidateWeights},(hands,weight)=>{
    const a=score(0,hands[0]),b=score(1,hands[1]);
    const winner=a===b ? null : a>b ? 0 : 1;
    mass+=weight; if(winner===null) ties+=weight; else wins[winner]+=weight;
    deals.push({ hands:hands.map(cards=>[...cards]), weight, winner });
  });
  if (result.overflow) fail('Exact river range work limit exceeded. Narrow the ranges; no partial tree or sampled value is returned.');
  if (!deals.length || !Number.isFinite(mass) || mass<=0) fail('No positive-weight compatible private deals remain.');
  return { deals, totalMass:mass, winProbability:wins.map(v=>v/mass), tieProbability:ties/mass,
    rangeStats:prepared.rangeStats, availableCombos:prepared.candidates.map(list=>list.length) };
}
function buildRiverTree(input) {
  const model=validateRiverInput(input), chance=prepareRiverDeals(model);
  const {players,pot,minBet,denomination}=model, cap=Math.min(...players.map(p=>p.stack));
  const money=n=>n*denomination/100;
  const clean=n=>Math.abs(n)<1e-10 ? 0 : n;
  const nodes=[];
  function visit(state,parentId=null,incoming=null,terminal=null) {
    if(nodes.length>=LIMITS.nodes) fail('River tree node limit exceeded. Reduce the configured sizes.');
    const id=nodes.length, contributions=state.contributions;
    const currentPot=pot+contributions[0]+contributions[1];
    const node={id,parentId,incoming,kind:terminal?'terminal':'decision',actor:terminal?null:state.actor,
      pot:money(currentPot),contributions:contributions.map(money),
      remaining:players.map((p,i)=>money(p.stack-contributions[i])),actions:[]};
    nodes.push(node);
    if(terminal) {
      const matched=Math.min(...contributions),refunds=contributions.map(c=>c-matched),contestPot=pot+2*matched;
      let awards;
      if(terminal.reason==='fold') awards=[terminal.winner===0?contestPot:0,terminal.winner===1?contestPot:0];
      else {
        // With IP on the button, OOP is first left of the button and gets an odd split chip.
        const half=Math.floor(contestPot/2),odd=contestPot%2;
        awards=[chance.winProbability[0]*contestPot+chance.tieProbability*(half+odd),chance.winProbability[1]*contestPot+chance.tieProbability*half];
      }
      const ending=players.map((p,i)=>p.stack-contributions[i]+refunds[i]+awards[i]);
      node.outcome={reason:terminal.reason,winner:terminal.winner??null,contestPot:money(contestPot),
        refunds:refunds.map(money),expectedAwards:awards.map(v=>clean(money(v))),
        endingStacks:ending.map(v=>clean(money(v))),
        netFromRiver:ending.map((v,i)=>clean(money(v-players[i].stack))),
        interpretation:'Branch-conditional payoff under unchanged input priors; not an action EV or a solved response policy.'};
      return id;
    }
    const actor=state.actor,other=1-actor,high=Math.max(...contributions),toCall=high-contributions[actor];
    node.toCall=money(toCall);node.effectiveCap=money(cap);
    node.minRaiseTo=toCall?money(high+state.lastFullRaise):null;
    node.omitted=[];
    function edge(type,next,end=null,to=null) {
      const action={type,player:actor,label:type==='check'?'Check':type==='fold'?'Fold':type==='call'?`Call ${money(toCall)}`:`${type==='bet'?'Bet':'Raise to'} ${money(to)}${to===cap?' · all-in to effective stack':''}`,
        ...(to===null?{}:{to:money(to),increment:money(to-contributions[actor]),effectiveAllIn:to===cap})};
      action.nodeId=visit(next,id,action.label,end);node.actions.push(action);
    }
    if(toCall) {
      edge('fold',state,{reason:'fold',winner:other});
      const called=[...contributions];called[actor]=high;
      edge('call',{...state,contributions:called},{reason:'showdown'});
    } else {
      edge('check',{...state,actor:other,checked:true},state.checked?{reason:'showdown'}:null);
    }
    if (toCall && state.raisesUsed>=model.maxRaises) {node.omitted.push('Further raises are outside the configured raise cap.');return id;}
    if(high>=cap) return id;
    const targets=new Set();
    const fractions=toCall?model.raiseSizes:model.betSizes;
    const sizingPot=toCall?currentPot+toCall:currentPot;
    for(const fraction of fractions) {
      const target=Math.min(cap,(toCall?high:0)+Math.round(sizingPot*fraction));
      const full=toCall?target-high>=state.lastFullRaise:target>=minBet;
      if(target>high && (full || target===cap)) targets.add(target);
      else node.omitted.push(`${toCall?'Raise':'Bet'} ${fraction*100}% omitted: below the minimum full wager after chip rounding.`);
    }
    if(model.includeAllIn && cap>high) targets.add(cap);
    for(const target of [...targets].sort((a,b)=>a-b)) {
      const nextContributions=[...contributions];nextContributions[actor]=target;
      edge(toCall?'raise':'bet',{contributions:nextContributions,actor:other,checked:false,
        raisesUsed:state.raisesUsed+(toCall?1:0),lastFullRaise:Math.max(state.lastFullRaise,target-high)},null,target);
    }
    return id;
  }
  visit({actor:0,contributions:[0,0],checked:false,raisesUsed:0,lastFullRaise:minBet});
  return {
    version:1,scope:'heads-up-river-holdem-cash',method:'exact-private-deals',rootId:0,
    input:{gameType:'holdem',gameMode:'cash',board:model.board,potSize:money(pot),chipUnit:money(1),minBet:money(minBet),
      players:players.map(p=>({...p,stack:money(p.stack)})),betSizes:model.betSizes,raiseSizes:model.raiseSizes,maxRaises:model.maxRaises,includeAllIn:model.includeAllIn},
    chance:{jointDeals:chance.deals.length,totalMass:chance.totalMass,winProbability:chance.winProbability,tieProbability:chance.tieProbability,availableCombos:chance.availableCombos,rangeStats:chance.rangeStats},
    nodes,summary:{nodes:nodes.length,decisions:nodes.filter(n=>n.kind==='decision').length,terminals:nodes.filter(n=>n.kind==='terminal').length,effectiveStack:money(cap)},limits:LIMITS,
    notes:[
      'Start of river only: existing pot and stacks behind, no outstanding bet, no rake or side pots.',
      'Configured sizes only; at most one raise, with no re-raises. Oversized targets merge at the effective stack cap.',
      'Raise sizes are fractions of the pot AFTER calling, added to the current highest contribution.',
      'Input ranges remain unchanged in every branch. No strategy, response probabilities, recommended action or root action EV is solved in stage 10.',
      'Net from river is ending stack minus river-start stack. The two net values sum to the existing pot, not zero.',
      'IP is the button; OOP receives any odd chip in a tied showdown.',
    ],
  };
}
module.exports={LIMITS,validateRiverInput,prepareRiverDeals,buildRiverTree};
