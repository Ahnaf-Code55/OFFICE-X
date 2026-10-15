'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const load=require('./load-ts.cjs');
const {createChat,ROUND_LIFETIME_MS}=load('src/main/chat.ts');
const {canHear,roleTier,requestIntent,isRoomRequestPending,MAX_ROOM_TURNS,MAX_AGENT_REPLY_CHARS,MAX_ROOM_CONTEXT_CHARS}=load('src/shared/officeRooms.ts');
const {parseTeamAction}=load('src/main/teamActions.ts');
const {parseTeamPresence}=load('src/shared/teamPresence.ts');
function office(t,extra={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'office-discussion-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const kv=new Map(),delivered=[],emitted=[],wire=[],names={god:'Michael-B Jordan',atlas:'Atlas',forge:'Forge',orbit:'Orbit',core:'Core'},ranks={god:'leadership',atlas:'middle',forge:'middle',orbit:'staff',core:'staff'};let clock=1000;
 const chat=createChat({dir,getKv:k=>kv.get(k),setKv:(k,v)=>kv.set(k,v),myName:()=> 'Turjo',agentIds:()=>Object.keys(names),agentName:id=>names[id],agentTier:id=>ranks[id],agentWork:id=>({god:'Office coordinator',atlas:'Cloud deployment',forge:'Backend API engineering',orbit:'Cloud DevOps',core:'Backend API implementation'})[id],leadAgentId:()=> 'god',deliverToAgent:(id,subject,body)=>delivered.push({id,subject,body}),sendToTeammates:async body=>wire.push(body),emit:m=>emitted.push(m),now:()=>clock,...extra});
 const room=channel=>chat.rooms().find(r=>r.channel===channel),reply=(id,body='My independent assessment.',channel='everyone')=>chat.receiveAgent(id,body,`chat-${room(channel).round.id}`);
 return {chat,room,reply,kv,delivered,emitted,wire,advance:ms=>{clock+=ms}};
}
test('room membership: humans unrestricted, workers Everyone, managers Managers/Everyone, orchestrators all',()=>{
 for(const role of ['worker','manager','orchestrator']){const tier=roleTier(role);assert.equal(canHear(tier,'everyone'),true);assert.equal(canHear(tier,'managers'),role!=='worker');assert.equal(canHear(tier,'leadership'),role==='orchestrator')}
 assert.equal(roleTier(undefined,true),'leadership');assert.equal(canHear('off','everyone'),false);
});
test('room triggers recognize requests, silent joins and stop; ordinary chat stays quiet',()=>{
 for(const text of ['give me a report','what is the progress update?','Please report blockers'])assert.equal(requestIntent(text),'report');
 assert.equal(requestIntent('Starting the meeting, everyone join'),'start');assert.equal(requestIntent('end the meeting'),'stop');
 for(const text of ['morning team','I uploaded the report','The report looks good','Do not send a report',"don't start the meeting",'Do not stop this meeting'])assert.equal(requestIntent(text),undefined);
});
test('quiet rooms do not wake AIs, even for mentions or unsolicited agent chat',async t=>{
 const o=office(t);for(const channel of ['everyone','managers','leadership'])await o.chat.post(channel,'hello @Atlas','');
 o.chat.receiveAgent('god','I will broadcast to everyone');assert.equal(o.delivered.length,0);assert.equal(o.emitted.length,3);assert(o.chat.rooms().every(r=>!r.active));
});
test('starting/joining a meeting makes zero paid acknowledgments; a topic starts a bounded round',async t=>{
 const o=office(t);await o.chat.post('everyone','Starting the meeting, everyone join','');assert.equal(o.delivered.length,0);assert.equal(o.room('everyone').active,true);
 await o.chat.post('everyone','How should we design the cloud deployment?','');assert.equal(o.delivered.length,1);assert.equal(o.delivered[0].id,'atlas');assert.equal(o.room('everyone').round.turns.length,MAX_ROOM_TURNS);
 assert.match(o.delivered[0].body,/your own assessment/);assert.match(o.delivered[0].body,/concrete flaw/);assert.match(o.delivered[0].body,/not authorization/);assert.match(o.delivered[0].body,/only file change this discussion authorizes/);
});
test('reports schedule relevant manager + worker + coordinator sequentially, with no AI mention chain',async t=>{
 const o=office(t);await o.chat.post('everyone','Please report backend API progress','');assert.equal(o.delivered[0].id,'forge');assert.equal(o.delivered.length,1);
 o.reply('forge','The API contract has a flaw: no error schema. @Atlas');assert.equal(o.delivered.at(-1).id,'core');
 o.reply('core','I disagree with starting implementation until the schema is agreed.');assert.equal(o.delivered.at(-1).id,'god');assert.match(o.delivered.at(-1).body,/API contract has a flaw/);assert.match(o.delivered.at(-1).body,/Wrap up the actual views/);
 o.reply('god','Decision: agree the error schema, then Core implements.');assert.equal(o.delivered.length,3);assert.equal(o.room('everyone').round.status,'complete');
 o.reply('god','@Atlas do another paid turn');assert.equal(o.delivered.length,3);assert.equal(o.emitted.filter(m=>m.authorKind==='agent').length,3);
});
test('room boundaries and saved role ranks survive renamed leads and legacy staff overrides',async t=>{
 const o=office(t);o.kv.set('chat:tiers',{atlas:'staff',god:'staff'});assert.equal(o.chat.tiers().atlas,'middle');assert.equal(o.chat.tiers().god,'leadership');
 await o.chat.post('leadership','please report','');assert.deepEqual(o.room('leadership').round.turns.map(t=>t.agentId),['god']);o.reply('god','Leadership decision','leadership');
 await o.chat.post('managers','please report @Core','');assert(o.room('managers').round.turns.every(turn=>['god','atlas','forge'].includes(turn.agentId)));
 o.chat.setTier('god','off');await o.chat.post('leadership','please report','');assert.equal(o.room('leadership').round.turns.length,0);
});
test('direct report mentions invite only the named eligible employee',async t=>{
 const o=office(t);await o.chat.post('everyone','@Core please report your blockers','');assert.deepEqual(o.room('everyone').round.turns.map(t=>t.agentId),['core']);o.reply('core','One blocker.');assert.equal(o.delivered.length,1);
});
test('agent replies require the exact round identity; stale, duplicate, wrong-room and uninvited replies are rejected',async t=>{
 const o=office(t);await o.chat.post('everyone','@Core report','');const old=o.room('everyone').round.id;
 await o.chat.post('managers','@Forge report','');const manager=o.room('managers').round.id;
 o.chat.receiveAgent('core','Wrong room',`chat-${manager}`);o.chat.receiveAgent('orbit','Not invited',`chat-${old}`);o.chat.receiveAgent('core','No correlation');
 assert.equal(o.emitted.filter(m=>m.authorKind==='agent').length,0);
 await o.chat.post('everyone','@Core please report again','');o.chat.receiveAgent('core','Old reply',`chat-${old}`);assert.equal(o.emitted.filter(m=>m.authorKind==='agent').length,0);
 o.reply('core','Correct reply.');o.reply('core','Duplicate.');assert.equal(o.emitted.filter(m=>m.authorKind==='agent').length,1);
});
test('end meeting cancels queued invitations and makes subsequent casual posts quiet',async t=>{
 const o=office(t);await o.chat.post('everyone','Start meeting','');await o.chat.post('everyone','Backend architecture idea','');const id=o.room('everyone').round.id;
 await o.chat.post('everyone','End meeting','');assert.equal(o.room('everyone').active,false);assert.equal(o.room('everyone').round.status,'cancelled');
 o.chat.receiveAgent('forge','Too late',`chat-${id}`);await o.chat.post('everyone','Thanks everyone','');assert.equal(o.delivered.length,1);
});
test('pending approvals cannot hold a round indefinitely; new human requests can retry',async t=>{
 const o=office(t);await o.chat.post('everyone','@Core report','');o.advance(ROUND_LIFETIME_MS+1);assert.equal(o.room('everyone').round.status,'expired');o.reply('core','Late after expiry');assert.equal(o.emitted.filter(m=>m.authorKind==='agent').length,0);
 await o.chat.post('everyone','@Core please report again','');assert.equal(o.room('everyone').round.status,'collecting');
});
test('round context and visible AI reply are capped without truncating the human log',async t=>{
 const o=office(t);await o.chat.post('everyone','please report '+'x'.repeat(3500),'');const turn=o.delivered.at(-1).id;o.reply(turn,'a'.repeat(4000));assert.equal(o.emitted.at(-1).text.length,MAX_AGENT_REPLY_CHARS);
 assert(o.delivered.at(-1).body.length < MAX_ROOM_CONTEXT_CHARS+3000);assert.equal(o.chat.list()[0].text.length,3514);
});
test('another requested round rotates independent voices and stays human driven',async t=>{
 const o=office(t);await o.chat.post('everyone','Please report progress','');const first=o.room('everyone').round.turns.map(t=>t.agentId);for(const id of first)o.reply(id);
 await o.chat.post('everyone','Another opinion please','', 'continue');const next=o.room('everyone').round.turns.map(t=>t.agentId);assert.notEqual(next[0],first[0]);assert.notEqual(next[1],first[1]);assert.equal(o.delivered.length,4);
});
test('remote permission gate remains intact; authorized human requests share round IDs but AI replies never prompt others',t=>{
 const o=office(t),id='1234567890abcdef',body={memberId:'brother',memberName:'Ahnaf',channel:'everyone',text:'report on backend',image:'',authorKind:'human',authorName:'Ahnaf',requestId:id,intent:'report'};
 o.chat.receiveRemote({...body,canPromptAgents:false});assert.equal(o.delivered.length,0);
 o.chat.receiveRemote({...body,canPromptAgents:true});assert.equal(o.room('everyone').round.id,id);assert.equal(o.delivered.length,1);
 o.chat.receiveRemote({...body,canPromptAgents:true,authorKind:'agent',authorName:'Aurora',intent:undefined,text:'I see a frontend concern.'});assert.equal(o.delivered.length,1);assert.equal(o.emitted.at(-1).authorName,'Aurora (Ahnaf)');
 o.chat.receiveRemote({...body,canPromptAgents:true,authorKind:'agent',authorName:'Aurora',intent:undefined,text:'Duplicate'});assert.notEqual(o.emitted.at(-1).text,'Duplicate');
});
test('remote AI chatter is limited to three identities per peer/request and stops with the room',t=>{
 const o=office(t),id='1234567890abcdef';o.chat.receiveRemote({memberId:'b',memberName:'Ahnaf',canPromptAgents:true,channel:'everyone',text:'report',image:'',authorKind:'human',authorName:'Ahnaf',requestId:id});
 for(let i=0;i<10;i++)o.chat.receiveRemote({memberId:'b',memberName:'Ahnaf',canPromptAgents:true,channel:'everyone',text:'view '+i,image:'',authorKind:'agent',authorName:'Agent '+i,requestId:id});
 assert.equal(o.emitted.filter(m=>m.authorKind==='agent').length,3);
});
test('room activation does not persist across an app restart',async t=>{
 const o=office(t);await o.chat.post('everyone','start meeting','');const next=office(t,{getKv:k=>o.kv.get(k),setKv:(k,v)=>o.kv.set(k,v)});assert(next.chat.rooms().every(r=>!r.active&&!r.round));assert(next.chat.list().length>0);
});
const member={memberId:'device-friend',displayName:'Ahnaf',controlLevel:'delegated'};
const parse=body=>parseTeamAction({message:{senderId:member.memberId,action:'chat',body},member,targets:[],hasTerminal:()=>false});
test('shared room wire accepts legacy input and validates optional request controls strictly',()=>{
 const legacy={channel:'everyone',text:'hi',image:'',authorKind:'human',authorName:'Ahnaf'};assert.equal(parse(legacy).text,'hi');assert.equal(parse({...legacy,requestId:'abcdef0123456789',intent:'start'}).intent,'start');
 for(const extra of [{requestId:'../../x'},{intent:'spam'},{intent:'start',authorKind:'agent'},{arbitrary:'x'}])assert.throws(()=>parse({...legacy,...extra}));
});
test('authenticated presence can share renamed managers/orchestrators ranks without paths/models',()=>{
 const agent={id:'god',name:'Renamed coordinator',character:'michael',status:'idle',chatTier:'leadership'};assert.equal(parseTeamPresence([{id:'brother',name:'Ahnaf',agents:[agent]}])[0].agents[0].chatTier,'leadership');
 for(const extra of [{chatTier:'admin'},{model:'secret'},{cwd:'/private'}])assert.throws(()=>parseTeamPresence([{id:'brother',name:'Ahnaf',agents:[{...agent,...extra}]}]));
});
test('direct remote, human and out-of-room addresses do not wake unrelated local agents',async t=>{
 const o=office(t);for(const [room,text] of [['everyone','@Aurora please report'],['everyone','@Ahnaf please report'],['managers','@Core please report']]){await o.chat.post(room,text,'');assert.equal(o.room(room).round.turns.length,0)}
 assert.equal(o.delivered.length,0);await o.chat.post('everyone','@Everyone please report','');assert.equal(o.room('everyone').round.turns.length,3);
});
test('two updated offices share one meeting/request identity and never create an AI echo loop',async t=>{
 let a,b;const sentA=[],sentB=[];
 a=office(t,{sendToTeammates:async body=>{sentA.push(body);b.chat.receiveRemote({...body,memberId:'turjo',memberName:'Turjo',canPromptAgents:true})}});
 b=office(t,{myName:()=> 'Ahnaf',sendToTeammates:async body=>{sentB.push(body);a.chat.receiveRemote({...body,memberId:'ahnaf',memberName:'Ahnaf',canPromptAgents:true})}});
 await a.chat.post('managers','Starting the meeting, everyone join','');assert.equal(a.delivered.length+b.delivered.length,0);assert(a.room('managers').active&&b.room('managers').active);
 await a.chat.post('managers','What is our backend architecture recommendation?','');assert.equal(a.room('managers').round.id,b.room('managers').round.id);
 for(const o of [a,b])for(const id of o.room('managers').round.turns.map(t=>t.agentId))o.reply(id,'My office has one concrete concern.','managers');
 assert.equal(a.delivered.length,3);assert.equal(b.delivered.length,3);assert.equal(a.emitted.filter(m=>m.authorKind==='agent').length,6);assert.equal(b.emitted.filter(m=>m.authorKind==='agent').length,6);
 await b.chat.post('managers','End meeting','');assert(!a.room('managers').active&&!b.room('managers').active);assert.equal(a.delivered.length+b.delivered.length,6);
});
test('stopping after local completion also rejects delayed peer opinions',async t=>{
 const o=office(t);await o.chat.post('everyone','@Core report','');const id=o.room('everyone').round.id;o.reply('core');assert.equal(o.room('everyone').round.status,'complete');
 await o.chat.post('everyone','End meeting','');o.chat.receiveRemote({memberId:'b',memberName:'Ahnaf',canPromptAgents:true,channel:'everyone',text:'Delayed view',image:'',authorKind:'agent',authorName:'Aurora',requestId:id});assert.equal(o.emitted.at(-1).text,'End meeting');
});
test('delivery checks invalidate cancelled, replaced, expired and out-of-room invitations',async t=>{
 const o=office(t);await o.chat.post('everyone','@Core report','');const id=o.room('everyone').round.id;
 assert(o.chat.canDeliver('core',id,'everyone'));assert(!o.chat.canDeliver('forge',id,'everyone'));assert(!o.chat.canDeliver('core',id,'managers'));
 await o.chat.post('everyone','@Core report again','');assert(!o.chat.canDeliver('core',id,'everyone'));
 const next=o.room('everyone').round.id;o.advance(ROUND_LIFETIME_MS+1);assert(!o.chat.canDeliver('core',next,'everyone'));
 await o.chat.post('everyone','@Core report','');const last=o.room('everyone').round.id;await o.chat.post('everyone','End meeting','');assert(!o.chat.canDeliver('core',last,'everyone'));
});
test('renderer queue reconciliation keeps only current invitations, preserving normal work',()=>{
 const request={channel:'everyone',id:'1234567890abcdef',expiresAt:100},rooms=[{channel:'everyone',active:false,round:{id:request.id,status:'collecting',kind:'report',turns:[{agentId:'core',name:'Core',state:'speaking'}]}}];
 const queue=[{text:'normal work'},{text:'current report',chatRequest:request},{text:'old report',chatRequest:{...request,id:'old'}}];
 const reconcile=(state,now)=>queue.filter(m=>!m.chatRequest||isRoomRequestPending(state,'core',m.chatRequest,now));
 assert.deepEqual(reconcile(rooms,50).map(m=>m.text),['normal work','current report']);
 assert.deepEqual(reconcile(rooms,100).map(m=>m.text),['normal work']);
 rooms[0].round.status='cancelled';assert.deepEqual(reconcile(rooms,50).map(m=>m.text),['normal work']);
 assert(!isRoomRequestPending(rooms,'forge',request,50));assert.deepEqual(reconcile([],50).map(m=>m.text),['normal work']);
});
