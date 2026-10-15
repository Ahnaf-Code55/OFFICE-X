const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-ts.cjs');
const { buildTeamMembers } = load('src/shared/agentTeams.ts');
const { buildAgentRoleRows, readRoleDockPreferences } = load('src/shared/agentRoleSections.ts');
const org = (role, reportsTo=[]) => ({side:'turjo', role, reportsTo, tags:[]});
const local = (id,name,role,reportsTo=[],extra={}) => ({id,name,description:'Assigned work',status:'idle',organization:org(role,reportsTo),...extra});
const members = () => buildTeamMembers([
  local('god','Michael-B Jordan','orchestrator'), local('forge','Forge','manager',['god']), local('qa','Lighthouse','manager',['god']),
  local('core','Core','worker',['forge'],{model:'opencode-go/minimax-m3'}),local('patch','Patch','worker',['forge','qa'],{model:'opencode-go/glm-5.3-flash'})
],[]);
test('roles are separate and specialists appear once with all managers',()=>{
  const all=members();
  assert.equal(buildAgentRoleRows(all,'orchestrator','turjo').length,1);
  assert.equal(buildAgentRoleRows(all,'manager','turjo').length,2);
  const workers=buildAgentRoleRows(all,'worker','turjo');assert.equal(workers.length,2);
  assert.deepEqual(workers.find(row=>row.member.name==='Patch').reportsTo.map(m=>m.name),['Forge','Lighthouse']);
  assert.equal(buildAgentRoleRows([...all,...all],'worker','all').length,2);
  assert.equal(workers.find(row=>row.member.name==='Core').member.model,'opencode-go/minimax-m3');
});
test('search matches manager, model or employee without mixing role sections',()=>{
  const all=members();
  assert.deepEqual(buildAgentRoleRows(all,'worker','turjo','Forge').map(r=>r.member.name),['Core','Patch']);
  assert.deepEqual(buildAgentRoleRows(all,'worker','all','GLM-5.3').map(r=>r.member.name),['Patch']);
  assert.equal(buildAgentRoleRows(all,'manager','all','minimax').length,0);
  assert.equal(buildAgentRoleRows(all,'worker','ahnaf').length,0);
});
test('legacy view preferences migrate to employees without changing side or reopening a closed drawer',()=>{
  assert.deepEqual(readRoleDockPreferences({mode:'all',expanded:['local:forge'],side:'turjo',open:true}),{role:'worker',side:'turjo',open:true});
  assert.deepEqual(readRoleDockPreferences({role:'manager',side:'ahnaf',open:false}),{role:'manager',side:'ahnaf',open:false});
  assert.deepEqual(readRoleDockPreferences(null),{role:'worker',side:'all',open:false});
  assert.deepEqual(readRoleDockPreferences({role:'admin',side:'bogus',open:'yes'}),{role:'worker',side:'all',open:false});
});
test('remote identities stay read-only and side-filtered; unfilled chart positions do not inflate counts',()=>{
  const all=buildTeamMembers([local('god','Michael-B','orchestrator')],[{id:'brother',name:'Ahnaf',agents:[
    {id:'god',name:'Michael-A',character:'michael',status:'working'}, {id:'aurora',name:'Aurora',character:'pam',status:'idle'},
    {id:'pixel',name:'Pixel',character:'jim',status:'working'}
  ]}]);
  const rows=buildAgentRoleRows(all,'worker','ahnaf');assert.equal(rows.length,1);
  assert.equal(rows[0].member.localId,undefined);assert.equal(rows[0].member.model,undefined);
  assert.equal(rows[0].member.key,'remote:brother:pixel');assert(rows[0].reportsTo.some(m=>m.key==='remote:brother:aurora'));
  assert.equal(buildAgentRoleRows(all,'worker','turjo').length,0);
});
test('a renamed shared coordinator retains its role and reporting labels within its own peer',()=>{
  const all=buildTeamMembers([], [{id:'brother',name:'Ahnaf',agents:[
    {id:'god',name:'Michael-A Jordan',character:'michael',status:'idle',chatTier:'leadership'},
    {id:'aurora',name:'Aurora',character:'pam',status:'idle',chatTier:'middle'},
    {id:'pixel',name:'Pixel',character:'jim',status:'idle',chatTier:'staff'}
  ]}]);
  assert.deepEqual(buildAgentRoleRows(all,'orchestrator','ahnaf').map(r=>r.member.name),['Michael-A Jordan']);
  const managers=buildAgentRoleRows(all,'manager','ahnaf');assert.equal(managers.length,1);
  assert.deepEqual(managers[0].reportsTo.map(m=>m.key),['remote:brother:god']);
  assert.equal(buildAgentRoleRows(all,'worker','ahnaf').length,1);
});
