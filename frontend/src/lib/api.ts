import {createApiClient} from '@river-poker-lab/core';
const API=(import.meta.env.VITE_API_URL||'/api').replace(/\/$/,'');
let activeAccount: string | undefined;
export function setApiAccount(id?: string) { activeAccount = id; }
export const apiClient = createApiClient({
  baseUrl: API,
  headers: (): Record<string, string> => activeAccount ? { "X-River-Account": activeAccount } : {},
  fetch: async (url, init) => {
    const response = await fetch(url, init);
    if (response.status === 409 || response.status === 403) {
      void response.clone().json().then(data => {
        if (data.code === "ACCOUNT_CHANGED" || data.code === "ACCOUNT_RESTRICTED" || data.code === "ACCESS_EXPIRED")
          window.dispatchEvent(new Event("river-auth-refresh"));
      }).catch(() => {});
    }
    return response;
  },
  onUnauthorized: () => window.dispatchEvent(new Event("river-auth-expired")),
});
// Browser-only adapter preserves the existing Response API and cookie/CSRF behavior.
export async function apiFetch(input:RequestInfo|URL,init:RequestInit={}):Promise<Response>{
  const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
  const base=new URL(API,window.location.href),target=new URL(url,window.location.href);
  if(target.origin!==base.origin||!target.pathname.startsWith(base.pathname.replace(/\/$/,'')+'/'))throw Error('Use the configured API service.');
  const relative=target.pathname.slice(base.pathname.replace(/\/$/,'').length)+target.search;
  const merged=input instanceof Request?new Request(input,init):null;
  const requestInit=merged?{...init,method:merged.method,headers:merged.headers,signal:merged.signal,
    ...(merged.body?{body:await merged.arrayBuffer()}:{}),}:init;
  return await apiClient.raw(relative,requestInit) as Response;
}
