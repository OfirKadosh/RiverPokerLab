const {fork}=require('node:child_process');
const os=require('node:os');
const {writeFileSync,readFileSync}=require('node:fs');
const {createHash}=require('node:crypto');
const path=require('node:path');
const {performance}=require('node:perf_hooks');
const {riverCase,names}=require('./benchmarks/riverCases');
async function sample(){
  const [engine,name,repetitions]=process.argv.slice(3);
  const solver=require(engine==='baseline'?'../src/engine/tests/support/riverSolverReference':'../src/engine/riverSolver');
  const input=riverCase(name);solver.solveRiverTree(input); // one unmeasured warm-up in each isolated child
  const ms=[];let result;
  for(let i=0;i<Number(repetitions);i++){
    global.gc?.();const started=performance.now();result=solver.solveRiverTree(input);ms.push(performance.now()-started);
  }
  process.send({ms,peakRssBytes:process.resourceUsage().maxRSS*1024,metrics:result.metrics,iterations:result.iterationsCompleted,
    jointDeals:result.jointDeals,nodes:result.estimatedWork/((input.solver.maxIterations+60)*result.jointDeals),performance:result.performance||null});
}
function run(engine,name,repetitions){return new Promise((resolve,reject)=>{
  const child=fork(__filename,['--sample',engine,name,String(repetitions)],{execArgv:['--expose-gc'],stdio:['ignore','ignore','pipe','ipc']});let answer,errors='';
  child.stderr.on('data',chunk=>errors+=chunk);child.on('message',m=>answer=m);child.on('error',reject);
  child.on('exit',code=>code===0&&answer?resolve(answer):reject(Error(`${engine}/${name} failed: ${errors}`)));
});}
function maxDiff(a,b){
  if(typeof a==='number'&&typeof b==='number')return Math.abs(a-b);
  if(a===b)return 0;if(a===null||b===null||typeof a!==typeof b)throw Error('Mathematical output shape changed.');
  if(Array.isArray(a)&&a.length!==b.length)throw Error('Mathematical output length changed.');
  if(typeof a!=='object')throw Error('Mathematical output changed.');
  let max=0;for(const key of Object.keys(a)){if(!(key in b))throw Error('Mathematical output field missing.');max=Math.max(max,maxDiff(a[key],b[key]));}return max;
}
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
async function main(){
  const reps=Number(process.env.BENCH_REPETITIONS||5);if(!Number.isInteger(reps)||reps<1||reps>10)throw Error('BENCH_REPETITIONS must be an integer from 1 to 10.');
  const sourceHashes=Object.fromEntries(['riverSolver.js','riverKernel.js','riverBudget.js'].map(name=>[name,createHash('sha256').update(readFileSync(path.join(__dirname,'../src/engine',name))).digest('hex')]));
  const report={referenceRevision:'8c797703a7521d6022173593f87a2b85c22e7dae',sourceHashes,node:process.version,platform:process.platform,arch:process.arch,cpu:os.cpus()[0]?.model,repetitions:reps,warmups:1,
    methodology:'One isolated child per engine/case; wall time includes setup, CFR and quality/reporting; explicit GC before each measured run; peak RSS includes warm-up and all repeats. No timing assertions.',cases:[]};
  for(const name of names){
    const baseline=name==='expanded-2064'?null:await run('baseline',name,reps),compiled=await run('compiled',name,reps);
    const difference=baseline?maxDiff(baseline.metrics,compiled.metrics):null;
    if(difference!==null&&difference>1e-7)throw Error(`${name}: maximum mathematical difference ${difference} exceeds 1e-7.`);
    const row={name,jointDeals:compiled.jointDeals,publicNodes:compiled.nodes,iterations:compiled.iterations,baseline:baseline?{samplesMs:baseline.ms,medianMs:median(baseline.ms),peakRssBytes:baseline.peakRssBytes}:null,
      compiled:{samplesMs:compiled.ms,medianMs:median(compiled.ms),peakRssBytes:compiled.peakRssBytes,performance:compiled.performance},
      speedup:baseline?median(baseline.ms)/median(compiled.ms):null,maxMetricDifference:difference};
    report.cases.push(row);console.log(`${name}: ${row.compiled.medianMs.toFixed(1)} ms${row.speedup?`, ${row.speedup.toFixed(2)}× speedup`: ' (above prior range limit)'}`);
  }
  if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(report,null,2)+'\n');else console.log(JSON.stringify(report,null,2));
}
if(require.main===module){if(process.argv[2]==='--sample')sample().catch(e=>{console.error(e);process.exitCode=1;});else main().catch(e=>{console.error(e);process.exitCode=1;});}
module.exports={maxDiff};
