import type {ActionWeights,ResponseProfile,SolverDraft,TournamentTreeAnalysis} from '@river-poker-lab/core';
import {createFlopWorkspace,createRiverWorkspace,createTurnWorkspace} from './riverTree';
export const RESPONSE_ACTIONS=['fold','check','call','bet','raise','allin'] as const;
export const uniform=():ActionWeights=>({fold:1,check:1,call:1,bet:1,raise:1,allin:1});
export const passive=():ActionWeights=>({fold:0,check:1,call:1,bet:0,raise:0,allin:0});
export interface TournamentForm {starting:string[];outside:{name:string;stack:string}[];payouts:string;fieldConfirmed:boolean;policyConfirmed:boolean;mode:"compare"|"solve";iterations:string;profiles:ResponseProfile[];overrides:string[]}
export interface TournamentWorkspace {form:TournamentForm;result:{key:string;analysis:TournamentTreeAnalysis}|null;selected:number;open:boolean}
export function createTournamentWorkspace():TournamentWorkspace{return {form:{starting:['',''],outside:[],payouts:'',fieldConfirmed:false,policyConfirmed:false,mode:"compare",iterations:"50",profiles:[0,1].map(()=>({flop:uniform(),turn:uniform(),river:uniform()})),overrides:['[]','[]']},result:null,selected:0,open:false};}
export function tournamentExample(street:'flop'|'turn'|'river'):{draft:SolverDraft;workspace:TournamentWorkspace}{
  const draft=({flop:createFlopWorkspace,turn:createTurnWorkspace,river:createRiverWorkspace}[street]()).draft;
  Object.assign(draft,{board:street==='flop'?['Jh','Th','2c']:street==='turn'?['Jh','Th','2c','8s']:['2s','3d','7h','8c','9s'],pot:'4',chipUnit:'1',minBet:'2',bets:street==='flop'?'50':'',turnBets:street==='flop'?'50':'',riverBets:'',raises:'',maxRaises:'0',includeAllIn:street!=='flop'});
  draft.players[0]={...draft.players[0],name:'Hero',stack:'98',mode:'hand',cards:street!=='river'?['9s','9d']:['Qh','Qc']};
  draft.players[1]={...draft.players[1],name:'IP',stack:'98',mode:street!=='river'?'hand':'range',cards:['Ah','Kh'],rangeDraft:{range:'AhAc@40%, ThTc@60%',actionRanges:{},rangeAction:'base'}};
  const workspace=createTournamentWorkspace();workspace.open=true;
  workspace.form={...workspace.form,starting:['100','100'],outside:[{name:'Outside',stack:'98'}],payouts:'50, 50, 0',fieldConfirmed:true,policyConfirmed:true,profiles:[{flop:uniform(),turn:{...passive(),fold:1},river:{...passive(),fold:1}},{flop:uniform(),turn:street==='flop'?uniform():{...passive(),check:0,allin:1},river:street==='river'?{...passive(),check:0,allin:1}:{...passive(),fold:1}}]};
  return {draft,workspace};
}
