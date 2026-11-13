import type {TransportInit,TransportResponse,FetchTransport,HeaderValues} from './transport';
import type {RiverTree,RiverSolution,SolverDraft,ClientJob,JobRequest,ServerJob,Calculation,DecisionAnalysis} from './models';
export * from './models';
export * from './transport';
export const API_CONTRACT_VERSION:1;
export const RANKS:readonly string[];
export const SUITS:readonly string[];
export const SYMBOLS:Readonly<Record<string,string>>;
export const SUIT_NAMES:Readonly<Record<string,string>>;
export function handSize(type:'holdem'|'omaha'):number;
export class ContractError extends Error {code:string;field?:string;constructor(message:string,field?:string)}
export function normalizeCard(value:unknown):string;
export interface SolverSettingsDraft {iterations:string;target:string}
export interface RiverSpotRequest {gameType:'holdem';gameMode:'cash';board:string[];players:{name:string;stack:number;input:string[]|import('./models').PlayerInput}[];potSize:number;chipUnit:number;minBet:number;betSizes:number[];raiseSizes:number[];maxRaises:number;includeAllIn:boolean;solverStreet?:'river'|'turn';riverBetSizes?:number[]}
export interface SolverRequest extends RiverSpotRequest {solver:{maxIterations:number;targetPotPct:number}}
export function buildRiverTreeRequest(draft:SolverDraft):RiverSpotRequest;
export function buildSolverRequest(draft:SolverDraft,options:SolverSettingsDraft,street?:'river'|'turn'):SolverRequest;
export function assertChipSolverValuation(input:unknown):void;
export interface ChipValuation {kind:'chip-ev';unit:'chips';baseline:'river-start-stack'|'turn-start-stack';street:'river'|'turn';startingPot:number;expectedNet:number[]}
export interface IcmActionValuation {kind:'icm-prize-ev';unit:'prize-units';baseline:'absolute-expected-prize';model:'Malmuth-Harville ICM';expectedByAction:{call:number;fold:number};difference:{action:'call';reference:'fold';value:number}}
export interface IcmTreeValuation {kind:'icm-tree-ev';unit:'prize-units';baseline:'absolute-expected-prize';model:'Malmuth-Harville ICM';evaluation:'fixed-response-policy'}
export type Valuation=ChipValuation|IcmActionValuation|IcmTreeValuation;
export function icmTreeValuation():IcmTreeValuation;
export function buildTournamentTreeRequest(draft:SolverDraft,tournament:import('./models').TournamentTreeContext,responsePolicy:import('./models').FixedResponsePolicy,street?:'river'|'turn'):import('./models').TournamentTreeRequest;
export function chipValuation(street:'river'|'turn',expectedNet:number[],startingPot:number):ChipValuation;
export function icmActionValuation(call:number,fold:number):IcmActionValuation;
export function parseValuation(value:unknown):Valuation;
export class ApiError extends Error {status:number;code?:string;retryAfter?:string;constructor(message:string,status:number,options?:{code?:string;retryAfter?:string})}
export interface Capabilities {contractVersion:1;authentication:{mode:'cookie-session'|'local-preview';bearerTokens:false};solvers:{river:{enabled:true;valuation:'chip-ev';limits:Record<string,number>};turn:{enabled:true;valuation:'chip-ev';limits:Record<string,number>};icmTree:{enabled:false}};icm:{snapshot:true;closingCall:true;maxRemainingPlayers:9;pushFold?:{enabled:true;evaluation:"fixed-response-policy";limits:{minSamplesPerHand:number;maxSamplesPerHand:number;maxRemainingPlayers:number}};treeActions:{enabled:true;evaluation:"fixed-response-policy";limits:Record<string,number>}};jobs:{storage:'process-memory';survivesServerRestart:false;restoresBrowserWorksheet:false};offlineSolving:false}
export interface JobResponse {success:true;job:ServerJob}
export interface ApiClient {
 raw(path:string,init?:TransportInit):Promise<TransportResponse>;
 request<T=any>(path:string,init?:TransportInit):Promise<T>;
 capabilities(init?:TransportInit):Promise<{success:true;capabilities:Capabilities}>;
 calculate(input:import('./models').CalculateRequest,init?:TransportInit):Promise<Calculation>;
 analyzeDecision(input:import('./models').CalculateRequest,init?:TransportInit):Promise<{success:true;analysis:DecisionAnalysis}>;
 calculateIcm(input:import('./models').IcmSnapshotRequest,init?:TransportInit):Promise<{success:true}&import('./models').IcmSnapshot>;
 analyzePushFold(input:import('./models').PushFoldRequest,init?:TransportInit):Promise<{success:true;analysis:import('./models').PushFoldAnalysis}>;
 compareTournamentTree(input:import('./models').TournamentTreeRequest,init?:TransportInit):Promise<{success:true;analysis:import('./models').TournamentTreeAnalysis}>;
 buildRiverTree(input:RiverSpotRequest,init?:TransportInit):Promise<{success:true;tree:RiverTree}>;
 createSolverJob(input:SolverRequest,requestId:string,init?:TransportInit):Promise<JobResponse>;
 getSolverJob(id:string,init?:TransportInit):Promise<JobResponse>;
 listSolverJobs(init?:TransportInit):Promise<{success:true;jobs:ServerJob[]}>;
 cancelSolverJob(id:string,init?:TransportInit):Promise<JobResponse>;
 me(init?:TransportInit):Promise<{success:true}&import('./models').AccountIdentity>;
 login(input:import('./models').LoginRequest,init?:TransportInit):Promise<{success:true}&import('./models').AccountIdentity>;
 register(input:import('./models').RegistrationRequest,init?:TransportInit):Promise<{success:true;verification:import('./models').VerificationState}>;
 logout(init?:TransportInit):Promise<{success:true}>;
 history(init?:TransportInit):Promise<{success:true;spots:import('./models').SavedSpot[]}>;
}
export function createApiClient(options:{baseUrl:string;fetch?:FetchTransport;credentials?:'include'|'omit'|'same-origin';onUnauthorized?:()=>void;headers?:HeaderValues|(()=>HeaderValues|Promise<HeaderValues>);timeoutMs?:number}):ApiClient;
export function activeJob(job:ClientJob|null):boolean;
export class RiverJobClient {
 current:ClientJob|null;
 constructor(request:JobRequest,changed:(job:ClientJob|null)=>void,pollMs?:number,options?:{createRequestId?:()=>string});
 start(key:string,input:unknown,maxIterations:number):Promise<void>;
 cancel():Promise<void>;
 invalidate(key:string):void;
 dispose():void;
}
