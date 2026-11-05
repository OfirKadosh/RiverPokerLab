const {randomUUID,createHash}=require('node:crypto');
const {ComputeError}=require('./pool');
const {ValidationError}=require('../engine/errors');
const {solverOptions}=require('../engine/riverSolver');
const ACTIVE=new Set(['queued','running']);
class JobError extends Error {constructor(message,status){super(message);this.status=status;}}
// Process-local bounded results. No production database, secret or session token is stored.
class SolverJobs {
  constructor({pool,now=Date.now,ttlMs=10*60*1000,maxJobs=32,maxPerOwner=4,maxResultBytes=16*1024*1024}={}){
    this.pool=pool;this.now=now;this.ttlMs=ttlMs;this.maxJobs=maxJobs;this.maxPerOwner=maxPerOwner;this.maxResultBytes=maxResultBytes;
    this.jobs=new Map();this.resultBytes=0;
  }
  remove(job){if(this.jobs.delete(job.id))this.resultBytes-=job.resultBytes||0;}
  prune(){for(const job of this.jobs.values())if(!ACTIVE.has(job.status)&&this.now()-job.finishedAt>=this.ttlMs)this.remove(job);}
  terminal(){return [...this.jobs.values()].filter(j=>!ACTIVE.has(j.status)).sort((a,b)=>a.finishedAt-b.finishedAt);}
  snapshot(job,includeResult=true){return {id:job.id,requestId:job.requestId,status:job.status,createdAt:job.createdAt,updatedAt:job.updatedAt,finishedAt:job.finishedAt??null,
    progress:job.progress,error:job.error??null,expiresAt:job.finishedAt===undefined?null:job.finishedAt+this.ttlMs,
    ...(includeResult&&job.status==='completed'?{solution:job.solution}:{})};}
  get(owner,id){this.prune();const job=this.jobs.get(id);if(!job||job.owner!==owner)throw new JobError('Calculation not found or expired. It may have been lost when the server restarted.',404);return this.snapshot(job);}
  list(owner){this.prune();return [...this.jobs.values()].filter(j=>j.owner===owner).map(j=>this.snapshot(j,false));}
  create(owner,input,requestId){
    this.prune();solverOptions(input);
    if(typeof requestId!=='string'||! /^[a-zA-Z0-9-]{16,80}$/.test(requestId))throw new ValidationError('A unique requestId of 16–80 letters, digits or hyphens is required.');
    const fingerprint=createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const previous=[...this.jobs.values()].find(j=>j.owner===owner&&j.requestId===requestId);
    if(previous){if(previous.fingerprint!==fingerprint)throw new JobError('This requestId already belongs to different inputs.',409);return this.snapshot(previous,false);}
    if([...this.jobs.values()].some(j=>j.owner===owner&&ACTIVE.has(j.status)))throw new JobError('You already have an active river calculation. Cancel it in its original tab or wait for completion.',409);
    const own=this.terminal().filter(j=>j.owner===owner);while(own.length>=this.maxPerOwner)this.remove(own.shift());
    for(const j of this.terminal()){if(this.jobs.size<this.maxJobs)break;this.remove(j);}
    if(this.jobs.size>=this.maxJobs)throw new JobError('Calculation capacity is full. Please retry shortly.',503);
    const job={id:randomUUID(),owner,requestId,fingerprint,status:'queued',createdAt:this.now(),updatedAt:this.now(),controller:new AbortController(),
      progress:{phase:'queued',completedIterations:0,maxIterations:solverOptions(input).maxIterations}};
    this.jobs.set(job.id,job);
    // The job owns its cancellation signal, independently of the POST or polling connection.
    this.pool.run('riverSolve',input,{owner,signal:job.controller.signal,onProgress:progress=>{
      if(!ACTIVE.has(job.status))return;
      job.status='running';job.progress=progress;job.updatedAt=this.now();
    }}).then(solution=>{
      if(!ACTIVE.has(job.status)||!this.jobs.has(job.id))return;
      const bytes=Buffer.byteLength(JSON.stringify(solution));
      if(bytes>this.maxResultBytes)throw new JobError('Calculation result exceeds the retention limit. Narrow the ranges.',413);
      for(const old of this.terminal()){if(this.resultBytes+bytes<=this.maxResultBytes)break;this.remove(old);}
      const progress={...job.progress,phase:'completed',completedIterations:solution.iterationsCompleted,maxIterations:solution.options.maxIterations,
        checkpoint:solution.history.at(-1)};
      job.solution=solution;job.resultBytes=bytes;this.resultBytes+=bytes;job.status='completed';job.progress=progress;this.finish(job);
    }).catch(error=>{
      if(!ACTIVE.has(job.status)||!this.jobs.has(job.id))return;
      job.status=error.name==='AbortError'?'cancelled':'failed';
      job.error={message:error instanceof ValidationError||error instanceof ComputeError||error instanceof JobError?error.message:'Calculation failed. Please retry.',status:error instanceof ValidationError?400:error.status||500};this.finish(job);
    });
    return this.snapshot(job,false);
  }
  finish(job){job.finishedAt=job.updatedAt=this.now();}
  cancel(owner,id){this.prune();const job=this.jobs.get(id);if(!job||job.owner!==owner)throw new JobError('Calculation not found or expired.',404);
    if(ACTIVE.has(job.status)){job.status='cancelled';job.progress={...job.progress,phase:'cancelled'};this.finish(job);job.controller.abort();}
    return this.snapshot(job);
  }
  close(){for(const job of this.jobs.values())if(ACTIVE.has(job.status))this.cancel(job.owner,job.id);}
}
module.exports={SolverJobs,JobError};
