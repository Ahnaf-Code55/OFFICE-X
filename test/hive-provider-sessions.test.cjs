'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {HiveManager}=require('./load-ts.cjs')('src/main/hive.ts');

test('provider switches never resume a foreign conversation and preserve each provider history',async t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'office-provider-session-'));
 t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 const hive=new HiveManager(()=>home);
 // This regression exercises registry ownership, not personal Codex homes.
 hive.installCodexHooks=()=>{const p=path.join(home,'codex-home');fs.mkdirSync(p,{recursive:true});return p;};
 hive.installAgyHooks=()=>{};
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

test('Codex process usage IDs cannot overwrite native conversation resume keys',async t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'office-codex-session-'));
 t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 const hive=new HiveManager(()=>home);
 hive.installCodexHooks=()=>{const p=path.join(home,'codex-home');fs.mkdirSync(p,{recursive:true});return p;};
 await hive.ensureAgent({id:'manager',name:'Manager',provider:'codex',cwd:home});
 hive.recordSession('manager','native-conversation');
 hive.recordSession('manager','process-usage-id','usage');
 assert.equal(hive.lastSession('manager'),'native-conversation');
 assert.equal(hive.registry().agents.manager.sessionsByProvider.codex,'native-conversation');
 hive.recordSession('manager','next-native-conversation');
 assert.equal(hive.lastSession('manager'),'next-native-conversation');
 // Claude OTel session IDs still provide a resume fallback if hooks are absent.
 await hive.ensureAgent({id:'claude',name:'Claude',provider:'claude',cwd:home});
 hive.recordSession('claude','claude-otel-session','usage');
 assert.equal(hive.lastSession('claude'),'claude-otel-session');
 const main=fs.readFileSync(path.join(__dirname,'../src/main/index.ts'),'utf8');
 assert.match(main,/hive\.recordSession\(id, sample\.sessionId, 'usage'\)/);
});
