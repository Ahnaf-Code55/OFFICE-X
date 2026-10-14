'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const load=require('./load-ts.cjs');
const {HiveManager}=load('src/main/hive.ts'),{hiveReplyInstruction,terminalWorkOrderPrompt}=load('src/shared/hiveReply.ts');
test('reply-required mail retains requester and exact conversation through the inbox drain',async t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'office-completion-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 const hive=new HiveManager(()=>home);
 const injection=await hive.ensureAgent({id:'worker',name:'Worker',provider:'claude',cwd:home});
 assert(injection.args.some(arg=>arg.includes('4b. For any inter-agent inbox message with requires_reply=true')));
 const message=hive.send({id:'request-1',to:'worker',from:'manager',act:'request',conversation:'project-check',body:'Verify the fixture'});
 const drain=hive.drainForStop('worker');
 assert(drain.block);assert.match(drain.reason,/REPLY REQUIRED/);
 for(const field of ['"to":"manager"','"conversation":"project-check"','"in_reply_to":"request-1"','"requires_reply":false'])assert(drain.reason.includes(field));
 assert(drain.reason.includes(path.join(home,'hive','agents','worker','outbox')));
 assert.match(drain.reason,/terminal-only answer does not reach/);
 assert.equal(hiveReplyInstruction({...message,requiresReply:false},'outbox'),'');
});

test('terminal handoffs carry completion routing instead of instructing terminal-only answers',async t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'office-completion-wire-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 let handoff;
 const hive=new HiveManager(()=>home,(channel,payload)=>{if(channel==='hive:terminalHandoff')handoff=payload;return true;});
 await hive.ensureAgent({id:'worker',name:'Worker',provider:'custom',cwd:home});
 hive.send({id:'request-2',to:'worker',from:'manager',act:'request',conversation:'project-2',body:'Check fixture'});
 assert.equal(handoff.conversation,'project-2');
 assert.equal(handoff.outboxDir,path.join(home,'hive','agents','worker','outbox'));
 const prompt=terminalWorkOrderPrompt(handoff);
 for(const field of ['REPLY REQUIRED','"to":"manager"','"conversation":"project-2"','"in_reply_to":"request-2"'])assert(prompt.includes(field));
 assert(!terminalWorkOrderPrompt({...handoff,requiresReply:false}).includes('REPLY REQUIRED'));
});

test('breaker feedback reaches the coordinator and human coordinator requests do not self-mail',()=>{
 const request={id:'r',from:'breaker',conversation:'c',requiresReply:true};
 assert(hiveReplyInstruction(request,'outbox').includes('"to":"god"'));
 const human=hiveReplyInstruction({...request,from:'human'},'outbox',true);
 assert.match(human,/directly to the human/);assert(!human.includes('"to":"human"'));
});
