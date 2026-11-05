const {compareTournamentTree}=require('../engine/tournamentTree');
const { calculateSnapshot, analyzeClosingCall } = require('../engine/analysis');
const { calculateICM } = require('../engine/icm');
const { previewWeightedRange } = require('../engine/weightedRanges');
const { solveTurnTree } = require('../engine/turnSolver');
const { solveRiverTree } = require('../engine/riverSolver');
const { buildRiverTree } = require('../engine/riverTree');
const { ValidationError } = require('../engine/errors');
function executeTask(kind, input, hooks = {}) {
  switch (kind) {
    case 'calculate':
      return {
        analysis: calculateSnapshot(input),
        decisionAnalysis: input.includeDecisionAnalysis ? analyzeClosingCall(input) : undefined,
      };
    case 'tournamentTree': return compareTournamentTree(input);
    case 'turnSolve': return solveTurnTree(input,hooks);
    case 'riverSolve': return solveRiverTree(input, hooks);
    case 'riverTree': return buildRiverTree(input);
    case 'decision': return analyzeClosingCall(input);
    case 'icm': return calculateICM(input);
    case 'range': return previewWeightedRange(input, input.deadCards);
    default: throw new ValidationError('Unsupported calculation task.');
  }
}
module.exports = { executeTask };
