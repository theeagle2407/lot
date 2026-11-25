#!/usr/bin/env node
/** One-time local token enrollment, hidden TTY input; no shell history or clipboard required. */
import {saveProjectToken} from './lot-preprod-credentials.mjs';
import {validateProjectToken} from './lot-preprod-core.mjs';
const replace=process.argv.length===3&&process.argv[2]==='--replace';
if(process.argv.length>3 || (process.argv.length===3&&!replace)){
 console.error('Usage: npm run preprod:configure [-- --replace]');process.exit(1);
}
if(!process.stdin.isTTY||!process.stdout.isTTY||!process.stdin.setRawMode){
 console.error('Run in your own interactive Terminal. Never pass a project token as a command argument.');process.exit(1);
}
process.stdout.write('Midnight Preprod Blockfrost project token (hidden): ');
const original=Boolean(process.stdin.isRaw);
process.stdin.setRawMode(true);process.stdin.resume();
let value='';
function finish(code,msg){process.stdin.setRawMode(original);process.stdin.pause();process.stdout.write('\n');if(msg)console.log(msg);process.exitCode=code;}
function onKey(chunk){for(const ch of chunk.toString('utf8')){
 if(ch==='\u0003'){process.stdin.off('data',onKey);value='';finish(1,'Canceled.');return;}
 if(ch==='\r'||ch==='\n'){
  process.stdin.off('data',onKey);
  try{saveProjectToken(validateProjectToken(value),{replace});value='';finish(0,'Preprod project token saved privately. No blockchain operation was made.');}
  catch(e){value='';finish(1,e?.code==='EEXIST'?'A token is already saved. Use npm run preprod:configure -- --replace if needed.':e.message);}
  return;
 }
 if(ch==='\b'||ch==='\u007f'){value=value.slice(0,-1);continue;}
 if(ch>='!'&&ch<='~'&&value.length<256)value+=ch;
}}
process.stdin.on('data',onKey);
