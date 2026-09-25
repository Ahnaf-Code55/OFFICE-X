'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');
const { normalizePublicTeamEndpoint, resolveManagedRelayAddress, teamListenAddressForEndpoint, teamEndpointForPeer } = loadTs('src/main/teamRoute.ts');

test('managed relay endpoint prefers a validated saved address and falls back to the release address', () => {
  const saved = '/dns4/relay.oqvian.com/tcp/443/wss/p2p/12D3KooWRelay';
  const release = '/ip4/198.51.100.20/tcp/4001/p2p/12D3KooWRelease';
  assert.equal(resolveManagedRelayAddress(saved, release), saved);
  assert.equal(resolveManagedRelayAddress('  ', release), release);
  assert.equal(resolveManagedRelayAddress('/dns4/bad relay/tcp/443/wss', release), release);
  assert.equal(resolveManagedRelayAddress('/bad\nroute', undefined), '');
});

test('accepts a public literal IP and builds a stable listener and invite route', () => {
  const endpoint = '/ip4/1.1.1.1/tcp/4111';
  assert.equal(normalizePublicTeamEndpoint(endpoint), endpoint);
  assert.equal(teamListenAddressForEndpoint(endpoint), '/ip4/0.0.0.0/tcp/4111');
  assert.equal(teamEndpointForPeer(endpoint, '12D3KooWBRcmbHbj2DbjbGYghj4rsjzC2KFgCjd6Pvt7HctkBEqk'),
    `${endpoint}/p2p/12D3KooWBRcmbHbj2DbjbGYghj4rsjzC2KFgCjd6Pvt7HctkBEqk`);
});

test('accepts global IPv6 while binding the same port on IPv6 wildcard', () => {
  const endpoint = '/ip6/2606:4700:4700::1111/tcp/4111';
  assert.equal(normalizePublicTeamEndpoint(endpoint), endpoint);
  assert.equal(teamListenAddressForEndpoint(endpoint), '/ip6/::/tcp/4111');
});

test('rejects private, loopback, reserved, DNS, malformed, and invalid-port routes', () => {
  for (const endpoint of [
    '/ip4/192.168.1.4/tcp/4111', '/ip4/127.0.0.1/tcp/4111', '/ip4/203.0.113.10/tcp/4111',
    '/dns4/relay.example.com/tcp/4111', '/ip4/1.1.1.1/tcp/0', '/ip4/1.1.1.1/tcp/65536',
    '/ip4/1.1.1.1/udp/4111', '/ip4/1.1.1.1/tcp/4111/p2p/12D3KooW'
  ]) assert.equal(normalizePublicTeamEndpoint(endpoint), '', endpoint);
  assert.equal(teamListenAddressForEndpoint('/ip4/192.168.1.4/tcp/4111'), undefined);
  assert.equal(teamEndpointForPeer('/ip4/1.1.1.1/tcp/4111', 'bad'), undefined);
});
