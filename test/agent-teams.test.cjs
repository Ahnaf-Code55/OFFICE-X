const test = require('node:test');
const assert = require('node:assert/strict');
const {buildTeamMembers, matchingTeamKeys} = require('./load-ts.cjs')('src/shared/agentTeams.ts');
const local = (id, name, extra = {}) => ({id, name, description: 'Assigned role: scope', status: 'idle', ...extra});
const roster = [local('god', 'Michael-B', {isGod: true}), local('forge', 'Forge'), local('qa', 'Lighthouse'), local('patch', 'Patch', {model:'opencode-go/glm-5.3-flash'})];

test('one shared specialist appears beneath both managers without duplicate hires', () => {
  const members = buildTeamMembers(roster, []);
  const patch = members.find(m => m.localId === 'patch');
  assert.deepEqual(patch.parentKeys, ['local:forge', 'local:qa']);
  assert.equal(members.filter(m => m.name === 'Patch').length, 1);
  assert.equal(patch.model, 'opencode-go/glm-5.3-flash');
  assert.equal(members.find(m => m.name === 'Michael-A').status, 'not connected');
  assert.equal(members.find(m => m.name === 'Orbit').status, 'not hired');
  assert.deepEqual(members.find(m => m.name === 'Core').parentKeys, ['local:forge']);
});
test('saved IDs and tags preserve assignments after renaming, and override the chart', () => {
  const members = buildTeamMembers([local('god','Michael-B'),local('f','Renamed lead',{organization:{side:'turjo',role:'manager',reportsTo:['god'],tags:['APIs']}}),local('c','Core',{organization:{side:'turjo',role:'worker',reportsTo:['f'],tags:['Backend']}})], []);
  const core = members.find(m => m.localId === 'c');
  assert.deepEqual(core.parentKeys, ['local:f']);
  assert.equal(core.title, 'Backend');
});
test('remote IDs are namespaced, have live presence only and cannot select a local PTY', () => {
  const peers = [{id:'brother',name:'Ahnaf',agents:[{id:'god',name:'Michael-A',character:'michael',status:'working'},{id:'forge',name:'Aurora',character:'pam',status:'waiting'}]}];
  const members = buildTeamMembers(roster, peers);
  const remote = members.find(m => m.name === 'Aurora' && m.source === 'remote');
  assert.equal(remote.key, 'remote:brother:forge');
  assert.equal(remote.localId, undefined);
  assert.equal(remote.model, undefined);
  assert.equal(remote.status, 'waiting');
  assert.deepEqual(remote.parentKeys, ['remote:brother:god']);
  assert.equal(members.filter(m => m.name === 'Michael-A').length, 1);
});
test('searching a worker or its model retains every manager path', () => {
  const members = buildTeamMembers(roster, []);
  const keys = matchingTeamKeys(members, 'glm-5.3');
  for (const id of ['patch','forge','qa','god']) assert.equal(keys.has(`local:${id}`),true);
  assert.equal(keys.has('planned:ahnaf:Aurora'),false);
});
test('invalid cycles and missing parents leave agents visible as roots', () => {
  const organization = {side:'turjo',role:'worker',tags:[],reportsTo:['b','missing']};
  const members = buildTeamMembers([local('a','First',{organization}),local('b','Second',{organization:{...organization,reportsTo:['a']}})],[]);
  assert.equal(members.length,2);
  assert.deepEqual(members.map(m=>m.parentKeys),[[],[]]);
});
test('generic offices do not acquire company placeholder agents; archived agents stay hidden', () => {
  const members = buildTeamMembers([local('x','My agent'),local('y','Former agent',{archived:true})],[]);
  assert.equal(members.length,1);
  assert.equal(members[0].side,'unassigned');
});
test('malformed restored team labels cannot crash or hide a live agent', () => {
  const members = buildTeamMembers([local('god','Michael-B'),local('f','Forge',{organization:{side:'unknown',role:'manager',reportsTo:['god']}})],[]);
  const forge = members.find(m => m.localId === 'f');
  assert.equal(forge.side,'turjo');
  assert.deepEqual(forge.parentKeys,['local:god']);
});
test('flat agent search can omit ancestors while Teams keeps reporting paths', () => {
  const members=buildTeamMembers(roster,[]);
  assert.deepEqual([...matchingTeamKeys(members,'glm-5.3',false)],['local:patch']);
});

const {buildTeamTree} = require('./load-ts.cjs')('src/shared/agentTeams.ts');
const paths = tree => tree.flatMap(({member,children}) => [[member.key],...paths(children).map(path=>[member.key,...path])]);
test('All agents keeps renamed coordinator and saved manager IDs above workers, including shared specialists', () => {
  const organization=(role,reportsTo)=>({side:'turjo',role,reportsTo,tags:[]});
  const members=buildTeamMembers([
    local('god','Michael-B Jordan',{isGod:true,organization:organization('orchestrator',[])}),
    local('forge-new-id','Forge',{organization:organization('manager',['god'])}),
    local('qa-new-id','Lighthouse',{organization:organization('manager',['god'])}),
    local('core','Core',{organization:organization('worker',['forge-new-id'])}),
    local('patch','Patch',{organization:organization('worker',['forge-new-id','qa-new-id'])})
  ],[]);
  const tree=buildTeamTree(members,'',false);
  assert.deepEqual(tree.map(b=>b.member.key),['local:god']);
  for(const path of [['local:god','local:forge-new-id','local:core'],['local:god','local:forge-new-id','local:patch'],['local:god','local:qa-new-id','local:patch']])assert(paths(tree).some(p=>JSON.stringify(p)===JSON.stringify(path)));
  assert.equal(members.filter(m=>m.localId==='patch').length,1);
});
test('worker/model search preserves each full manager path in both drawer modes', () => {
  const members=buildTeamMembers(roster,[]);
  for(const includePlanned of [true,false]) {
    const found=paths(buildTeamTree(members,'glm-5.3',includePlanned));
    assert(found.some(p=>p.join('/')==='local:god/local:forge/local:patch'));
    assert(found.some(p=>p.join('/')==='local:god/local:qa/local:patch'));
    assert(!found.some(p=>p.includes('planned:ahnaf:Aurora')));
  }
});
test('All agents retains placeholder ancestors but omits unrelated empty positions', () => {
  const members=buildTeamMembers([local('god','Michael-B'),local('core','Core')],[]);
  const tree=buildTeamTree(members,'',false);
  assert(paths(tree).some(p=>p.join('/')==='local:god/planned:turjo:Forge/local:core'));
  assert(!paths(tree).some(p=>p.includes('planned:turjo:Atlas')));
});
test('missing/invalid assignments stay visible; both office sides keep workers under their own managers', () => {
  const peers=[{id:'brother',name:'Ahnaf',agents:[{id:'god',name:'Michael-A',character:'michael',status:'working'},{id:'aurora',name:'Aurora',character:'pam',status:'idle'},{id:'pixel',name:'Pixel',character:'jim',status:'idle'}]}];
  const members=buildTeamMembers([...roster,local('orphan','Custom worker',{organization:{side:'turjo',role:'worker',reportsTo:['missing'],tags:[]}})],peers);
  const tree=buildTeamTree(members,'',false),found=paths(tree);
  assert(tree.some(b=>b.member.key==='local:orphan'));
  assert(found.some(p=>p.join('/')==='remote:brother:god/remote:brother:aurora/remote:brother:pixel'));
  assert(found.some(p=>p.join('/')==='local:god/local:forge/local:patch'));
  assert.equal(buildTeamTree(members,'no-such-agent',false).length,0);
});
