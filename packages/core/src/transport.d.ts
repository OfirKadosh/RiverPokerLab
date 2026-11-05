/** Minimal fetch surface shared by browser, React Native and test hosts. No DOM library required. */
export interface AbortSignalLike {readonly aborted:boolean;addEventListener(type:'abort',listener:()=>void,options?:{once?:boolean}):void;removeEventListener(type:'abort',listener:()=>void):void}
export type HeaderValues=Record<string,string>|[string,string][]|{forEach(callback:(value:string,key:string)=>void):void};
export interface TransportInit {method?:string;headers?:HeaderValues;body?:unknown;signal?:AbortSignalLike|null;credentials?:'include'|'omit'|'same-origin'}
export interface TransportResponse {readonly ok:boolean;readonly status:number;headers:{get(name:string):string|null};json():Promise<any>}
export type FetchTransport=(url:string,init?:any)=>Promise<TransportResponse>;
