import {useEffect,useRef,useState} from 'react';
import type {Dispatch,SetStateAction} from 'react';
import {apiClient} from '../lib/api';

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
      const started=performance.now(),data=await apiClient.request(path,init);
      // Visual feedback belongs to the browser host; the portable controller has no UI delay.
      if(init?.method==='POST'&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches){
        const remaining=500-(performance.now()-started);if(remaining>0)await new Promise(resolve=>setTimeout(resolve,remaining));
      }
      return data;
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
