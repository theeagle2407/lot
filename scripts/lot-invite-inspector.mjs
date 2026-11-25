import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {operatorStorePath} from './lot-operator-access.mjs';
import {issueInspectorInvite,onboardingPath} from './lot-onboarding.mjs';
try{if(process.argv.length!==3)throw Error('Usage: node scripts/lot-invite-inspector.mjs MANUFACTURER_USERNAME');const file=onboardingPath(operatorStorePath(resolve(dirname(fileURLToPath(import.meta.url)),'..')));console.log('Single-use inspector invitation (valid 24 hours):\n'+issueInspectorInvite(file,process.argv[2]));console.log('Share privately with the intended inspector. This grants access to assigned batch requests, not signing authority.');}catch(e){console.error(e.message);process.exitCode=1;}
