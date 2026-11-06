const API_CONTRACT_VERSION=1;
const RANKS=Object.freeze(['A','K','Q','J','T','9','8','7','6','5','4','3','2']);
const SUITS=Object.freeze(['s','h','c','d']);
const SYMBOLS=Object.freeze({s:'♠',h:'♥',c:'♣',d:'♦'});
const SUIT_NAMES=Object.freeze({s:'spades',h:'hearts',c:'clubs',d:'diamonds'});
const handSize=type=>type==='omaha'?4:2;
class ContractError extends Error {constructor(message,field){super(message);this.name='ContractError';this.code='INVALID_CONTRACT';if(field)this.field=field;}}
const fail=(message,field)=>{throw new ContractError(message,field);};
function normalizeCard(value){
  if(typeof value!=='string')fail('Every card must be a string.','cards');
  const match=/^(10|[2-9TJQKA])([shcd])$/i.exec(value.trim());if(!match)fail('Use a valid card such as Ah, Kc or 10s.','cards');
  return (match[1]==='10'?'T':match[1].toUpperCase())+match[2].toLowerCase();
}
function number(value,label,{min=0,integer=false,positive=false,max=Infinity}={}){
  if(typeof value!=='number'&&typeof value!=='string'||typeof value==='string'&&!value.trim())fail(`${label} is required.`,label);
  const n=Number(value);if(!Number.isFinite(n)||n<min||positive&&n<=0||n>max||integer&&!Number.isInteger(n))fail(`${label} is invalid.`,label);return n;
}
function percentages(value,label,maxCount){
  if(typeof value!=='string')fail(`${label} must be percentage text.`,label);if(!value.trim())return [];
  const parts=value.split(',').map(s=>s.trim());if(parts.length>maxCount||parts.some(s=>!/^\d+(?:\.\d+)?$/.test(s)))fail(`${label}: enter up to ${maxCount} positive percentages separated by commas.`,label);
  const values=parts.map(s=>number(s,label,{positive:true,max:1000})/100);if(new Set(values).size!==values.length)fail(`${label} contains duplicate sizes.`,label);return values;
}
function assertChipSolverValuation(input){
  if(input?.valuation!==undefined&&(!input.valuation||typeof input.valuation!=='object'||Array.isArray(input.valuation)||input.valuation.kind!=='chip-ev'||input.valuation.unit!==undefined&&input.valuation.unit!=='chips'))
    fail('This strategy solver supports chip-ev only. Use the separate fixed-policy tournament comparison for ICM.','valuation');
}
function spot(draft,street){
  if(!draft||typeof draft!=='object'||!['turn','river'].includes(street))fail('Choose a river or turn spot.','street');
  if(draft.gameType!==undefined&&draft.gameType!=='holdem'||draft.gameMode!==undefined&&draft.gameMode!=='cash')fail('This strategy workspace supports Hold\'em cash only.','gameMode');
  assertChipSolverValuation(draft);
  const count=street==='turn'?4:5;
  if(!Array.isArray(draft.board)||draft.board.length!==count)fail(`A ${count}-card ${street} board is required.`,'board');
  const board=draft.board.map(normalizeCard),used=new Set(board);if(used.size!==board.length)fail('A card is selected more than once.','cards');
  if(!Array.isArray(draft.players)||draft.players.length!==2)fail('Exactly two players are required.','players');
  const players=draft.players.map((p,i)=>{
    if(typeof p.name!=='string'||!p.name.trim()||p.name.trim().length>40)fail('Each player needs a name of 1–40 characters.','players');
    let input;
    if(p.mode==='hand'){
      if(!Array.isArray(p.cards)||p.cards.length!==2)fail('Hold\'em requires two private cards.','cards');
      input=p.cards.map(normalizeCard);for(const c of input){if(used.has(c))fail('A card is selected more than once.','cards');used.add(c);}
    }else if(p.mode==='range'){
      const range=p.rangeDraft;if(!range||typeof range.range!=='string'||!range.range.trim())fail(`Player ${i+1} needs a range.`,'range');
      const action=range.rangeAction||'base',allowed=['fold','check','call','bet','raise','allin'];
      if(action!=='base'&&!allowed.includes(action))fail('Unknown range action.','rangeAction');
      const actionRanges={};if(range.actionRanges!==undefined){if(!range.actionRanges||typeof range.actionRanges!=='object'||Array.isArray(range.actionRanges))fail('Action ranges must be an object.','actionRanges');for(const [key,value] of Object.entries(range.actionRanges)){if(!allowed.includes(key)||typeof value!=='string')fail('Invalid action range.','actionRanges');actionRanges[key]=value;}}
      input={type:'range',range:range.range,actionRanges,rangeAction:action};
    }else fail('Choose a specific hand or range.','players');
    return {name:p.name.trim(),stack:number(p.stack,'Stack behind',{positive:true}),input};
  });
  if(typeof draft.includeAllIn!=='boolean')fail('includeAllIn must be boolean.','includeAllIn');
  const maxRaises=number(draft.maxRaises,'Raise cap',{integer:true,max:street==='turn'?0:1});
  const result={gameType:'holdem',gameMode:'cash',board,players,potSize:number(draft.pot,'Starting pot',{positive:true}),chipUnit:number(draft.chipUnit,'Smallest chip',{positive:true}),minBet:number(draft.minBet,'Minimum bet',{positive:true}),betSizes:percentages(draft.bets,'Bet sizes',street==='turn'?1:3),raiseSizes:street==='turn'?[]:percentages(draft.raises,'Raise sizes',2),maxRaises,includeAllIn:draft.includeAllIn};
  if(street==='turn'){result.solverStreet='turn';result.riverBetSizes=percentages(draft.riverBets||'','River bet sizes',1);}
  return result;
}
function buildRiverTreeRequest(draft){return spot(draft,'river');}
function buildSolverRequest(draft,options,street='river'){
  const input=spot(draft,street);if(!options||typeof options!=='object')fail('Solver options are required.','solver');
  input.solver={maxIterations:number(options.iterations,'Solver iterations',{integer:true,min:100,max:street==='turn'?2000:20000}),targetPotPct:number(options.target,'Exploitability target',{max:5})};return input;
}
function finite(value,label){if(typeof value!=='number'||!Number.isFinite(value))fail(`${label} must be finite.`,label);return value;}
function chipValuation(street,expectedNet,startingPot){
  if(!['turn','river'].includes(street)||!Array.isArray(expectedNet)||expectedNet.length!==2)fail('Invalid chip valuation.','valuation');
  if(finite(startingPot,'startingPot')<=0)fail('The starting pot must be positive.','startingPot');
  return {kind:'chip-ev',unit:'chips',baseline:`${street}-start-stack`,street,startingPot:finite(startingPot,'startingPot'),expectedNet:expectedNet.map(v=>finite(v,'expectedNet'))};
}
function icmActionValuation(call,fold){
  finite(call,'call');finite(fold,'fold');if(call<0||fold<0)fail('Expected prize values cannot be negative.','valuation');
  return {kind:'icm-prize-ev',unit:'prize-units',baseline:'absolute-expected-prize',model:'Malmuth-Harville ICM',expectedByAction:{call,fold},difference:{action:'call',reference:'fold',value:call-fold}};
}
function icmTreeValuation(){return {kind:'icm-tree-ev',unit:'prize-units',baseline:'absolute-expected-prize',model:'Malmuth-Harville ICM',evaluation:'fixed-response-policy'};}
function buildTournamentTreeRequest(draft,tournament,responsePolicy,street='river'){
  const input=spot(draft,street);
  if(!tournament||tournament.fieldConfirmed!==true||!responsePolicy||responsePolicy.confirmed!==true)fail('Confirm the full tournament field and fixed response policies.','tournament');
  return {analysisKind:'fixed-policy-icm',street,spot:{...input,gameMode:'tournament'},tournament:JSON.parse(JSON.stringify(tournament)),responsePolicy:JSON.parse(JSON.stringify(responsePolicy))};
}
function parseValuation(value){
  if(!value||typeof value!=='object')fail('Missing valuation metadata.','valuation');
  if(value.kind==='icm-tree-ev'&&value.unit==='prize-units'&&value.baseline==='absolute-expected-prize'&&value.model==='Malmuth-Harville ICM'&&value.evaluation==='fixed-response-policy')return icmTreeValuation();
  if(value.kind==='chip-ev'&&value.unit==='chips'&&value.baseline===`${value.street}-start-stack`)return chipValuation(value.street,value.expectedNet,value.startingPot);
  if(value.kind==='icm-prize-ev'&&value.unit==='prize-units'&&value.baseline==='absolute-expected-prize'&&value.model==='Malmuth-Harville ICM')return icmActionValuation(value.expectedByAction?.call,value.expectedByAction?.fold);
  fail('Unsupported valuation kind, unit or baseline.','valuation');
}
module.exports={buildTournamentTreeRequest,icmTreeValuation,API_CONTRACT_VERSION,RANKS,SUITS,SYMBOLS,SUIT_NAMES,handSize,ContractError,normalizeCard,buildRiverTreeRequest,buildSolverRequest,assertChipSolverValuation,chipValuation,icmActionValuation,parseValuation};
