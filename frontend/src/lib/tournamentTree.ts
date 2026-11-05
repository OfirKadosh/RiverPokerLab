import type {ActionWeights,ResponseProfile,SolverDraft,TournamentTreeAnalysis} from '@river-poker-lab/core';
import {createRiverWorkspace,createTurnWorkspace} from './riverTree';
export const RESPONSE_ACTIONS=['fold','check','call','bet','raise','allin'] as const;
export const uniform=():ActionWeights=>({fold:1,check:1,call:1,bet:1,raise:1,allin:1});
export const passive=():ActionWeights=>({fold:0,check:1,call:1,bet:0,raise:0,allin:0});
export interface TournamentForm {starting:string[];outside:{name:string;stack:string}[];payouts:string;fieldConfirmed:boolean;policyConfirmed:boolean;profiles:ResponseProfile[];overrides:string[]}
export interface TournamentWorkspace {form:TournamentForm;result:{key:string;analysis:TournamentTreeAnalysis}|null;selected:number;open:boolean}
export function createTournamentWorkspace():TournamentWorkspace{return {form:{starting:['',''],outside:[],payouts:'',fieldConfirmed:false,policyConfirmed:false,profiles:[0,1].map(()=>({turn:uniform(),river:uniform()})),overrides:['[]','[]']},result:null,selected:0,open:false};}
export function tournamentExample(street:'turn'|'river'):{draft:SolverDraft;workspace:TournamentWorkspace}{
  const draft=(street==='turn'?createTurnWorkspace():createRiverWorkspace()).draft;
  Object.assign(draft,{board:street==='turn'?['Jh','Th','2c','8s']:['2s','3d','7h','8c','9s'],pot:'4',chipUnit:'1',minBet:'2',bets:'',riverBets:'',raises:'',maxRaises:'0',includeAllIn:true});
  draft.players[0]={...draft.players[0],name:'Hero',stack:'98',mode:'hand',cards:street==='turn'?['9s','9d']:['Qh','Qc']};
  draft.players[1]={...draft.players[1],name:'IP',stack:'98',mode:street==='turn'?'hand':'range',cards:['Ah','Kh'],rangeDraft:{range:'AhAc@40%, ThTc@60%',actionRanges:{},rangeAction:'base'}};
  const workspace=createTournamentWorkspace();workspace.open=true;
  workspace.form={...workspace.form,starting:['100','100'],outside:[{name:'Outside',stack:'98'}],payouts:'50, 50, 0',fieldConfirmed:true,policyConfirmed:true,profiles:[{turn:{...passive(),fold:1},river:{...passive(),fold:1}},{turn:{...passive(),check:0,allin:1},river:street==='river'?{...passive(),check:0,allin:1}:{...passive(),fold:1}}]};
  return {draft,workspace};
}
