import {useEffect,useRef,useState} from 'react';
import type {Dispatch,SetStateAction} from 'react';
import {apiFetch} from '../lib/api';
import {feedbackFetch} from '../lib/loading';
import {RiverJobClient,activeJob} from '../lib/riverJobClient';
import type {ClientJob} from '../lib/riverJobClient';
import type {RiverWorkspace} from '../lib/riverTree';
export const riverSolutionKey=(state:RiverWorkspace)=>JSON.stringify([JSON.stringify(state.draft),state.solver]);
export function useRiverJob(api:string,state:RiverWorkspace,setState:Dispatch<SetStateAction<RiverWorkspace>>){
  const [job,setJob]=useState<ClientJob|null>(null),[error,setError]=useState<string|null>(null);
  const client=useRef<RiverJobClient|null>(null),key=riverSolutionKey(state);
  const currentKey=useRef(key);currentKey.current=key;
  useEffect(()=>{
    const service=new RiverJobClient(async(path,init)=>{
      const timeout=new AbortController();
      const abort=()=>timeout.abort();init?.signal?.addEventListener('abort',abort,{once:true});
      if(init?.signal?.aborted)timeout.abort();
      const timer=setTimeout(abort,10000);
      try{
        const response=await (init?.method==='POST'?feedbackFetch:apiFetch)(api+path,{...init,signal:timeout.signal});
        const data=await response.json();if(!response.ok||!data.success)throw Object.assign(Error(data.error||'Cannot reach the calculation service.'),{status:response.status});return data;
      }finally{clearTimeout(timer);init?.signal?.removeEventListener('abort',abort);}
    },next=>{
      setJob(next&&(activeJob(next)||next.key===currentKey.current)?next:null);
      if(next?.status==='completed'&&next.solution){const result=next.solution;setState(s=>riverSolutionKey(s)===next.key?{...s,solution:{key:next.key,result}}:s);}
    });client.current=service;
    return()=>{service.dispose();client.current=null;};
  },[api,setState]);
  useEffect(()=>{client.current?.invalidate(key);setError(null);},[key]);
  return {job,error,active:activeJob(job),cancel:()=>void client.current?.cancel(),start:(input:unknown)=>{
    if(!state.solver.iterations.trim()||!state.solver.target.trim()){setError('Enter both the iteration limit and exploitability target.');return;}
    setError(null);setState(s=>({...s,solution:null}));void client.current?.start(key,input,Number(state.solver.iterations));
  }};
}
export type RiverJobController=ReturnType<typeof useRiverJob>;
