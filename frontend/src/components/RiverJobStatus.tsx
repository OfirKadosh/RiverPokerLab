import type {RiverJobController} from '../hooks/useRiverJob';
import {LoadingIndicator} from './LoadingIndicator';
export function RiverJobStatus({controller,onOpen}:{controller:RiverJobController;onOpen?:()=>void}){
  const {job,active,cancel}=controller;if(!job)return null;
  const labels:Record<string,string>={starting:'Submitting river calculation',queued:'Waiting for the CPU worker',running:'River calculation running',cancelling:'Cancelling river calculation',completed:'River calculation completed',failed:'River calculation failed',cancelled:'River calculation cancelled',unavailable:'River calculation unavailable'};
  const phase:Record<string,string>={preparing:'Preparing exact deals and tree',solving:'Updating strategy',evaluating:'Checking exact best responses'};
  const p=job.progress;
  return <aside className="river-job-status" aria-label="Background river calculation">
    <div role="status" aria-live="polite">{active?<LoadingIndicator compact label={labels[job.status]||job.status}/>:<strong>{labels[job.status]||job.status}</strong>}</div>
    {['running','completed','cancelling','cancelled'].includes(job.status)&&<><progress aria-label="Solver iteration budget used" max={p.maxIterations} value={p.completedIterations}/><p>{p.completedIterations.toLocaleString('en-US')} / {p.maxIterations.toLocaleString('en-US')} iterations · {((p.completedIterations/Math.max(p.maxIterations,1))*100).toFixed(1)}% of iteration budget</p></>}
    {active&&<p className="field-help">{phase[p.phase]||'Your task stays active while you switch pages.'} · A target can be reached before the iteration budget is exhausted.</p>}
    {active&&p.checkpoint&&<p className="field-help">Last measured exploitability: {p.checkpoint.exploitabilityPotPct.toFixed(4)}% at iteration {p.checkpoint.iteration}.</p>}
    {job.connectionError&&<p role="status" className="validation-note">{job.connectionError}</p>}
    {job.error&&<p role="alert" className="validation-note">{job.error}</p>}
    {(onOpen||active)&&<div className="river-toolbar">{onOpen&&<button className="secondary-button" onClick={onOpen}>View river calculation</button>}{active&&<button className="secondary-button" disabled={job.status==='cancelling'} onClick={cancel}>{job.status==='cancelling'?'Waiting for cancellation…':'Cancel calculation'}</button>}</div>}
  </aside>;
}
