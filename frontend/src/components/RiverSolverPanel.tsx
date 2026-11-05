import {useEffect,useState} from 'react';
import type {Dispatch,SetStateAction} from 'react';
import type {RiverTree,RiverWorkspace} from '../lib/riverTree';
import type {RiverJobController} from '../hooks/useRiverJob';
const num=(n:number)=>new Intl.NumberFormat('en-US',{maximumFractionDigits:4}).format(n);
const pct=(n:number|null)=>n===null?'—':`${(n*100).toFixed(2)}%`;
const money=(n:number|null)=>n===null?'—':num(n);
const colors=['#8ab4fa','#64d98b','#f5c96a','#be97f5','#ef9f87','#abb2bd'];
const ranks='AKQJT98765432';
function handClass(cards:string[]){const [a,b]=cards;return a[0]===b[0]?a[0]+b[0]:ranks.indexOf(a[0])<ranks.indexOf(b[0])?a[0]+b[0]+(a[1]===b[1]?'s':'o'):b[0]+a[0]+(a[1]===b[1]?'s':'o');}
function publicPath(tree:RiverTree,id:number){const labels:string[]=[];let n=tree.nodes[id];while(n.parentId!==null){labels.unshift(n.incoming||'');n=tree.nodes[n.parentId];}return labels.join(' → ')||'Root';}
export function RiverSolverPanel({controller,tree,treeKey,state,setState,building}:{controller:RiverJobController;tree:RiverTree;treeKey:string;state:RiverWorkspace;setState:Dispatch<SetStateAction<RiverWorkspace>>;building:boolean}){
  const key=JSON.stringify([treeKey,state.solver]),result=state.solution?.key===key?state.solution.result:null;
  const [filter,setFilter]=useState<string|null>(null);
  useEffect(()=>setFilter(null),[key,state.selected]);
  const node=tree.nodes[state.selected],policy=result?.metrics.nodePolicies.find(n=>n.nodeId===node?.id);
  function settings(field:'iterations'|'target',value:string){setState(s=>({...s,solver:{...s.solver,[field]:value},solution:null}));}
  function solve(){controller.start({...tree.input,solver:{maxIterations:Number(state.solver.iterations),targetPotPct:Number(state.solver.target)}});}
  const limits=tree.solverLimits||{jointDeals:1000,informationSets:4000,work:30000000,maxIterations:20000,dealNodeCells:500000,typedArrayBytes:8*1024*1024};
  const iterations=Number(state.solver.iterations),cells=tree.chance.jointDeals*tree.summary.nodes;
  const estimatedWork=Number.isFinite(iterations)&&iterations>0?(iterations+60)*cells:0;
  const overBudget=tree.chance.jointDeals>limits.jointDeals||cells>limits.dealNodeCells||estimatedWork>limits.work;
  const suggestedIterations=Math.min(limits.maxIterations,Math.floor(limits.work/Math.max(cells,1))-60);
  const maxY=result?Math.max(...result.history.map(h=>h.exploitabilityPotPct),.001):1;
  const points=result?.history.map(h=>`${10+580*h.iteration/Math.max(result.iterationsCompleted,1)},${140-125*h.exploitabilityPotPct/maxY}`).join(' ');
  return <section className="river-solver" aria-label="River strategy solver">
    <h3>Average strategy · restricted river game</h3>
    <p className="inline-note">Solve both players' private-hand strategies using CFR. Quality is measured by exact best responses in this tree. Other bet sizes, turn play, Omaha, tournaments and full-game GTO are outside this solution.</p>
    <div className="river-settings"><label className="field-label">ITERATION LIMIT<input aria-label="Solver iteration limit" type="number" min="100" max="20000" step="100" value={state.solver.iterations} onChange={e=>settings('iterations',e.target.value)}/></label><label className="field-label">EXPLOITABILITY TARGET · % STARTING POT<input aria-label="Solver exploitability target" type="number" min="0" max="5" step="0.1" value={state.solver.target} onChange={e=>settings('target',e.target.value)}/></label></div>
    <p className="field-help">Up to {num(limits.jointDeals)} legal joint deals, {num(limits.informationSets)} information sets and {num(limits.work/1000000)} million deal × node × iteration work units. Narrow ranges or reduce iterations/sizes when the budget is exceeded. Results stay in this session.</p>
    <div className={`solver-budget ${overBudget?'over-budget':''}`} aria-live="polite"><strong>Estimated workload: {num(estimatedWork)} / {num(limits.work)}</strong><p>{tree.chance.jointDeals} legal deals × {tree.summary.nodes} public nodes · {estimatedWork>0?(estimatedWork/limits.work*100).toFixed(1):'0'}% of the work budget.</p>{overBudget&&<p>{tree.chance.jointDeals>limits.jointDeals||cells>limits.dealNodeCells||suggestedIterations<100?'Reduce private ranges or configured sizes to fit this tree.':`Try at most ${suggestedIterations.toLocaleString('en-US')} iterations, or reduce ranges/sizes.`} The server also checks information-set and memory limits.</p>}</div>
    <button className="primary-button" disabled={controller.active||building||overBudget} onClick={solve}>{controller.active?'Calculation in progress…':'Solve river strategy'}</button>
    {controller.error&&<p className="validation-note" role="alert">{controller.error}</p>}
    <p className="field-help">You can switch pages while solving. Editing river inputs or solver settings cancels the previous task. Tasks are temporary: server restarts can interrupt them, and retained results expire after 10 minutes or earlier under memory pressure.</p>
    {result&&<div className="solver-report">
      <p role="status" className={result.targetReached?'auth-notice':'validation-note'}>{result.targetReached?'Target reached within this tree.':'Iteration limit reached; target NOT reached.'} {result.iterationsCompleted.toLocaleString('en-US')} iterations · {result.runtimeMs} ms · {result.jointDeals} joint deals · {result.informationSets} information sets.</p>
      <div className="solver-metrics"><div><small>EXPLOITABILITY</small><strong>{num(result.metrics.exploitability)} chips</strong><span>{result.metrics.exploitabilityPotPct.toFixed(4)}% of starting pot</span></div><div><small>NASHCONV · SUM OF DEVIATION GAINS</small><strong>{num(result.metrics.nashConv)} chips</strong><span>Exploitability = NashConv / 2</span></div></div>
      <div className="river-outcome-wrap"><table className="river-outcome"><caption>Root EV · net from river-start stack</caption><thead><tr><th>Player</th><th>Average strategy</th><th>Best response</th><th>Unilateral gain</th></tr></thead><tbody>{tree.input.players.map((p,i)=><tr key={i}><th>{p.name}</th><td>{num(result.metrics.expectedNet[i])}</td><td>{num(result.metrics.bestResponseNet[i])}</td><td>{num(result.metrics.deviationGains[i])}</td></tr>)}</tbody></table></div>
      <p className="field-help">The existing pot is awarded by play: the two average net EVs sum to {num(tree.input.potSize)} chips. Each best response changes only that player's strategy against the other player's average strategy.</p>
      {result.performance&&<details className="solver-performance"><summary>Calculation time and resource details</summary><div className="river-outcome-wrap"><table className="river-outcome"><caption>Worker measurements · this calculation</caption><thead><tr><th>Phase</th><th>Time</th></tr></thead><tbody>{([['Prepare spot',result.performance.timingsMs.setup],['Strategy iterations',result.performance.timingsMs.iterations],['Quality checks',result.performance.timingsMs.quality],['Result report',result.performance.timingsMs.report]] as const).map(([label,time])=><tr key={label}><th>{label}</th><td>{num(time)} ms</td></tr>)}</tbody></table></div><p className="field-help">Core solver buffers: {num(result.performance.resources.coreTypedArrayBytes/1048576)} MiB · {num(result.performance.resources.dealNodeCells)} deal × node cells. This counts the main numerical buffers; it is not the server's total memory usage. Runtime varies by device and hosting resources.</p></details>}
      <figure className="solver-convergence"><figcaption>Measured exploitability · % starting pot · checkpoints may fluctuate</figcaption><svg viewBox="0 0 600 155" role="img" aria-label={`Exploitability from ${result.history[0].exploitabilityPotPct.toFixed(4)} to ${result.metrics.exploitabilityPotPct.toFixed(4)} percent of starting pot`}><path d="M10 10V140H590" stroke="#6e817d" fill="none"/><polyline points={points} stroke="#b9ed73" strokeWidth="3" fill="none"/></svg><small>0 → {result.iterationsCompleted} iterations · vertical scale 0–{maxY.toFixed(3)}%</small></figure>
      <details><summary>Exact convergence checkpoints</summary><div className="river-outcome-wrap"><table className="river-outcome"><thead><tr><th>Iteration</th><th>Exploitability · chips</th><th>% starting pot</th></tr></thead><tbody>{result.history.map(h=><tr key={h.iteration}><td>{h.iteration}</td><td>{num(h.exploitability)}</td><td>{h.exploitabilityPotPct.toFixed(4)}%</td></tr>)}</tbody></table></div></details>
      <label className="field-label">STRATEGY AT PUBLIC NODE<select aria-label="Strategy public node" value={node?.kind==='decision'?state.selected:''} onChange={e=>setState(s=>({...s,selected:Number(e.target.value)}))}><option value="" disabled>Select a decision node</option>{tree.nodes.filter(n=>n.kind==='decision').map(n=><option key={n.id} value={n.id}>#{n.id} · {publicPath(tree,n.id)} · {tree.input.players[n.actor!].name}</option>)}</select></label>
      {!policy&&<p className="inline-note">This is a terminal branch. Select a decision node to inspect its strategy.</p>}
      {policy&&<>
        <h4>{tree.input.players[policy.actor].name} · node #{node.id} · reached {pct(policy.reachProbability)}</h4>
        <div className="solver-action-legend">{node.actions.map((a,j)=><span key={j} style={{borderColor:colors[j%colors.length]}}>{a.label}: {pct(policy.frequencies[j])} · EV {money(policy.actionEv[j])}</span>)}</div>
        <p className="field-help">Public frequencies use the range that actually reaches this node. Each combo's action EV forces that action, then follows the average continuation, measured from river start. Off-path own choices retain counterfactual EV; an impossible opponent path has no EV (—).</p>
        <div className="solver-matrix" role="group" aria-label="Solved hand classes">{[...ranks].flatMap((r,i)=>[...ranks].map((c,j)=>{
          const label=i===j?r+c:i<j?r+c+'s':c+r+'o',combos=policy.combos.filter(h=>handClass(h.cards)===label);
          const mass=combos.reduce((s,h)=>s+h.reachProbability,0);let stop=0;
          const gradient=node.actions.map((_,a)=>{const from=stop;stop+=mass>0?combos.reduce((s,h)=>s+h.reachProbability*h.frequencies[a],0)/mass*100:0;return `${colors[a%colors.length]} ${from}% ${stop}%`;}).join(',');
          return <button key={label} type="button" disabled={!combos.length} aria-label={`${label}${mass===0?' off path':''}`} aria-pressed={filter===label} className={filter===label?'selected':''} style={mass>0?{background:`linear-gradient(to right,${gradient})`}:undefined} onClick={()=>setFilter(filter===label?null:label)}>{label}</button>;
        }))}</div>
        <button className="text-button" onClick={()=>setFilter(null)}>All combos{filter?` · showing ${filter}`:''}</button>
        <div className="river-outcome-wrap solver-combos"><table className="river-outcome"><caption>Private combo strategies · {filter||'all classes'}</caption><thead><tr><th>Combo</th><th>Node range</th><th>Status</th>{node.actions.map(a=><th key={a.nodeId}>{a.label}<small>Frequency / action EV</small></th>)}</tr></thead><tbody>{policy.combos.filter(c=>!filter||handClass(c.cards)===filter).map(c=><tr key={c.cards.join('')}><th>{c.cards.join(' ')}</th><td>{pct(c.conditionalProbability)}</td><td>{c.valueKind}</td>{c.frequencies.map((f,a)=><td key={a}>{pct(f)}<small>{money(c.actionEv[a])} chips</small></td>)}</tr>)}</tbody></table></div>
      </>}
      <details className="river-notes"><summary>Solver scope and value definitions</summary><ul>{result.notes.map(n=><li key={n}>{n}</li>)}</ul></details>
    </div>}
  </section>;
}
