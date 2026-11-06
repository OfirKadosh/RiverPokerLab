import type {RangeDraft} from './poker';
import type {RiverTree,RiverSolution,SolverDraft,SolverPlayerDraft} from '@river-poker-lab/core';
export type {RiverAction,RiverNode,SolverLimits,RiverPerformance,RiverTree,SolverCombo,SolverNode,TurnPublicNode,TurnPublicTree,TurnPublicValue,RiverSolution} from '@river-poker-lab/core';
export type RiverPlayerDraft=SolverPlayerDraft;
export type RiverDraft=SolverDraft;
export interface RiverWorkspace { solver:{iterations:string;target:string}; solution:{key:string;result:RiverSolution}|null; draft:RiverDraft; response:{key:string;tree:RiverTree}|null; selected:number }
export function createRiverWorkspace():RiverWorkspace {
  return {solver:{iterations:'2000',target:'0.5'},solution:null,draft:{players:[{name:'OOP',stack:'200',mode:'hand',cards:['Ah','Ac'],rangeDraft:{range:'AA',actionRanges:{},rangeAction:'base'}},{name:'IP',stack:'200',mode:'hand',cards:['Kh','Kc'],rangeDraft:{range:'KK',actionRanges:{},rangeAction:'base'}}],board:['2s','3d','7h','8c','9s'],pot:'100',chipUnit:'1',minBet:'2',bets:'50, 100',raises:'50, 100',maxRaises:'1',includeAllIn:true},response:null,selected:0};
}

export function createTurnWorkspace():RiverWorkspace {const state=createRiverWorkspace();state.draft={...state.draft,players:state.draft.players.map((p,i)=>({...p,stack:'4',cards:i===0?['Ah','Kh']:['Qs','Qc'],mode:'range',rangeDraft:{range:i===0?'AhKh,AdKd':'QsQc,JsJc',actionRanges:{},rangeAction:'base'}})),board:['2h','7d','Th','9s'],pot:'2',minBet:'1',bets:'50',riverBets:'50',raises:'',maxRaises:'0',includeAllIn:true};state.solver={iterations:'1500',target:'0.5'};return state;}
