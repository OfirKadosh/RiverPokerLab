import {createApiClient,buildSolverRequest,RiverJobClient,parseValuation} from '../src';
import type {FetchTransport,SolverDraft,Valuation,ChipValuation,ApiClient} from '../src';
// Compiles with ES2020 only: no DOM library, React Native or Node types.
export function nativeFoundation(transport:FetchTransport,draft:SolverDraft,createRequestId:()=>string){
  const api:ApiClient=createApiClient({baseUrl:'https://example.test/api',fetch:transport,credentials:'omit'});
  const input=buildSolverRequest(draft,{iterations:'500',target:'0.5'},'turn');
  const jobs=new RiverJobClient((path,init)=>api.request(path,init),()=>{},750,{createRequestId});
  return {api,jobs,input};
}
export function valuationLabel(wire:unknown):string{
  const result:Valuation=parseValuation(wire);
  if(result.kind==='chip-ev'){const cash:ChipValuation=result;return cash.baseline+':'+cash.expectedNet[0];}
  return result.unit+':'+result.expectedByAction.call;
}
