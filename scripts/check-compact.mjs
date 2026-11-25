import { execFileSync } from 'node:child_process';
function run(cmd, args) {
  try { console.log(execFileSync(cmd, args, {encoding:'utf8',stdio:['ignore','pipe','pipe']})); }
  catch (error) {
    console.error(`Could not run ${cmd} ${args.join(' ')}.`);
    console.error(error.stderr?.toString() || error.message);
    process.exitCode=1;
  }
}
run('compact',['compile','--version']);
