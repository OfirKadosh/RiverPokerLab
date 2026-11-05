const {API_CONTRACT_VERSION,ContractError}=require('./contracts');
class ApiError extends Error {constructor(message,status,{code,retryAfter}={}){super(message);this.name='ApiError';this.status=status;if(code)this.code=code;if(retryAfter)this.retryAfter=retryAfter;}}
function createApiClient({baseUrl,fetch:transport=globalThis.fetch,credentials='include',onUnauthorized,headers:extraHeaders,timeoutMs=10000}={}){
  if(typeof transport!=='function')throw new ContractError('A fetch-compatible transport is required.','fetch');
  if(typeof baseUrl!=='string'||!baseUrl||/[?#\\]/.test(baseUrl)||!/^\/(?!\/)|^https?:\/\//.test(baseUrl))throw new ContractError('Use an API base path or an absolute HTTP(S) API URL.','baseUrl');
  const base=baseUrl.replace(/\/+$/,'');if(/^https?:/.test(base)){const u=new URL(base);if(u.username||u.password)throw new ContractError('Do not embed credentials in the API URL.','baseUrl');}
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0)throw new ContractError('A positive request timeout is required.','timeoutMs');
  function path(value){if(typeof value!=='string'||!/^\/(?!\/)/.test(value)||/[\\#]/.test(value)||/%(?:2f|5c|2e)/i.test(value)||value.split(/[/?]/).some(p=>p==='.'||p==='..'))throw new ContractError('Use an API-relative path inside the configured service.','path');return value;}
  function copyHeaders(value){if(value&&!Array.isArray(value)&&typeof value.forEach==='function'){const result=new Headers();value.forEach((v,k)=>result.append(k,v));return result;}return new Headers(value);}
  async function raw(relative,init={}){
    const route=path(relative),headers=copyHeaders(init.headers);const additions=typeof extraHeaders==='function'?await extraHeaders():extraHeaders;
    if(additions)copyHeaders(additions).forEach((v,k)=>headers.set(k,v));headers.set('X-Requested-With','RiverPokerLab');
    const response=await transport(base+route,{...init,headers,credentials});
    if(response.status===401&&!route.startsWith('/auth/'))onUnauthorized?.();return response;
  }
  async function request(relative,init={}){
    const controller=new AbortController(),abort=()=>controller.abort();init.signal?.addEventListener('abort',abort,{once:true});if(init.signal?.aborted)abort();const timer=setTimeout(abort,timeoutMs);
    try{const response=await raw(relative,{...init,signal:controller.signal});let data;try{data=await response.json();}catch{throw new ApiError('The API returned an invalid JSON response.',response.status,{code:'INVALID_RESPONSE'});}
      if(!response.ok||data?.success!==true)throw new ApiError(data?.error||'The API request failed.',response.status,{code:data?.code,retryAfter:response.headers.get('Retry-After')||undefined});return data;
    }finally{clearTimeout(timer);init.signal?.removeEventListener('abort',abort);}
  }
  const json=(relative,body,method='POST',init={})=>{const headers=copyHeaders(init.headers);headers.set('Content-Type','application/json');return request(relative,{...init,method,headers,body:JSON.stringify(body)});};
  const idPath=id=>{if(typeof id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(id))throw new ContractError('Invalid calculation ID.','id');return '/river-jobs/'+id;};
  return {raw,request,
    capabilities:async init=>{const data=await request('/capabilities',init);if(data.capabilities?.contractVersion!==API_CONTRACT_VERSION)throw new ApiError('This API contract version is not supported by the client.',200,{code:'CONTRACT_VERSION'});return data;},
    calculate:(input,init)=>json('/calculate',input,'POST',init),analyzeDecision:(input,init)=>json('/analyze-decision',input,'POST',init),calculateIcm:(input,init)=>json('/icm',input,'POST',init),
    buildRiverTree:(input,init)=>json('/river-tree',input,'POST',init),createSolverJob:(input,requestId,init)=>json('/river-jobs',{input,requestId},'POST',init),
    getSolverJob:(id,init)=>request(idPath(id),init),listSolverJobs:init=>request('/river-jobs',init),cancelSolverJob:(id,init)=>json(idPath(id),{},'DELETE',init),
    me:init=>request('/auth/me',init),login:(input,init)=>json('/auth/login',input,'POST',init),register:(input,init)=>json('/auth/register',input,'POST',init),logout:init=>json('/auth/logout',{},'POST',init),
    history:init=>request('/spots',init)};
}
module.exports={ApiError,createApiClient};
