'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {HiveManager}=require('./load-ts.cjs')('src/main/hive.ts');

test('fresh interactive agents receive a read-only idle-startup boundary before task instructions',async t=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'office-idle-startup-'));
  t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const hive=new HiveManager(()=>home);
  const injection=await hive.ensureAgent({id:'atlas',name:'Atlas',provider:'antigravity',cwd:home});
  const prompt=injection.args.find(s=>typeof s==='string'&&s.includes('HIVE PROTOCOL'));
  assert.match(prompt,/STARTUP IS NOT AN ASSIGNMENT/);
  assert.match(prompt,/If there is no pending assignment, remain idle/);
  assert.match(prompt,/Do not create or rewrite mood\/memory files/);
  assert(prompt.indexOf('STARTUP IS NOT AN ASSIGNMENT')<prompt.indexOf('HIVE PROTOCOL'));
  assert(!injection.args.includes('--dangerously-skip-permissions'));
});
