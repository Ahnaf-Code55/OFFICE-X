'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),ts=require('typescript');
const {HiveManager}=require('./load-ts.cjs')('src/main/hive.ts');
test('OpenCode emits real arguments and session identity from its before/after API',async t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'office-opencode-events-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 const hive=new HiveManager(()=>home);await hive.ensureAgent({id:'worker',name:'Worker',provider:'opencode',cwd:home});
 const source=fs.readFileSync(path.join(home,'hive/agents/worker/.opencode/plugin/hive-bridge.js'),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 const messages=[],mod={exports:{}};
 const fakeNet={createConnection(_sock,cb){const c={end:raw=>messages.push(JSON.parse(raw)),on(){}};queueMicrotask(cb);return c;}};
 Function('require','module','exports','process',code)(name=>{assert.equal(name,'node:net');return fakeNet;},mod,mod.exports,{env:{HIVE_SOCK:home,AGENT_ID:'worker'}});
 const plugin=await mod.exports.HiveBridge();
 // Both legacy plugin/ and modern plugins/ can load the same bridge.
 const duplicate=await mod.exports.HiveBridge();
 assert.deepEqual(Object.keys(duplicate),[],'duplicate registration would count every call twice');
 await plugin['tool.execute.before']({tool:'bash',sessionID:'session-1',callID:'call-1'},{args:{command:'node check-a.cjs'}});
 await plugin['tool.execute.after']({tool:'bash',sessionID:'session-1',callID:'call-1',args:{command:'node check-a.cjs'}},{});
 await plugin['tool.execute.after']({tool:'bash',sessionID:'session-1',callID:'call-2',args:{command:'node check-b.cjs'}},{});
 await new Promise(r=>setImmediate(r));
 assert.equal(messages.length,3);
 assert.deepEqual(messages.map(m=>m.tool_input),[{command:'node check-a.cjs'},{command:'node check-a.cjs'},{command:'node check-b.cjs'}]);
 assert(messages.every(m=>m.session_id==='session-1'&&m.agent_id==='worker'));
});
