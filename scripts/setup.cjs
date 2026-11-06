const {spawnSync}=require('node:child_process');
const path=require('node:path');
const npm=process.env.npm_execpath;
if(!npm){console.error('Run this installer with npm run setup from the repository root.');process.exit(1);}
for(const directory of ['backend','frontend']){
  console.log(`Installing locked dependencies for ${directory}, including the local shared core…`);
  const result=spawnSync(process.execPath,[npm,'--prefix',path.join(__dirname,'..',directory),'ci','--include=dev'],{stdio:'inherit',cwd:path.join(__dirname,'..')});
  if(result.error){console.error(result.error.message);process.exit(1);}
  if(result.status!==0)process.exit(result.status||1);
}
console.log('Setup complete. Use npm run preview:dev for local UI review, or npm run release:check to validate the candidate.');
