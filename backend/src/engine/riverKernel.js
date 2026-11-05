// A public tree is compiled once; current policies remain frozen across a full CFR iteration.
// Own action reach depends on public history and OWN hand, not the opponent's hidden deal.
function createCfrKernel(game,current,regrets,sums) {
  const {tree,deals,layout}=game,D=deals.length;
  const hand0=Uint32Array.from(deals,d=>d.hands[0]),hand1=Uint32Array.from(deals,d=>d.hands[1]);
  const chance=Float64Array.from(deals,d=>d.probability),hands=[hand0,hand1];
  const reach=[Array(tree.nodes.length),Array(tree.nodes.length)],edges=[],nodes=[];
  reach[0][0]=new Float64Array(game.hands[0].length).fill(1);
  reach[1][0]=new Float64Array(game.hands[1].length).fill(1);
  const values=tree.nodes.map(n=>n.kind==='terminal'?game.utilities[n.id]:new Float64Array(D));
  for(const n of tree.nodes){
    if(n.kind!=='decision')continue;
    const children=n.actions.map(a=>values[a.nodeId]),p=n.actor,A=children.length;
    nodes.push({id:n.id,p,A,H:layout[n.id].count,children,value:values[n.id],policy:current[n.id],regret:regrets[n.id],sum:sums[n.id]});
    for(let a=0;a<A;a++){
      const child=n.actions[a].nodeId;if(tree.nodes[child].kind!=='decision')continue;
      reach[p][child]=new Float64Array(game.hands[p].length);
      reach[1-p][child]=reach[1-p][n.id];
      edges.push({source:reach[p][n.id],target:reach[p][child],policy:current[n.id],A,a});
    }
  }
  const allocated=new Set([hand0,hand1,chance,...values.filter((v,id)=>!game.utilities[id]),...reach.flat().filter(Boolean)]);
  const bytes=[...allocated].reduce((sum,a)=>sum+a.byteLength,0);
  function step(){
    for(const n of nodes){
      const {A,H,policy,regret}=n;
      for(let h=0;h<H;h++){
        const offset=h*A;let positive=0;
        for(let a=0;a<A;a++)positive+=Math.max(0,regret[offset+a]);
        for(let a=0;a<A;a++)policy[offset+a]=positive>0?Math.max(0,regret[offset+a])/positive:1/A;
      }
    }
    for(const edge of edges){
      const {source,target,policy,A,a}=edge;
      for(let h=0;h<target.length;h++)target[h]=source[h]*policy[h*A+a];
    }
    for(let i=nodes.length-1;i>=0;i--){
      const n=nodes[i],{id,p,A,H,policy,regret,sum,children,value}=n;
      const ownHand=hands[p],opponentHand=hands[1-p],opponentReach=reach[1-p][id],ownReach=reach[p][id],sign=p===0?1:-1;
      for(let d=0;d<D;d++){
        const offset=ownHand[d]*A;let v=0;
        for(let a=0;a<A;a++)v+=policy[offset+a]*children[a][d];
        value[d]=v;
        const other=chance[d]*opponentReach[opponentHand[d]]*sign;
        for(let a=0;a<A;a++)regret[offset+a]+=other*(children[a][d]-v);
      }
      // The positive chance marginal is constant per own hand and cancels when
      // its average strategy is normalized. Chance still weights every regret.
      for(let h=0;h<H;h++){
        const offset=h*A,r=ownReach[h];
        for(let a=0;a<A;a++)sum[offset+a]+=r*policy[offset+a];
      }
    }
  }
  return {step,bytes};
}
module.exports={createCfrKernel};
