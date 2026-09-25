import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLibp2p } from 'libp2p'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { identify } from '@libp2p/identify'
import { tcp } from '@libp2p/tcp'
import { webSockets } from '@libp2p/websockets'
import { DEFAULTS, optionsFromEnv, startRelayHost } from './server.mjs'

test('starts a Circuit Relay v2 node on TCP and WebSocket and accepts Noise/Yamux dials', async (t) => {
  const host = await startRelayHost({
    listen: ['/ip4/127.0.0.1/tcp/0', '/ip4/127.0.0.1/tcp/0/ws'],
    limits: {
      maxConnections: 8,
      maxInboundHopStreams: 4,
      maxOutboundHopStreams: 4,
      maxOutboundStopStreams: 4,
      maxReservations: 8,
      reservationTtlMs: 60_000,
      maxRelayedDurationMs: 60_000,
      maxRelayedDataBytes: 1024 * 1024,
    },
  })
  const client = await createLibp2p({
    transports: [tcp(), webSockets()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: { identify: identify() },
  })
  t.after(async () => {
    await client.stop()
    await host.stop()
  })

  const addresses = host.node.getMultiaddrs()
  assert.equal(addresses.length, 2)
  assert.ok(addresses.some((address) => address.toString().includes('/tcp/') && !address.toString().includes('/ws/')))
  assert.ok(addresses.some((address) => address.toString().includes('/ws/')))
  assert.ok(host.node.services.relay, 'circuit relay service should be installed')
  assert.ok(host.node.services.identify, 'identify should be installed')

  for (const address of addresses) {
    const connection = await client.dial(address)
    assert.equal(connection.remotePeer.toString(), host.node.peerId.toString())
    await client.hangUp(host.node.peerId)
  }
})

test('persists a configured host identity with restrictive file permissions', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'officex-relay-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const keyFile = join(directory, 'relay-key.pb')
  const options = { listen: ['/ip4/127.0.0.1/tcp/0'], keyFile }
  const first = await startRelayHost(options)
  const firstPeerId = first.node.peerId.toString()
  await first.stop()
  const fileStat = await stat(keyFile)
  assert.ok(fileStat.isFile())
  if (process.platform !== 'win32') assert.equal(fileStat.mode & 0o077, 0)
  assert.ok((await readFile(keyFile)).length > 0)

  const second = await startRelayHost(options)
  t.after(() => second.stop())
  assert.equal(second.node.peerId.toString(), firstPeerId)
})

test('accepts a Circuit Relay v2 reservation and carries a relayed peer connection', async (t) => {
  const relay = await startRelayHost({ listen: ['/ip4/127.0.0.1/tcp/0/ws'] })
  const relayAddress = relay.node.getMultiaddrs()[0]
  const target = await createLibp2p({
    addresses: { listen: ['/p2p-circuit'] },
    transports: [webSockets(), circuitRelayTransport()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: { identify: identify() },
  })
  const dialer = await createLibp2p({
    transports: [webSockets(), circuitRelayTransport()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: { identify: identify() },
  })
  t.after(async () => {
    await dialer.stop()
    await target.stop()
    await relay.stop()
  })

  await target.dial(relayAddress)
  const deadline = Date.now() + 5000
  let circuitAddress
  while (Date.now() < deadline) {
    circuitAddress = target.getMultiaddrs().find((address) => address.toString().includes('/p2p-circuit/p2p/'))
    if (circuitAddress) break
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.ok(circuitAddress, 'target should receive a relay reservation address')

  const connection = await dialer.dial(circuitAddress)
  assert.equal(connection.remotePeer.toString(), target.peerId.toString())
  assert.match(connection.remoteAddr.toString(), /\/p2p-circuit\/p2p\//)
})

test('loads relay environment settings and rejects invalid limit values', () => {
  const options = optionsFromEnv({
    OFFICEX_RELAY_LISTEN_MULTIADDRS: '/ip4/127.0.0.1/tcp/1,/ip4/127.0.0.1/tcp/2/ws',
    OFFICEX_RELAY_ANNOUNCE_MULTIADDRS: '/dns4/relay.example/tcp/443/wss',
    OFFICEX_RELAY_MAX_RESERVATIONS: '12',
    OFFICEX_RELAY_KEY_FILE: '/var/lib/officex/relay-key.pb',
  })
  assert.deepEqual(options.listen, ['/ip4/127.0.0.1/tcp/1', '/ip4/127.0.0.1/tcp/2/ws'])
  assert.deepEqual(options.announce, ['/dns4/relay.example/tcp/443/wss'])
  assert.equal(options.limits.maxReservations, 12)
  assert.equal(options.keyFile, '/var/lib/officex/relay-key.pb')
  assert.equal(DEFAULTS.maxConnections, 250)
  assert.throws(() => optionsFromEnv({ OFFICEX_RELAY_MAX_RESERVATIONS: '0' }), /integer from/)
})
