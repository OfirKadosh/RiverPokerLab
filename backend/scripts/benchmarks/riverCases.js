function base(){return {players:[{name:'OOP',stack:1,input:{type:'range',range:'2h2c,3h3c,4h4c'}},{name:'IP',stack:1,input:{type:'range',range:'2h2c,3h3c,4h4c'}}],board:['As','Ks','Qh','9d','7c'],potSize:2,minBet:1,chipUnit:1,betSizes:[.5],raiseSizes:[],maxRaises:0,includeAllIn:false,solver:{maxIterations:20000,targetPotPct:0}};}
function riverCase(name){
  const input=base();
  if(name==='pairs-456'||name==='weighted-456'){
    input.players.forEach(p=>p.input.range='22,33,44,55');input.solver.maxIterations=name==='pairs-456'?7000:2000;
    if(name==='weighted-456'){input.players[0].input.range='22@10%,33@30%,44@70%,55';input.players[1].input.range='22@90%,33@60%,44@20%,55@40%';}
  }else if(name==='raised-12'){
    input.players.forEach(p=>{p.stack=4;p.input.range='AhAc,KhKc,QhQc,JhJc';});input.board=['2s','3d','7h','8c','9s'];input.betSizes=[.5,1];input.raiseSizes=[.5];input.maxRaises=1;input.includeAllIn=true;input.solver.maxIterations=5000;
  }else if(name==='expanded-2064'){
    input.players.forEach(p=>p.input.range='22,33,44,55,66,88,TT,JJ');input.solver.maxIterations=3000;
  }else if(name!=='kuhn-6')throw Error('Unknown benchmark case.');
  return input;
}
module.exports={riverCase,names:['kuhn-6','pairs-456','weighted-456','raised-12','expanded-2064']};
