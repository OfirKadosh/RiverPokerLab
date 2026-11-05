const {ValidationError}=require('./errors');
const LIMITS=Object.freeze({jointDeals:4000,informationSets:8000,work:60000000,maxIterations:20000,dealNodeCells:500000,typedArrayBytes:8*1024*1024});
function riverResourcePlan(tree,hands,deals,layout,maxIterations){
  const D=deals.length,N=tree.nodes.length,informationSets=layout.reduce((sum,l)=>sum+(l?.count||0),0);
  const entries=layout.reduce((sum,l)=>sum+(l?l.count*l.actions:0),0);
  let reachEntries=hands[0].length+hands[1].length;
  for(const n of tree.nodes)if(n.kind==='decision'&&n.parentId!==null)reachEntries+=hands[tree.nodes[n.parentId].actor].length;
  const terminalBytes=tree.nodes.filter(n=>n.kind==='terminal').length*D*8;
  const kernelBytes=tree.nodes.filter(n=>n.kind==='decision').length*D*8+reachEntries*8+D*16;
  const strategyBytes=entries*8*3,coreTypedArrayBytes=terminalBytes+kernelBytes+strategyBytes;
  return {jointDeals:D,publicNodes:N,informationSets,dealNodeCells:D*N,estimatedWork:(maxIterations+60)*D*N,
    terminalBytes,kernelBytes,strategyBytes,coreTypedArrayBytes};
}
function enforceRiverBudget(plan,{checkWork=true}={}){
  if(plan.jointDeals>LIMITS.jointDeals||plan.informationSets>LIMITS.informationSets)
    throw new ValidationError('Solver range/information-set limit exceeded. Narrow the private ranges.');
  if(plan.dealNodeCells>LIMITS.dealNodeCells||plan.coreTypedArrayBytes>LIMITS.typedArrayBytes)
    throw new ValidationError('Solver memory budget exceeded. Reduce private ranges or configured sizes. No partial solution is returned.');
  if(checkWork&&plan.estimatedWork>LIMITS.work)
    throw new ValidationError('Solver work budget exceeded. Reduce iterations, sizes or private ranges. No partial solution is returned.');
}
module.exports={LIMITS,riverResourcePlan,enforceRiverBudget};
