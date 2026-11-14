const {API_CONTRACT_VERSION}=require('@river-poker-lab/core');
const {LIMITS:river}=require('./engine/riverBudget');
const {LIMITS:turn,FLOP_LIMITS:flop}=require('./engine/turnSolver');
const {LIMITS:pushFold}=require('./engine/pushFold');
const {LIMITS:pushFoldSolve}=require('./engine/pushFoldSolver');
function capabilities(localPreview=false){return {
  contractVersion:API_CONTRACT_VERSION,
  authentication:{mode:localPreview?'local-preview':'cookie-session',bearerTokens:false},
  solvers:{river:{enabled:true,valuation:'chip-ev',limits:river},turn:{enabled:true,valuation:'chip-ev',limits:turn},flop:{enabled:true,valuation:'chip-ev',limits:flop},icmTree:{enabled:true,valuation:'icm-tree-ev',streets:['flop','turn','river'],limits:require('./engine/tournamentTree').STRATEGY_LIMITS}},
  icm:{snapshot:true,closingCall:true,pushFold:{enabled:true,evaluation:"fixed-response-policy",limits:pushFold,solver:{model:"sampled-iterative-icm",limits:pushFoldSolve}},treeActions:{enabled:true,evaluation:"fixed-response-policy",streets:['flop','turn','river'],limits:require("./engine/tournamentTree").LIMITS},maxRemainingPlayers:9},
  jobs:{storage:'process-memory',survivesServerRestart:false,restoresBrowserWorksheet:false},offlineSolving:false,
};}
module.exports={capabilities};
