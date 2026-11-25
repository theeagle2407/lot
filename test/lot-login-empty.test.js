import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
const login=code.split('<form onSubmit={signIn}')[1]?.split('</form>')[0] ?? '';

test('login password is not an autofill target for a current credential',()=>{
 assert.ok(login.includes('autoComplete="new-password"'));
 assert.ok(login.includes('name="lot-local-manual-secret"'));
 assert.ok(!login.includes('autoComplete="current-password"'));
 assert.ok(!/type="password"[^>]*autoFocus/.test(login));
});
test('username is manually entered, not preselected from another account',()=>{
 assert.ok(login.includes('name="lot-local-operator-entry"'));
 assert.ok(login.includes('autoComplete="off"'));
 assert.ok(login.includes('value={loginName}'));
});
test('login clears credentials on sign-in, sign-out and signup transitions',()=>{
 assert.match(code,/function clearLogin\(\)\{if\(loginPassword.current\)loginPassword.current.value='';setLoginName\(''\);setLoginError\(''\);\}/);
 assert.match(code,/const \[loginName,setLoginName\]=useState\(''\)/);
 assert.match(code,/clearLogin\(\);setSignup\(true\)/);
 assert.match(code,/onCancel=\{\(\)=>\{setSignup\(false\);clearLogin\(\);\}\}/);
 assert.match(code,/await logoutOperator\(\);clearLogin\(\)/);
 assert.match(code,/lot-operator-changed'\)\);clearLogin\(\)/);
});
test('a failed sign in clears the prior attempted password',()=>{
 assert.match(code,/\}catch\(e\)\{\s*if\(loginPassword\.current\)loginPassword\.current\.value='';\s*setLoginError/);
});
test('existing server-side operator roles and private report authorization are preserved',()=>{
 assert.ok(code.includes("operator?.role!=='inspector'"));
 assert.ok(code.includes("operator?.role!=='manufacturer'"));
 assert.ok(code.includes("loginOperator(loginName.trim(),loginPassword.current?.value??'')"));
 assert.ok(code.includes("let authorization={vaultPassphrase:vaultInput.current?.value??''}"));
 assert.match(code,/const nav=inspector\?\[\{id:'batches',label:'Inspections'/);
 assert.match(code,/id:'clearances',label:'Clearances'/);
});
