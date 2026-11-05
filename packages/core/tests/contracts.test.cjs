const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeCard,buildSolverRequest,buildRiverTreeRequest,chipValuation,icmActionValuation,parseValuation,ContractError}=require('..');
function draft(){return {players:[{name:' OOP ',stack:'200',mode:'hand',cards:[' ah ','10C']},{name:'IP',stack:'200',mode:'range',rangeDraft:{range:'KK',actionRanges:{call:'KhKc'},rangeAction:'base'}}],board:['2s','3d','7h','8c','9s'],pot:'100',chipUnit:'1',minBet:'2',bets:'50, 100',raises:'50',maxRaises:'1',includeAllIn:true};}
test('Portable request building normalizes cards and units without mutating UI drafts',()=>{
  const d=draft(),copy=JSON.stringify(d),r=buildSolverRequest(d,{iterations:'2000',target:'0.5'});
  assert.equal(JSON.stringify(d),copy);assert.deepEqual(r.players[0].input,['Ah','Tc']);assert.equal(r.players[0].name,'OOP');assert.deepEqual(r.betSizes,[.5,1]);assert.deepEqual(r.raiseSizes,[.5]);assert.equal(r.potSize,100);assert.equal(r.solver.maxIterations,2000);assert.equal(r.players[1].input.range,'KK');
  assert.equal(buildRiverTreeRequest(d).solver,undefined);
});
test('Turn requests preserve four board cards, separate street sizes and the explicit task selector',()=>{
  const d=draft();d.board.pop();d.maxRaises='0';d.bets='50';d.riverBets='';
  const r=buildSolverRequest(d,{iterations:'1500',target:'0'},'turn');assert.equal(r.solverStreet,'turn');assert.equal(r.board.length,4);assert.deepEqual(r.riverBetSizes,[]);assert.deepEqual(r.raiseSizes,[]);assert.equal(r.maxRaises,0);
});
for(const [name,change] of [ ['blank stack',d=>d.players[0].stack=''],['infinite stack',d=>d.players[0].stack='Infinity'],['card alias collision',d=>d.board[0]='10c'],['missing card',d=>d.players[0].cards[0]=null],['wrong hand count',d=>d.players[0].cards.push('Qd')],['zero pot',d=>d.pot='0'],['unknown game',d=>d.gameMode='tournament'],['tournament valuation',d=>d.valuation={kind:'icm-prize-ev'}],['duplicate sizes',d=>d.bets='50,50'],['empty range',d=>d.players[1].rangeDraft.range=''],['unknown action',d=>d.players[1].rangeDraft.rangeAction='jam']])test(`Invalid draft fails locally before transport: ${name}`,()=>{const d=draft();change(d);assert.throws(()=>buildSolverRequest(d,{iterations:'2000',target:'.5'}),ContractError);});
test('Card normalization preserves the established ten and suit aliases, rejecting malformed cards',()=>{
  assert.equal(normalizeCard(' 10H '),'Th');assert.equal(normalizeCard('as'),'As');for(const c of ['',null,12,'A h','1s','joker','Ahh'])assert.throws(()=>normalizeCard(c),ContractError);
});
test('Chip and ICM results have distinct units and baselines, and cannot be parsed interchangeably',()=>{
  const chips=chipValuation('turn',[-3,5],2),icm=icmActionValuation(28.571429,32.924092);
  assert.deepEqual(parseValuation(chips),chips);assert.equal(chips.baseline,'turn-start-stack');assert.equal(icm.baseline,'absolute-expected-prize');assert.ok(icm.difference.value<0);assert.deepEqual(parseValuation(icm),icm);
  for(const bad of [{...chips,unit:'prize-units'},{...icm,unit:'chips'},{...icm,baseline:'turn-start-stack'},{...chips,expectedNet:[NaN,1]},null])assert.throws(()=>parseValuation(bad),ContractError);
});
module.exports={draft};
