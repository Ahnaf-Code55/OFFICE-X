#!/usr/bin/env node
import { constants as fsConstants } from 'node:fs'
import { open, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createLibp2p } from 'libp2p'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { circuitRelayServer } from '@libp2p/circuit-relay-v2'
import { identify } from '@libp2p/identify'
import { privateKeyFromProtobuf, privateKeyToProtobuf, generateKeyPair } from '@libp2p/crypto/keys'
import { tcp } from '@libp2p/tcp'
import { webSockets } from '@libp2p/websockets'

const DEFAULTS = Object.freeze({
  listen: ['/ip4/0.0.0.0/tcp/4001', '/ip4/0.0.0.0/tcp/4002/ws'],
  maxConnections: 250,
  maxInboundHopStreams: 128,
  maxOutboundHopStreams: 128,
  maxOutboundStopStreams: 128,
  maxReservations: 1000,
  reservationTtlMs: 2 * 60 * 60 * 1000,
  maxRelayedDurationMs: 30 * 60 * 1000,
  maxRelayedDataBytes: 64 * 1024 * 1024,
})
const DEFAULT_LIMITS = Object.freeze({
  maxConnections: DEFAULTS.maxConnections,
  maxInboundHopStreams: DEFAULTS.maxInboundHopStreams,
  maxOutboundHopStreams: DEFAULTS.maxOutboundHopStreams,
  maxOutboundStopStreams: DEFAULTS.maxOutboundStopStreams,
  maxReservations: DEFAULTS.maxReservations,
  reservationTtlMs: DEFAULTS.reservationTtlMs,
  maxRelayedDurationMs: DEFAULTS.maxRelayedDurationMs,
  maxRelayedDataBytes: DEFAULTS.maxRelayedDataBytes,
})

function positiveInt(name, value, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(`${name} must be an integer from ${min} to ${max}`)
  }
  return value
}

function parseCsv(value, fallback) {
  if (value == null || value.trim() === '') return [...fallback]
  const values = value.split(',').map((item) => item.trim()).filter(Boolean)
  if (values.length === 0) throw new TypeError('multiaddr list cannot be empty')
  return values
}

function optionsFromEnv(env = process.env) {
  return {
    listen: parseCsv(env.OFFICEX_RELAY_LISTEN_MULTIADDRS, DEFAULTS.listen),
    announce: parseCsv(env.OFFICEX_RELAY_ANNOUNCE_MULTIADDRS, []),
    keyFile: env.OFFICEX_RELAY_KEY_FILE?.trim() || undefined,
    limits: {
      maxConnections: positiveInt('OFFICEX_RELAY_MAX_CONNECTIONS', Number(env.OFFICEX_RELAY_MAX_CONNECTIONS || DEFAULTS.maxConnections), { max: 100_000 }),
      maxInboundHopStreams: positiveInt('OFFICEX_RELAY_MAX_INBOUND_HOP_STREAMS', Number(env.OFFICEX_RELAY_MAX_INBOUND_HOP_STREAMS || DEFAULTS.maxInboundHopStreams), { max: 100_000 }),
      maxOutboundHopStreams: positiveInt('OFFICEX_RELAY_MAX_OUTBOUND_HOP_STREAMS', Number(env.OFFICEX_RELAY_MAX_OUTBOUND_HOP_STREAMS || DEFAULTS.maxOutboundHopStreams), { max: 100_000 }),
      maxOutboundStopStreams: positiveInt('OFFICEX_RELAY_MAX_OUTBOUND_STOP_STREAMS', Number(env.OFFICEX_RELAY_MAX_OUTBOUND_STOP_STREAMS || DEFAULTS.maxOutboundStopStreams), { max: 100_000 }),
      maxReservations: positiveInt('OFFICEX_RELAY_MAX_RESERVATIONS', Number(env.OFFICEX_RELAY_MAX_RESERVATIONS || DEFAULTS.maxReservations), { max: 1_000_000 }),
      reservationTtlMs: positiveInt('OFFICEX_RELAY_RESERVATION_TTL_MS', Number(env.OFFICEX_RELAY_RESERVATION_TTL_MS || DEFAULTS.reservationTtlMs), { max: 30 * 24 * 60 * 60 * 1000 }),
      maxRelayedDurationMs: positiveInt('OFFICEX_RELAY_MAX_DURATION_MS', Number(env.OFFICEX_RELAY_MAX_DURATION_MS || DEFAULTS.maxRelayedDurationMs), { max: 24 * 60 * 60 * 1000 }),
      maxRelayedDataBytes: positiveInt('OFFICEX_RELAY_MAX_DATA_BYTES', Number(env.OFFICEX_RELAY_MAX_DATA_BYTES || DEFAULTS.maxRelayedDataBytes), { max: Number.MAX_SAFE_INTEGER }),
    },
  }
}

function validateOptions(options) {
  if (!Array.isArray(options.listen) || options.listen.length === 0 || options.listen.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new TypeError('listen must be a non-empty array of multiaddr strings')
  }
  if (!Array.isArray(options.announce) || options.announce.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new TypeError('announce must be an array of multiaddr strings')
  }
  if (options.keyFile != null && (typeof options.keyFile !== 'string' || options.keyFile.length === 0)) {
    throw new TypeError('keyFile must be a non-empty path when set')
  }
  for (const [name, value] of Object.entries(options.limits)) positiveInt(name, value)
}

async function readPrivateKeyFile(filePath) {
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0)
  const handle = await open(filePath, flags)
  try {
    const stat = await handle.stat()
    if (!stat.isFile()) throw new Error('relay key path must be a regular file')
    if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
      throw new Error('relay key file permissions must be 0600 or stricter')
    }
    const bytes = await handle.readFile()
    if (bytes.length === 0 || bytes.length > 16 * 1024) throw new Error('relay key file has an invalid size')
    try { return privateKeyFromProtobuf(bytes) }
    catch { throw new Error('relay key file is invalid; it was left unchanged') }
  } finally {
    await handle.close()
  }
}

async function loadOrCreatePrivateKey(filePath) {
  const path = resolve(filePath)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  try {
    return await readPrivateKeyFile(path)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }

  const key = await generateKeyPair('Ed25519')
  const bytes = privateKeyToProtobuf(key)
  try {
    const handle = await open(path, 'wx', 0o600)
    try {
      await handle.writeFile(bytes)
      await handle.sync()
      if (process.platform !== 'win32') await handle.chmod(0o600)
    } finally {
      await handle.close()
    }
    return key
  } catch (error) {
    if (error.code === 'EEXIST') return readPrivateKeyFile(path)
    throw error
  }
}

export async function startRelayHost(input = {}) {
  const options = {
    ...input,
    listen: input.listen ?? DEFAULTS.listen,
    announce: input.announce ?? [],
    limits: { ...DEFAULT_LIMITS, ...(input.limits ?? {}) },
  }
  validateOptions(options)

  const privateKey = options.keyFile == null
    ? await generateKeyPair('Ed25519')
    : await loadOrCreatePrivateKey(options.keyFile)
  const limits = options.limits
  const libp2pConfig = {
    privateKey,
    addresses: {
      listen: options.listen,
      ...(options.announce.length > 0 ? { announce: options.announce } : {}),
    },
    transports: [tcp(), webSockets()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    connectionManager: {
      maxConnections: limits.maxConnections,
      maxIncomingPendingConnections: Math.min(limits.maxConnections, 100),
    },
    services: {
      identify: identify(),
      relay: circuitRelayServer({
        maxInboundHopStreams: limits.maxInboundHopStreams,
        maxOutboundHopStreams: limits.maxOutboundHopStreams,
        maxOutboundStopStreams: limits.maxOutboundStopStreams,
        reservations: {
          maxReservations: limits.maxReservations,
          reservationTtl: limits.reservationTtlMs,
          defaultDurationLimit: limits.maxRelayedDurationMs,
          defaultDataLimit: BigInt(limits.maxRelayedDataBytes),
        },
      }),
    },
  }

  const node = await createLibp2p(libp2pConfig)
  let stopped = false
  return {
    node,
    async stop() {
      if (stopped) return
      stopped = true
      await node.stop()
    },
  }
}

async function main() {
  let host
  let shuttingDown = false
  try {
    const options = optionsFromEnv()
    host = await startRelayHost(options)
    const id = host.node.peerId.toString()
    process.stdout.write(`OFFICE-X Circuit Relay v2 host started: ${id}\n`)
    for (const address of host.node.getMultiaddrs()) process.stdout.write(`  ${address.toString()}\n`)
    if (!options.keyFile) process.stderr.write('OFFICE-X relay identity is ephemeral; set OFFICEX_RELAY_KEY_FILE to persist it securely.\n')

    const shutdown = async (signal) => {
      if (shuttingDown) return
      shuttingDown = true
      process.stderr.write(`OFFICE-X relay: received ${signal}; stopping\n`)
      await host.stop()
    }
    process.on('SIGINT', () => { void shutdown('SIGINT') })
    process.on('SIGTERM', () => { void shutdown('SIGTERM') })
  } catch (error) {
    process.stderr.write(`OFFICE-X relay failed to start: ${error.message}\n`)
    process.exitCode = 1
    await host?.stop().catch(() => {})
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main()
}

export { DEFAULTS, optionsFromEnv, loadOrCreatePrivateKey }
