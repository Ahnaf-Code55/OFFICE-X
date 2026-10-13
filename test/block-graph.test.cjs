const test=require('node:test');
const assert=require('node:assert/strict');
const load=require('./load-ts.cjs');
const {buildTeamMembers}=load('src/shared/agentTeams.ts');
const {blockLayout,messageRoute}=load('src/renderer/src/components/memoryGraph/blockLayout.ts');
const {buildCommunication,messageAge}=load('src/renderer/src/components/memoryGraph/communication.ts');
const agent=(id,name)=>({id,name,description:'Assigned job',status:'idle'});
const members=buildTeamMembers([agent('god','Michael-B'),agent('forge','Forge'),agent('core','Core'),agent('patch','Patch'),agent('qa','Lighthouse')],[]);
const now=1000000;
const message=(id,from,to,act,ts=now-1000,extra={})=>({kind:'message',id,from,to,act,ts,...extra});

test('reporting blocks put two office sides next to each other with workers below their own manager',()=>{
 const l=blockLayout(members,[]);
 assert.deepEqual(l.groups.map(g=>g.side),['ahnaf','turjo']);
 assert.ok(l.groups[0].x+l.groups[0].w<l.groups[1].x);
 const forge=l.nodes.find(n=>n.key==='local:forge');const core=l.nodes.find(n=>n.key==='local:core');
 assert.ok(core.y>forge.y+forge.h);assert.equal(core.parentKey,forge.key);
 assert.equal(core.x+core.w/2,forge.x+forge.w/2);
 const chronicle=l.nodes.find(n=>n.label==='Chronicle');
 assert.equal(l.nodes.find(n=>n.key===chronicle.parentKey).label,'Narrative');
});
test('shared specialists render several blocks but remain one local employee',()=>{
 const l=blockLayout(members,[]);const patch=l.nodes.filter(n=>n.key==='local:patch');
 assert.equal(patch.length,2);assert.deepEqual(patch.map(n=>n.parentKey),['local:forge','local:qa']);
 assert.equal(new Set(patch.map(n=>n.id)).size,2);
});
test('a question back to a manager has its own receiver and latest act',()=>{
 const c=buildCommunication(members,[message('1','forge','core','request'),message('2','core','forge','query')],now,15);
 assert.equal(c.edges.length,2);
 const q=c.edges.find(e=>e.act==='query');assert.equal(q.source,'local:core');assert.equal(q.target,'local:forge');
 const l=blockLayout(members,[]);const forward=messageRoute(l,c.edges.find(e=>e.act==='request'));const back=messageRoute(l,q);
 assert.equal(back.to.key,'local:forge');assert.equal(forward.to.key,'local:core');assert.notEqual(back.path,forward.path);
});
test('messages to a shared specialist route to its occurrence under the sending manager',()=>{
 const l=blockLayout(members,[]);const c=buildCommunication(members,[message('1','qa','patch','request')],now,15);
 assert.equal(messageRoute(l,c.edges[0]).to.parentKey,'local:qa');
});
test('timestamps filter old/invalid/future events without inventing recent activity',()=>{
 const rows=[message('old','god','core','request',now-16*60000),message('new','god','core','query'),message('future','core','god','query',now+50000),message('invalid','core','god','inform',NaN)];
 assert.equal(buildCommunication(members,rows,now,15).edges[0].count,1);
 assert.equal(buildCommunication(members,rows,now,null).edges[0].count,2);
 assert.equal(messageAge(now-20_000,now),'20s');assert.equal(messageAge(now-120_000,now),'2m');
});
test('successful broadcast recipients are expanded and failed deliveries remain absent',()=>{
 const rows=[message('1','god','broadcast','request',now,{delivered:['forge','core']}),message('2','god','patch','request',now,{delivered:[]})];
 const c=buildCommunication(members,rows,now,15);
 assert.deepEqual(c.edges.map(e=>e.target).sort(),['local:core','local:forge']);assert.equal(c.participants.length,0);
});
test('duplicate route log entries are counted once and raw subjects never reach graph data',()=>{
 const row=message('same','forge','core','request',now,{subject:'RAW SECRET BODY',body:'private'});
 const c=buildCommunication(members,[row,row],now,15);assert.equal(c.edges[0].count,1);
 assert.equal(JSON.stringify(c).includes('RAW SECRET'),false);
});
test('remote presence with a colliding ID cannot become a local message target or terminal',()=>{
 const remote=buildTeamMembers([agent('god','Michael-B')],[{id:'peer',name:'Ahnaf',agents:[{id:'god',name:'Michael-A',character:'michael',status:'working'}]}]);
 const c=buildCommunication(remote,[message('1','human','god','request')],now,15);
 assert.equal(c.edges[0].target,'local:god');assert.equal(remote.find(m=>m.source==='remote').localId,undefined);
 assert.equal(c.edges.some(e=>e.target.startsWith('remote:')),false);
});
test('generic independent employees and unmatched manager IDs stay visible',()=>{
 const generic=buildTeamMembers([agent('x','Independent')],[]);const l=blockLayout(generic,[]);
 assert.equal(l.nodes.length,1);assert.equal(l.nodes[0].label,'Independent');assert.equal(l.groups[0].side,'unassigned');
});
test('all graph rectangles fit inside their side frame and viewport extent',()=>{
 const l=blockLayout(members,[{key:'participant:human',label:'Human'}]);
 for(const g of l.groups)for(const n of g.nodes){assert.ok(n.x>=g.x&&n.x+n.w<=g.x+g.w);assert.ok(n.y>=g.y&&n.y+n.h<=g.y+g.h);}
 assert.ok(l.width>=Math.max(...l.nodes.map(n=>n.x+n.w)));assert.ok(l.height>=Math.max(...l.nodes.map(n=>n.y+n.h)));
});
test('a human-directed request stays addressed to Human despite the god delivery proxy',()=>{
 const c=buildCommunication(members,[message('1','forge','human','query',now,{delivered:['god']})],now,15);
 assert.equal(c.edges[0].target,'participant:human');assert.equal(c.participants[0].label,'Human');
});
test('an undelivered human request is not drawn as successful communication',()=>{
 assert.equal(buildCommunication(members,[message('1','forge','human','query',now,{delivered:[]})],now,15).edges.length,0);
});
