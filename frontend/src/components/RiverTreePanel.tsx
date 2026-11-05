import {buildRiverTreeRequest} from '@river-poker-lab/core';
import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { feedbackFetch } from '../lib/loading';
import type { RiverJobController } from '../hooks/useRiverJob';
import { RiverJobStatus } from './RiverJobStatus';
import { RiverSolverPanel } from './RiverSolverPanel';
import { Card } from './Card';
import { CardPicker } from './CardPicker';
import { LoadingIndicator } from './LoadingIndicator';
import { RangeEditor } from './RangeEditor';
import { createRiverWorkspace } from '../lib/riverTree';
import type { RiverWorkspace, RiverTree, RiverNode, RiverDraft, RiverPlayerDraft } from '../lib/riverTree';
import type { Seat, GameType, GameMode } from '../lib/poker';
const chips=(n:number)=>new Intl.NumberFormat('en-US',{maximumFractionDigits:4}).format(Math.abs(n)<1e-9?0:n);
const percent=(n:number)=>`${(n*100).toFixed(2)}%`;
function Branch({node,tree,selectedId,onSelect}:{node:RiverNode;tree:RiverTree;selectedId:number;onSelect:(id:number)=>void}) {
  return <li><div className={`river-tree-row ${selectedId===node.id?'selected':''}`}><button className="text-button" aria-current={selectedId===node.id?'step':undefined} onClick={()=>onSelect(node.id)}>{node.id===0?'Start of river':node.incoming}<small>{node.kind==='decision'?`${tree.input.players[node.actor!].name} to act`:node.outcome?.reason==='fold'?'Fold award':'Showdown'}</small></button></div>
    {node.actions.length>0&&<details open={node.id===0}><summary>{node.actions.length} configured actions</summary><ul>{node.actions.map(a=><Branch key={a.nodeId} node={tree.nodes[a.nodeId]} tree={tree} selectedId={selectedId} onSelect={onSelect}/>)}</ul></details>}</li>;
}
export function RiverTreePanel({api,state,setState,source,jobController,blocked=false}:{blocked?:boolean;jobController:RiverJobController;api:string;state:RiverWorkspace;setState:Dispatch<SetStateAction<RiverWorkspace>>;source:{seats:Seat[];board:(string|null)[];pot:number;gameType:GameType;gameMode:GameMode;inHand:boolean}}) {
  const {draft}=state,key=JSON.stringify(draft),tree=state.response?.key===key?state.response.tree:null;
  const selected=tree?.nodes.find(n=>n.id===state.selected)||tree?.nodes[0];
  const [loading,setLoading]=useState(false),[error,setError]=useState<string|null>(null),[notice,setNotice]=useState<string|null>(null);
  const request=useRef<AbortController|null>(null);
  const [picker,setPicker]=useState<'board'|number|null>(null),[active,setActive]=useState(0);
  useEffect(()=>{request.current?.abort();setLoading(false);setError(null);return()=>request.current?.abort();},[key]);
  function update(changes:Partial<RiverDraft>){setState(s=>({...s,draft:{...s.draft,...changes},selected:0}));setNotice(null);}
  function player(index:number,changes:Partial<RiverPlayerDraft>){update({players:draft.players.map((p,i)=>i===index?{...p,...changes}:p)});}
  function select(id:number){setState(s=>({...s,selected:id}));}
  async function build(){
    request.current?.abort();const controller=new AbortController();request.current=controller;setLoading(true);setError(null);setNotice(null);
    try{
      const response=await feedbackFetch(`${api}/river-tree`,{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,
        body:JSON.stringify(buildRiverTreeRequest(draft))});
      const data=await response.json();if(controller.signal.aborted)return;
      if(!response.ok||!data.success)throw Error(data.error||'Cannot build the river tree.');
      setState(s=>JSON.stringify(s.draft)===key?{...s,response:{key,tree:data.tree},selected:0}:s);
    }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Cannot reach the calculation server.');}
    finally{if(!controller.signal.aborted)setLoading(false);}
  }
  function example(weighted:boolean){
    request.current?.abort();setLoading(false);setError(null);const next=createRiverWorkspace();
    if(weighted){next.draft.players[0]={...next.draft.players[0],mode:'range',rangeDraft:{range:'AhAc@25%, ThTc@75%',actionRanges:{},rangeAction:'base'}};next.draft.players[1].cards=['Qh','Qc'];}
    setState(next);setNotice('Example loaded. Build the tree to inspect its branches.');
  }
  function benchmark(expanded=false){
    request.current?.abort();setLoading(false);setError(null);const next=createRiverWorkspace();
    next.draft={...next.draft,players:next.draft.players.map(p=>({...p,stack:'1',mode:'range',rangeDraft:{range:expanded?'22,33,44,55,66,88,TT,JJ':'2h2c,3h3c,4h4c',actionRanges:{},rangeAction:'base'}})),board:['As','Ks','Qh','9d','7c'],pot:'2',minBet:'1',bets:'50',raises:'',maxRaises:'0',includeAllIn:false};
    next.solver=expanded?{iterations:'3000',target:'0'}:{iterations:'20000',target:'0.1'};setState(next);setNotice(expanded?'Larger-range example loaded: 48 physical combos per player and 2,064 legal joint deals. Build, then solve. The zero target asks for all 3,000 iterations; convergence is not guaranteed.':'Three-hand reference game loaded. Build, then solve. Its theoretical OOP net is 17/18 chips.');
  }
  function copy(){
    if(source.gameType!=='holdem'||source.gameMode!=='cash'||source.seats.length!==2||source.board.some(c=>!c)||source.inHand){setError('Copy requires two players, a five-card board and Hold\'em cash in free spot mode. Finish configuring the source or use an example.');return;}
    const seats=[...source.seats].sort((a,b)=>a.id-b.id);
    update({board:[...source.board],pot:String(source.pot),players:seats.map((s,i)=>({...draft.players[i],name:s.name,cards:[...s.cards],mode:s.mode,rangeDraft:{range:s.range,actionRanges:s.actionRanges||{},rangeAction:s.rangeAction||'base'}}))});
    setNotice('Copied cards/ranges and pot in seat order. Choose OOP/IP using Swap, and enter the actual stacks behind at the START of the river. Stacks were not imported.');
  }
  const cards=picker==='board'?draft.board:typeof picker==='number'?draft.players[picker].cards:[];
  const used=new Set([...draft.board,...draft.players.filter(p=>p.mode==='hand').flatMap(p=>p.cards)].filter((c):c is string=>!!c));
  function open(target:'board'|number,index=0){setPicker(target);setActive(index);}
  function pick(card:string|null){
    const next=[...cards];next[active]=card;
    if(picker==='board')update({board:next});else if(typeof picker==='number')player(picker,{cards:next});
    if(card){const empty=next.findIndex((c,i)=>i>active&&!c);setActive(empty<0?Math.min(active+1,next.length-1):empty);}
  }
  const path:RiverNode[]=[];if(tree&&selected){let n:RiverNode|undefined=selected;while(n){path.unshift(n);n=n.parentId===null?undefined:tree.nodes[n.parentId];}}
  return <section className="sidebar-section river-panel" aria-label="River decision tree workspace">
    <h2>Heads-up river tree</h2>
    <p className="inline-note">Stage 12.2 · No-limit Hold'em cash only. Build an exact betting tree, then solve an approximate strategy within its configured actions.</p>
    <div className="river-toolbar"><button className="secondary-button" onClick={()=>example(false)}>Load fixed-hand example</button><button className="secondary-button" onClick={()=>example(true)}>Load weighted example</button><button className="secondary-button" onClick={()=>benchmark(false)}>Load 3-hand benchmark</button><button className="secondary-button" onClick={()=>benchmark(true)}>Load larger-range example</button><button className="text-button" onClick={copy}>Copy cards and pot from spot</button></div>
    <div className="river-board" aria-label="River board">{draft.board.map((card,i)=><Card key={i} value={card} label={`River board card ${i+1}`} small onClick={()=>open('board',i)}/>)}</div>
    <p className="field-help">This worksheet is session-only and is not saved to History. The pot already exists at river start. Stacks are chips BEHIND at that moment. OOP acts first; IP is the button. No outstanding river bet, rake or side pots.</p>
    <div className="river-player-grid">{draft.players.map((p,i)=><div key={i} className="river-player"><h3>{i===0?'Out of position':'In position · button'}</h3>
      <label className="field-label">NAME<input aria-label={`River player ${i+1} name`} maxLength={40} value={p.name} onChange={e=>player(i,{name:e.target.value})}/></label>
      <label className="field-label">STACK BEHIND<input aria-label={`River player ${i+1} stack`} type="number" min="0.01" step="any" value={p.stack} onChange={e=>player(i,{stack:e.target.value})}/></label>
      <label className="field-label">PRIVATE INPUT<select aria-label={`River player ${i+1} input type`} value={p.mode} onChange={e=>player(i,{mode:e.target.value as 'hand'|'range'})}><option value="hand">Specific hand</option><option value="range">Weighted range</option></select></label>
      {p.mode==='hand'?<div className="river-hole-cards">{p.cards.map((card,j)=><Card key={j} value={card} small label={`River player ${i+1} card ${j+1}`} onClick={()=>open(i,j)}/>)}</div>:<RangeEditor api={api} value={p.rangeDraft.range} actionRanges={p.rangeDraft.actionRanges} rangeAction={p.rangeDraft.rangeAction} deadCards={[...draft.board,...draft.players.filter((other,j)=>j!==i&&other.mode==='hand').flatMap(other=>other.cards)].filter((c):c is string=>!!c)} draftState={p.rangeDraft} onDraftChange={rangeDraft=>player(i,{rangeDraft})} onCommit={config=>player(i,{rangeDraft:{range:config.range,actionRanges:config.actionRanges||{},rangeAction:config.rangeAction||'base'}})}/>}</div>)}</div>
    <button className="text-button" onClick={()=>update({players:[draft.players[1],draft.players[0]]})}>Swap OOP / IP</button>
    <div className="river-settings">{([['pot','River-start pot'],['chipUnit','Smallest chip'],['minBet','Minimum full bet']] as const).map(([field,label])=><label className="field-label" key={field}>{label}<input aria-label={label} type="number" step="any" min="0.01" value={draft[field]} onChange={e=>update({[field]:e.target.value})}/></label>)}
      <label className="field-label">BET SIZES · % POT<input aria-label="River bet sizes" value={draft.bets} onChange={e=>update({bets:e.target.value})} placeholder="50, 100"/></label>
      <label className="field-label">RAISE SIZES · % POT AFTER CALL<input aria-label="River raise sizes" value={draft.raises} onChange={e=>update({raises:e.target.value})} placeholder="50, 100"/></label>
      <label className="field-label">RAISE CAP<select aria-label="River raise cap" value={draft.maxRaises} onChange={e=>update({maxRaises:e.target.value})}><option value="0">No raises</option><option value="1">One raise; no re-raises</option></select></label>
    </div>
    <label className="icm-confirm"><input type="checkbox" checked={draft.includeAllIn} onChange={e=>update({includeAllIn:e.target.checked})}/>Include effective-stack all-in</label>
    <p className="field-help">Up to 3 bet sizes and 2 raise sizes. Raise increment = percentage × pot after calling. Targets round to the nearest chip; oversized targets merge at the effective stack. Small illegal sizes are omitted. Range text and action-prior drafts are read when building.</p>
    <button className="primary-button full-width" disabled={loading} onClick={()=>void build()}>{loading?<LoadingIndicator label="Building river tree…" compact/>:'Build river tree'}</button>
    {jobController.job&&<RiverJobStatus controller={jobController}/>}
    {error&&<p role="alert" className="validation-note">{error}</p>}{notice&&<p role="status" className="auth-notice">{notice}</p>}
    {!tree&&!loading&&state.response&&<p className="inline-note">Inputs changed. Rebuild to see matching results.</p>}
    {tree&&selected&&<div className="river-results">
      <h3>Exact tree · {tree.summary.nodes} nodes · {tree.summary.terminals} terminal branches</h3>
      <p className="field-help">{tree.chance.jointDeals} legal joint deals · {tree.chance.availableCombos.join(' / ')} known-card candidate combos · effective stack {chips(tree.summary.effectiveStack)}. Narrow large ranges if the exact work budget is exceeded.</p>
      <p className="inline-note">Unchanged-prior showdown: {tree.input.players[0].name} wins {percent(tree.chance.winProbability[0])}, {tree.input.players[1].name} wins {percent(tree.chance.winProbability[1])}, tie {percent(tree.chance.tieProbability)}. Actions do not reweight these priors. Terminal numbers are NOT root action EVs.</p>
      <div className="river-explorer"><div className="river-tree-list" aria-label="Configured river tree"><ul><Branch node={tree.nodes[0]} tree={tree} selectedId={selected.id} onSelect={select}/></ul></div>
        <section className="river-node" aria-label="Selected river node"><nav className="river-breadcrumb" aria-label="River path">{path.map(n=><button key={n.id} className="text-button" onClick={()=>select(n.id)}>{n.id===0?'Root':n.incoming}</button>)}</nav>
          <h3>{selected.kind==='decision'?`${tree.input.players[selected.actor!].name} to act`:selected.outcome?.reason==='fold'?'Fold award':'River showdown'}</h3>
          <p>Pot before refunds: {chips(selected.pot)}</p><p className="field-help">Behind: {selected.remaining.map((n,i)=>`${tree.input.players[i].name} ${chips(n)}`).join(' · ')}</p>
          {selected.kind==='decision'?<><p>To call: {chips(selected.toCall||0)}</p>{selected.minRaiseTo!==null&&selected.minRaiseTo!==undefined&&<p className="field-help">Minimum full raise to {chips(selected.minRaiseTo)}; effective cap {chips(selected.effectiveCap||0)}.</p>}<div className="river-actions">{selected.actions.map(a=><button key={a.nodeId} className="secondary-button" onClick={()=>select(a.nodeId)}>{a.label}</button>)}</div>{selected.omitted?.map((text,i)=><p className="field-help" key={i}>{text}</p>)}<p className="field-help">This explorer shows unchanged-prior branch payoffs. Solved strategy and action EV appear below.</p></>:selected.outcome&&<><p>Contested pot: {chips(selected.outcome.contestPot)}</p><div className="river-outcome-wrap"><table className="river-outcome"><caption>Conditional payoffs · river-start stack baseline</caption><thead><tr><th>Player</th><th>Invested</th><th>Refund</th><th>Award</th><th>Ending</th><th>Net</th></tr></thead><tbody>{tree.input.players.map((p,i)=><tr key={i}><th>{p.name}</th><td>{chips(selected.contributions[i])}</td><td>{chips(selected.outcome!.refunds[i])}</td><td>{chips(selected.outcome!.expectedAwards[i])}</td><td>{chips(selected.outcome!.endingStacks[i])}</td><td>{chips(selected.outcome!.netFromRiver[i])}</td></tr>)}</tbody></table></div><p className="field-help">{selected.outcome.interpretation} Net values sum to the pot that existed before river betting. Fractional awards may be expectations over weighted hands.</p></>}
        </section></div>
      <RiverSolverPanel controller={jobController} tree={tree} treeKey={key} state={state} setState={setState} building={loading||blocked}/>
      <details className="river-notes"><summary>Scope and accounting rules</summary><ul>{tree.notes.map(n=><li key={n}>{n}</li>)}</ul></details>
    </div>}
    {picker!==null&&<CardPicker title={picker==='board'?'River board':`${draft.players[picker].name} · river hand`} cards={cards} activeIndex={active} usedCards={used} onActiveIndex={setActive} onPick={pick} onClose={()=>setPicker(null)}/>}
  </section>;
}
