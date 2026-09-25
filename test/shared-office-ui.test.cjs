'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const locale = (code) => JSON.parse(read(`src/renderer/src/i18n/locales/${code}.json`));
const locales = ['en', 'zh-CN', 'ar'];
const orgSection = read('src/renderer/src/components/triggers/OrgSection.tsx');
const officeFloor = read('src/renderer/src/scene/office/OfficeFloor.tsx');
const sharedOfficeRoster = read('src/renderer/src/scene/office/SharedOfficeRoster.tsx');

test('Shared Office copy describes conditional approval and names the mode control', () => {
  for (const code of locales) {
    const strings = locale(code);
    assert.ok(strings.teamMembers.requestHint, `${code}: task request guidance is missing`);
    assert.ok(strings.teamMembers.peerToPeerInviteHint, `${code}: peer-to-peer invite guidance is missing`);
    assert.ok(strings.orgSection.trust, `${code}: task handling mode label is missing`);
  }
  assert.match(locale('en').teamMembers.requestHint, /await approval unless .*allows all .*access level permits automatic dispatch/i);
  assert.doesNotMatch(locale('en').teamMembers.requestHint, /decides whether to approve/i);
  assert.match(orgSection, /<Field label=\{t\('orgSection\.trust'\)\}>/);
});

test('peer-to-peer invite copy is shown only for that route mode', () => {
  assert.match(orgSection, /cfg\.connectionMode === 'peer-to-peer' && <Hint>\{t\('teamMembers\.peerToPeerInviteHint'\)\}<\/Hint>/);
  assert.match(locale('en').teamMembers.peerToPeerInviteHint, /enable Peer to peer before creating your invite/i);
  assert.match(locale('en').teamMembers.peerToPeerInviteHint, /create and share a new invite/i);
});

test('revoking or losing a remote peer clears the selected agent and unsent controls', () => {
  assert.match(orgSection, /const stillTrusted = teamMembers\.some\(\(member\) => member\.memberId === memberId\)/);
  assert.match(orgSection, /const stillOnline = remotePresence\.some\(\(peer\) => peer\.id === memberId[\s\S]*peer\.agents\.some\(\(agent\) => agent\.id === agentId\)\)/);
  assert.match(orgSection, /if \(!stillTrusted \|\| !stillOnline\)\s*\{\s*setRemoteAgentKey\(''\);\s*setRemotePrompt\(''\);\s*setRemoteTerminalInput\(''\);/);
  assert.match(orgSection, /if \(remoteAgentKey\.startsWith\(`\$\{member\.memberId\}\\u0000`\)\)\s*\{\s*setRemoteAgentKey\(''\);/);
});

test('existing terminal output consent can be revoked while transport is stopped', () => {
  assert.match(orgSection, /const checked = \(terminalShares\[member\.memberId\] \?\? \[\]\)\.includes\(agent\.id\)/);
  assert.match(orgSection, /disabled=\{teamBusy \|\| \(!transportStatus\.running && !checked\)\}/);
});

test('the office floor shows the local AI team and a distinct section for each teammate', () => {
  assert.match(officeFloor, /<SharedOfficeRoster \/>/);
  assert.match(sharedOfficeRoster, /title=\{t\('office\.sharedOffice\.yourSection'\)\}/);
  assert.match(sharedOfficeRoster, /peers\.map\(\(peer\) => <Section key=\{peer\.id\}/);
  assert.match(sharedOfficeRoster, /agents=\{peer\.agents\.map\(\(agent\) =>/);
  assert.match(sharedOfficeRoster, /role="img" aria-label=\{labels\[status\]\}/);
  assert.match(sharedOfficeRoster, /aria-expanded=\{expanded\}/);
  for (const code of locales) {
    const labels = locale(code).office.sharedOffice;
    assert.ok(labels.title && labels.yourSection && labels.teammateSection && labels.inviteHint, `${code}: shared office roster copy missing`);
    for (const status of ['idle', 'working', 'waiting', 'offline']) assert.ok(labels.status[status], `${code}: ${status} status label missing`);
  }
});
