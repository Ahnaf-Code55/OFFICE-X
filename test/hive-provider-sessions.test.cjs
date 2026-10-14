'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {HiveManager}=require('./load-ts.cjs')('src/main/hive.ts');

test('provider switches never resume a foreign conversation and preserve each provider history',async t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'office-provider-session-'));
 t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 const hive=new HiveManager(()=>home);
 // This regression exercises registry ownership, not personal Codex homes.
 hive.installCodexHooks=()=>{const p=path.join(home,'codex-home');fs.mkdirSync(p,{recursive:true});return p;};
 await hive.ensureAgent({id:'manager',name:'Manager',provider:'codex',cwd:home});
 hive.recordSession('manager','codex-conversation');
 await hive.ensureAgent({id:'manager',name:'Manager',provider:'antigravity',cwd:home});
 assert.equal(hive.lastSession('manager'),undefined);
 // The old CLI can emit a final hook or usage sample after the replacement starts.
 hive.recordSession('manager','codex-conversation');
 assert.equal(hive.lastSession('manager'),undefined);
 assert.equal(hive.registry().agents.manager.sessionsByProvider.codex,'codex-conversation');
 hive.recordSession('manager','agy-conversation');
 await hive.ensureAgent({id:'manager',name:'Manager',provider:'antigravity',cwd:home});
 assert.equal(hive.lastSession('manager'),'agy-conversation');
 await hive.ensureAgent({id:'manager',name:'Manager',provider:'codex',cwd:home});
 assert.equal(hive.lastSession('manager'),'codex-conversation');
 await hive.ensureAgent({id:'manager',name:'Manager',provider:'antigravity',cwd:home});
 assert.equal(hive.lastSession('manager'),'agy-conversation');
});
