#!/usr/bin/env node
/** Create local operators with passwords typed into a hidden interactive Terminal prompt. */
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import {createLocalOperator,resetLocalOperatorPassword,listLocalOperators,operatorStorePath} from './lot-operator-access.mjs';
import {onboardingPath,hasOnboardedName,listOnboarded} from './lot-onboarding.mjs';
const projectRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const file=operatorStorePath(projectRoot);
async function hidden(label){
 if(!process.stdin.isTTY||!process.stdout.isTTY||!process.stdin.setRawMode)throw new Error('Create accounts from an interactive Terminal. Never pass passwords as arguments.');
 process.stdout.write(label);
 let original=Boolean(process.stdin.isRaw);process.stdin.setRawMode(true);process.stdin.resume();
 return await new Promise((resolve,reject)=>{
  let value='';function cleanup(){process.stdin.removeListener('data',onData);process.stdin.setRawMode(original);process.stdin.pause();process.stdout.write('\n');}
  function onData(chunk){for(const c of chunk.toString('utf8')){
   if(c==='\r'||c==='\n'){cleanup();resolve(value);return;}
   if(c==='\u0003'){cleanup();reject(new Error('Canceled.'));return;}
   if(c==='\b'||c==='\u007f'){value=value.slice(0,-1);continue;}
   if(c>=' '&&value.length<512)value+=c;
  }}process.stdin.on('data',onData);
 });
}
async function main(){
 const [action,role,name,...rest]=process.argv.slice(2);
 if(action==='list'&&!role){
  const users=[...listLocalOperators(file),...listOnboarded(onboardingPath(file))];if(!users.length)console.log('No LOT operators created.');
  else users.forEach(u=>console.log(`${u.name} · ${u.role}`));return;
 }
 if(action==='reset'&&role&&!name&&!rest.length){
  const users=listLocalOperators(file);
  if(!users.some(u=>u.name===role))throw new Error('Operator not found. Run npm run users:list first.');
  const pass=await hidden('New operator login password (hidden): ');
  const confirm=await hidden('Repeat new operator login password (hidden): ');
  if(pass!==confirm)throw new Error('Passwords do not match.');
  const result=resetLocalOperatorPassword({name:role,password:pass,file});
  console.log(`Local ${result.role} operator ${result.name} password updated. Password was not printed or stored in plaintext.`);
  console.log('Restart npm run proof:serve to invalidate existing operator sessions.');
  return;
 }
 if(action!=='create'||!['inspector','manufacturer'].includes(role)||!name||rest.length)
  throw new Error('Usage: npm run users:create -- inspector inspector01 | manufacturer maker01\nOr: npm run users:reset -- maker01\nOr: npm run users:list');
 if(hasOnboardedName(onboardingPath(file),name))throw new Error('Username unavailable.');
 const pass=await hidden('Choose operator login password (hidden): ');
 const confirm=await hidden('Repeat operator login password (hidden): ');
 if(pass!==confirm)throw new Error('Passwords do not match.');
 const result=createLocalOperator({name,role,password:pass,file});
 console.log(`Local ${result.role} operator ${result.name} created. Password was not printed or stored in plaintext.`);
}
main().catch(err=>{console.error('LOT operator setup:',err.message);process.exitCode=1;});
