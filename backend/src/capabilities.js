const {API_CONTRACT_VERSION}=require('@river-poker-lab/core');
const {LIMITS:river}=require('./engine/riverBudget');
const {LIMITS:turn}=require('./engine/turnSolver');
function capabilities(localPreview=false){return {
  contractVersion:API_CONTRACT_VERSION,
  authentication:{mode:localPreview?'local-preview':'cookie-session',bearerTokens:false},
  solvers:{river:{enabled:true,valuation:'chip-ev',limits:river},turn:{enabled:true,valuation:'chip-ev',limits:turn},icmTree:{enabled:false}},
  icm:{snapshot:true,closingCall:true,maxRemainingPlayers:9},
  jobs:{storage:'process-memory',survivesServerRestart:false,restoresBrowserWorksheet:false},offlineSolving:false,
};}
module.exports={capabilities};
