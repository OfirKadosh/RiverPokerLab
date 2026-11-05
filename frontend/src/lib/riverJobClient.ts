import type {RiverSolution} from './riverTree';
export interface JobProgress {phase:string;completedIterations:number;maxIterations:number;checkpoint?:{iteration:number;exploitabilityPotPct:number}}
export interface ServerJob {id:string;requestId:string;status:string;progress:JobProgress;error?:{message:string;status:number}|null;solution?:RiverSolution;expiresAt?:number|null}
export interface ClientJob {key:string;id:string|null;requestId:string;status:string;progress:JobProgress;error:string|null;connectionError:string|null;solution?:RiverSolution}
export const activeJob=(job:ClientJob|null)=>!!job&&['starting','queued','running','cancelling'].includes(job.status);
export type JobRequest=(path:string,init?:RequestInit)=>Promise<{job?:ServerJob;jobs?:ServerJob[]}>;
const message=(e:unknown)=>e instanceof Error?e.message:'Cannot reach the calculation service.';
const status=(e:unknown)=>(e as {status?:number})?.status;
// Owned by App rather than a routed panel. The service has no DOM or React dependency.
export class RiverJobClient {
  current:ClientJob|null=null;
  request:JobRequest;changed:(job:ClientJob|null)=>void;pollMs:number;
  private timer:ReturnType<typeof setTimeout>|undefined;
  private polling:AbortController|null=null;
  private closed=false;private generation=0;private wantCancel=false;private failures=0;
  constructor(request:JobRequest,changed:(job:ClientJob|null)=>void,pollMs=750){this.request=request;this.changed=changed;this.pollMs=pollMs;}
  private publish(changes:Partial<ClientJob>){if(this.closed||!this.current)return;this.current={...this.current,...changes};this.changed(this.current);}
  private schedule(fn:()=>void,delay=this.pollMs){clearTimeout(this.timer);if(!this.closed)this.timer=setTimeout(fn,delay);}
  async start(key:string,input:unknown,maxIterations:number){
    if(this.closed||activeJob(this.current))return;
    clearTimeout(this.timer);this.polling?.abort();
    const generation=++this.generation;this.wantCancel=false;this.failures=0;
    this.current={key,id:null,requestId:crypto.randomUUID(),status:'starting',progress:{phase:'starting',completedIterations:0,maxIterations},error:null,connectionError:null};this.changed(this.current);
    const requestId=this.current.requestId;
    try{
      let data:{job?:ServerJob};
      const send=()=>this.request('/river-jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({input,requestId})});
      try{data=await send();}catch(e){const code=status(e);if(code!==undefined&&code>=400&&code<500)throw e;data=await send();}
      if(!data.job)throw Error('The calculation service returned no job.');
      // Do not abandon a task created while Cancel, logout or unmount was requested.
      if(this.closed||generation!==this.generation){void this.request(`/river-jobs/${data.job.id}`,{method:'DELETE',headers:{'Content-Type':'application/json'},body:'{}'}).catch(()=>{});return;}
      this.current={...this.current!,id:data.job.id};
      if(this.wantCancel){await this.cancel();return;}
      this.accept(data.job);
      if(activeJob(this.current))this.schedule(()=>void this.poll(),0);
    }catch(e){
      if(this.closed||generation!==this.generation)return;
      // Recover a POST whose response was lost without creating another calculation.
      if(status(e)===undefined||(status(e)??0)>=500){
        try{const list=await this.request('/river-jobs');const job=list.jobs?.find(j=>j.requestId===requestId);
          if(job&&!this.closed&&generation===this.generation){this.current={...this.current!,id:job.id};if(this.wantCancel)await this.cancel();else this.accept(job);return;}
        }catch{}
      }
      this.publish({status:'unavailable',error:message(e)});
    }
  }
  private accept(job:ServerJob){
    this.failures=0;this.publish({id:job.id,status:job.status,progress:job.progress,error:job.error?.message||null,connectionError:null,solution:job.solution});
    if(['queued','running'].includes(job.status)||job.status==='completed'&&!job.solution)this.schedule(()=>void this.poll());
  }
  private async poll(){
    if(this.closed||!this.current?.id)return;const generation=this.generation;
    const controller=new AbortController();this.polling=controller;
    try{const data=await this.request(`/river-jobs/${this.current.id}`,{signal:controller.signal});
      if(this.closed||controller.signal.aborted||generation!==this.generation||this.wantCancel)return;
      if(!data.job)throw Error('The calculation service returned no job.');this.accept(data.job);
    }catch(e){
      if(this.closed||controller.signal.aborted||generation!==this.generation)return;
      if(status(e)===404||status(e)===401||status(e)===403){this.publish({status:'unavailable',error:message(e),connectionError:null});return;}
      this.failures++;this.publish({connectionError:'Connection interrupted. Reconnecting to your calculation…'});
      this.schedule(()=>void this.poll(),Math.min(10000,this.pollMs*2**Math.min(this.failures,4)));
    }
  }
  async cancel(){
    if(this.closed||!activeJob(this.current))return;this.wantCancel=true;clearTimeout(this.timer);this.polling?.abort();
    this.publish({status:'cancelling',connectionError:null});if(!this.current?.id)return;
    const generation=this.generation;
    try{const data=await this.request(`/river-jobs/${this.current.id}`,{method:'DELETE',headers:{'Content-Type':'application/json'},body:'{}'});
      if(this.closed||generation!==this.generation)return;
      if(!data.job)throw Error('Cancellation was not confirmed.');this.wantCancel=false;this.accept(data.job);
    }catch(e){
      if(this.closed||generation!==this.generation)return;
      if(status(e)===404||status(e)===401||status(e)===403){this.publish({status:'unavailable',error:message(e)});return;}
      this.publish({connectionError:'Cancellation is not confirmed. Retrying…'});this.schedule(()=>void this.cancel(),2000);
    }
  }
  invalidate(key:string){if(!this.current||this.current.key===key)return;if(activeJob(this.current)){if(!this.wantCancel)void this.cancel();}else{this.current=null;this.changed(null);}}
  dispose(){this.closed=true;this.wantCancel=true;clearTimeout(this.timer);this.polling?.abort();
    if(this.current?.id&&activeJob(this.current))void this.request(`/river-jobs/${this.current.id}`,{method:'DELETE',headers:{'Content-Type':'application/json'},body:'{}'}).catch(()=>{});
  }
}
