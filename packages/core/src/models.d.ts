import type {TransportInit} from './transport';
import type {ChipValuation,IcmActionValuation} from './index';
export type BettingAction =
  | {
      type: "fold" | "check" | "call" | "bet" | "raise" | "allin";
      seatId: number;
      amount?: number;
    }
  | { type: "advance" };
export type GameType = "holdem" | "omaha";
export type GameMode = "cash" | "tournament";
export type RangeAction =
  "base" | "fold" | "check" | "call" | "bet" | "raise" | "allin";
export interface RangeConfig {
  range: string;
  actionRanges?: Partial<Record<Exclude<RangeAction, "base">, string>>;
  rangeAction?: RangeAction;
}
export interface RangeDraft {
  range: string;
  actionRanges: Partial<Record<Exclude<RangeAction, "base">, string>>;
  rangeAction: RangeAction;
}
export interface TableState {
  seats: {
    id: number;
    name: string;
    stack: number;
    startingStack?: number;
    cards: string[];
    mode?: "hand" | "range";
    range?: string;
    actionRanges?: RangeConfig["actionRanges"];
    rangeAction?: RangeAction;
  }[];
  heroSeatId: number;
  bigBlind: number;
  betting?: { actions: BettingAction[] };
  handSetup?: { dealerSeatId: number; smallBlind: number };
}
export type PlayerInput =
  { type: "hand"; cards: string[] } | ({ type: "range" } & RangeConfig);
export interface EquityResult {
  playerIndex: number;
  equity: number;
}
export type CalculationMethod = "auto" | "exact" | "monteCarlo";
export interface PotResult {
  potIndex: number;
  amount: number;
  eligibleIndices: number[];
  expectedPayouts?: number[];
  shares?: { playerIndex: number; amount: number; oddChip: boolean }[];
}
export interface TournamentSettings {
  fieldConfirmed: true;
  eliminationRule: "starting-stack-split";
  tableSeats: { seatId: number; startingStack: number }[];
  otherPlayers: { name: string; stack: number }[];
  payouts: number[];
}
export interface IcmDecision {
  valuation?:IcmActionValuation;
  available: boolean;
  reason?: string;
  decision?: string;
  expectedCallPrize?: number;
  expectedFoldPrize?: number;
  deltaCallVsFold?: number;
  standardError?: number;
  confidence95?: [number, number] | null;
  totalPrize?: number;
  outcomeCount?: number;
  outcomesTruncated?: boolean;
  players?: {
    playerIndex: number;
    name: string;
    seatId?: number;
    expectedCallPrize: number;
    expectedFoldPrize: number;
  }[];
  outcomes?: {
    probability: number;
    callStacks: number[];
    foldStacks: number[];
    heroCallValue: number;
    heroFoldValue: number;
    callEliminations: {
      playerIndex: number;
      firstPlace: number;
      lastPlace: number;
      prize: number;
    }[];
    foldEliminations: {
      playerIndex: number;
      firstPlace: number;
      lastPlace: number;
      prize: number;
    }[];
  }[];
  assumptions?: string[];
}
export interface DecisionAnalysis {
  icm?: IcmDecision;
  available: boolean;
  reason?: string;
  heroSeatId?: number;
  callCost?: number;
  callEV?: number;
  foldEV?: number;
  expectedStackAfterCall?: number;
  stackAfterFold?: number;
  decision?: string;
  standardError?: number;
  confidence95?: [number, number] | null;
  method?: "exact" | "monteCarlo";
  samples?: number;
  assumptions?: string[];
}
export interface PayoutSummary {
  kind: "unavailable" | "uncontested" | "final" | "expectation";
  reason?: string;
  winnerSeatId?: number;
  award?: number;
  endingStacks?: { seatId: number; stack: number }[];
  pots: PotResult[];
}
export interface Calculation {
  success: boolean;
  error?: string;
  results: EquityResult[];
  iterations: number;
  method?: "exact" | "monteCarlo";
  samples?: number;
  enumeration?: { available: boolean; reason?: string };
  payoutSummary?: PayoutSummary;
  decisionAnalysis?: DecisionAnalysis;
  tournament?: TournamentSettings;
  savedSpotId?: string;
  rangeStats?: {
    observedAction?: RangeAction;
    totalMass?: number;
    availableMass?: number;
    playerIndex: number;
    totalCombos: number;
    availableCombos: number;
    blockedCombos: number;
  }[];
}
export interface SavedSpot {
  _id: string;
  gameType: GameType;
  gameMode?: GameMode;
  players: string[][];
  playerInputs?: PlayerInput[];
  board: string[];
  potSize: number;
  callAmount: number;
  createdAt: string;
  calculationMethod?: CalculationMethod;
  chipUnit?: number;
  decisionAnalysis?: DecisionAnalysis;
  tournament?: TournamentSettings;
  tableState?: TableState;
}

export interface SolverPlayerDraft { name: string; stack: string; mode: 'hand'|'range'; cards: (string|null)[]; rangeDraft: RangeDraft }
export interface SolverDraft { players: SolverPlayerDraft[]; board: (string|null)[]; pot: string; chipUnit: string; minBet: string; bets: string; raises: string; maxRaises: string; includeAllIn: boolean; riverBets?:string }

export interface RiverAction { type: 'check'|'bet'|'raise'|'call'|'fold'; player: number; label: string; to?: number; nodeId: number }
export interface RiverNode { id:number; parentId:number|null; incoming:string|null; kind:'decision'|'terminal'; actor:number|null; pot:number; contributions:number[]; remaining:number[]; actions:RiverAction[]; toCall?:number; effectiveCap?:number; minRaiseTo?:number|null; omitted?:string[]; outcome?:{reason:'fold'|'showdown';winner:number|null;contestPot:number;refunds:number[];expectedAwards:number[];endingStacks:number[];netFromRiver:number[];interpretation:string} }
export interface SolverLimits {jointDeals:number;informationSets:number;work:number;maxIterations:number;dealNodeCells:number;typedArrayBytes:number}
export interface RiverPerformance {kernel:string;timingsMs:{setup:number;iterations:number;quality:number;report:number};resources:{jointDeals:number;publicNodes:number;informationSets:number;dealNodeCells:number;estimatedWork:number;terminalBytes:number;kernelBytes:number;strategyBytes:number;coreTypedArrayBytes:number}}
export interface RiverTree { solverLimits?:SolverLimits; rootId:number; input:{board:string[];potSize:number;chipUnit:number;players:{name:string;position:string;stack:number}[]}; chance:{jointDeals:number;totalMass:number;winProbability:number[];tieProbability:number;availableCombos:number[]}; nodes:RiverNode[]; summary:{nodes:number;decisions:number;terminals:number;effectiveStack:number}; notes:string[] }
export interface SolverCombo { cards:string[]; priorProbability:number; reachProbability:number; conditionalProbability:number|null; valueKind:string; frequencies:number[]; actionEv:(number|null)[] }
export interface SolverNode { nodeId:number; actor:number; reachProbability:number; frequencies:(number|null)[]; actionEv:(number|null)[]; combos:SolverCombo[] }
export interface TurnPublicNode {id:number;parentId:number|null;incoming:string|null;kind:"decision"|"chance"|"terminal";actor:number|null;street:string;board:string[];pot:number;remaining:number[];contributions:number[];toCall?:number;actions:{type:string;label:string;nodeId:number;card?:string}[];outcome?:{reason:string}}
export interface TurnPublicTree {input:{players:{name:string}[];board:string[];potSize:number};nodes:TurnPublicNode[];privateDeals:number;scenarios:number;nodeDealVisits:number;limits:{work:number;maxIterations:number;privateDeals:number}}
export interface TurnPublicValue {nodeId:number;reachProbability:number;net:number[]|null;riverProbabilities?:{card:string;probability:number|null}[]}
export interface RiverSolution { contractVersion?:1;valuation?:ChipValuation; turnTree?:TurnPublicTree; performance?:RiverPerformance; iterationsCompleted:number; stopReason:string; targetReached:boolean; runtimeMs:number; jointDeals:number; informationSets:number; notes:string[]; metrics:{expectedNet:number[];bestResponseNet:number[];deviationGains:number[];nashConv:number;exploitability:number;exploitabilityPotPct:number;nodePolicies:SolverNode[];publicValues?:TurnPublicValue[]}; history:{iteration:number;exploitability:number;exploitabilityPotPct:number}[] }

export interface JobProgress {phase:string;completedIterations:number;maxIterations:number;checkpoint?:{iteration:number;exploitabilityPotPct:number}}
export interface ServerJob {id:string;requestId:string;status:string;progress:JobProgress;error?:{message:string;status:number}|null;solution?:RiverSolution;expiresAt?:number|null}
export interface ClientJob {key:string;id:string|null;requestId:string;status:string;progress:JobProgress;error:string|null;connectionError:string|null;solution?:RiverSolution}
export type JobRequest=(path:string,init?:TransportInit)=>Promise<{job?:ServerJob;jobs?:ServerJob[]}>;

export interface CalculateRequest {players:(string[]|PlayerInput)[];board:string[];gameType:GameType;gameMode:GameMode;potSize:number;callAmount:number;iterations:number;saveSpot?:boolean;calculationMethod?:CalculationMethod;chipUnit?:number;tableState?:TableState;tournament?:TournamentSettings;includeDecisionAnalysis?:boolean}
export interface IcmSnapshotRequest {players:{name:string;stack:number}[];payouts:number[]}

export interface AccountUser {
  id: string;
  username: string;
  role?: "user" | "admin";
  email: string | null;
  phone: string | null;
  manuallyApproved?: boolean;
  restricted?: boolean;
  emailVerified: boolean;
  phoneVerified: boolean;
}
export interface VerificationState {
  manual?: boolean;
  username: string;
  channel: "email" | "sms";
  emailHint: string;
  phoneHint: string;
}
export interface AccountSession {
  expiresInMs?: number;
  expiresAt: string;
  remember: boolean;
}
export interface AccountIdentity {
  preview?: boolean;
  accountSwitch?: { mode: "link" | "switch" | "return" };
  user: AccountUser | null;
  verification?: VerificationState;
  session?: AccountSession;
}

export interface LoginRequest {identifier:string;password:string;remember:boolean}
export interface RegistrationRequest {email:string;username:string;phone:string;password:string;channel:"email"|"sms"}

export interface IcmSnapshot {model:string;method:string;playerCount:number;totalChips:number;totalPrize:number;payouts:number[];results:{playerIndex:number;name:string;stack:number;chipShare:number;prizeEquity:number;prizeShare:number;proportionalPrize:number;differenceFromProportional:number;finishProbabilities:number[]}[]}

/** Fixed responses are assumptions, not an equilibrium policy. Weights normalize over legal actions. */
export type ActionWeights=Partial<Record<'fold'|'check'|'call'|'bet'|'raise'|'allin',number>>;
export interface ResponseProfile {turn:ActionWeights;river:ActionWeights;combos?:{cards:string[];turn?:ActionWeights;river?:ActionWeights}[]}
export interface FixedResponsePolicy {confirmed:true;players:ResponseProfile[]}
export interface TournamentTreeContext {fieldConfirmed:true;eliminationRule:'starting-stack-split';handStartStacks:number[];otherPlayers:{name:string;stack:number}[];payouts:number[]}
export interface TournamentTreeRequest {analysisKind:'fixed-policy-icm';street:'turn'|'river';spot:Omit<import('./index').RiverSpotRequest,'gameMode'>&{gameMode:'tournament'};tournament:TournamentTreeContext;responsePolicy:FixedResponsePolicy}
export interface TournamentActionValue {index:number;type:string;label:string;frequency:number|null;prizeEv:number|null;chipNet:number|null;deltaPrize:number|null;deltaChips:number|null;expectedPrizes:(number|null)[]}
export interface TournamentNodeValue {nodeId:number;reachProbability:number;expectedPrizes:(number|null)[];riverProbabilities?:{card:string;probability:number|null}[];actor?:number;referenceAction?:number;preferredActions?:number[];actions?:TournamentActionValue[];combos?:{cards:string[];reachProbability:number;conditionalProbability:number|null;valueKind:string;frequencies:number[];prizeEv:(number|null)[];chipNet:(number|null)[]}[]}
export interface TournamentTreeAnalysis {contractVersion:1;analysisKind:'fixed-policy-icm';valuation:import('./index').IcmTreeValuation;street:'turn'|'river';runtimeMs:number;fingerprint:string;input:{spot:unknown;tournament:TournamentTreeContext;responsePolicy:FixedResponsePolicy};field:{players:{name:string;stack:number}[];payouts:number[];totalPrize:number};privateDeals:number;scenarios:number;nodeDealVisits:number;uniqueOutcomes:number;limits:Record<string,number>;tree:TurnPublicNode[];nodes:TournamentNodeValue[];notes:string[]}
