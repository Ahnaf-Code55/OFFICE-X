# OFFICE-X Circuit Relay v2 host

This is a standalone libp2p Circuit Relay v2 host. It forwards libp2p circuit traffic at the protocol layer; it does not understand OFFICE-X offices, identities, encrypted envelopes, tasks, or actions. Application peers remain responsible for their own authentication, office membership, signatures, and authorization.

The implementation follows the current [js-libp2p Circuit Relay example](https://github.com/libp2p/js-libp2p-example-circuit-relay) and [js-libp2p configuration guide](https://github.com/libp2p/js-libp2p/blob/main/doc/CONFIGURATION.md). It starts native TCP and WebSocket transports, Noise encryption, Yamux multiplexing, Identify, and the Circuit Relay v2 server service.

## Run

From the repository root:

```sh
npm run relay:start
```

### Deploy with Docker Compose

The standalone image runs as an unprivileged user, persists the relay identity
in a named volume, and applies container memory, CPU, process, and Linux
capability limits. On a server with Docker Compose:

```sh
cd relay
cp .env.example .env
# Edit .env and replace relay.example.com with the public DNS name.
docker compose build
docker compose up -d
docker compose logs -f office-x-relay
```

The first startup prints the relay Peer ID. Keep it stable by retaining the
`relay-data` volume. Port 4001 is exposed for native TCP clients; WebSocket
port 4002 is bound to localhost and should be reached through a TLS proxy.
For example, a Caddy host can use:

```caddyfile
relay.example.com {
    reverse_proxy 127.0.0.1:4002
}
```

In each OFFICE-X installation choose **Shared Office → Self-hosted** and enter
the public WSS address with the Peer ID from the relay log:
`/dns4/relay.example.com/tcp/443/wss/p2p/<PeerID>`. For direct TCP access use
`/dns4/relay.example.com/tcp/4001/p2p/<PeerID>` instead. Both teammates must
configure the same relay. Keep the data volume and back it up securely; its
identity key is not encrypted at rest. Rotate the key only if you are prepared
to update the relay address on every client.

Compose reports `healthy` when the local TCP listener accepts a connection.
This is only a process/listener check: it does not verify external DNS, firewall
rules, WSS certificates, the TLS proxy, relay reservations, or relayed peer
traffic. Use a separate external probe and an actual client-to-client relay
check before relying on a deployment. `docker compose ps` and `docker compose
logs` show local container health and startup addresses.

Default listeners are `/ip4/0.0.0.0/tcp/4001` and `/ip4/0.0.0.0/tcp/4002/ws`. The host prints its Peer ID and listening multiaddrs, then shuts down on `SIGINT` or `SIGTERM`.

Set these environment variables to configure the host:

| Variable | Default | Meaning |
| --- | --- | --- |
| `OFFICEX_RELAY_LISTEN_MULTIADDRS` | `/ip4/0.0.0.0/tcp/4001,/ip4/0.0.0.0/tcp/4002/ws` | Comma-separated libp2p listener multiaddrs |
| `OFFICEX_RELAY_ANNOUNCE_MULTIADDRS` | empty | Comma-separated public multiaddrs advertised to peers; useful behind a proxy |
| `OFFICEX_RELAY_KEY_FILE` | unset | Optional path for a persistent libp2p host identity |
| `OFFICEX_RELAY_MAX_CONNECTIONS` | `250` | Connection manager pruning threshold |
| `OFFICEX_RELAY_MAX_INBOUND_HOP_STREAMS` | `128` | Concurrent inbound Circuit Relay HOP streams |
| `OFFICEX_RELAY_MAX_OUTBOUND_HOP_STREAMS` | `128` | Concurrent outbound Circuit Relay HOP streams |
| `OFFICEX_RELAY_MAX_OUTBOUND_STOP_STREAMS` | `128` | Concurrent outbound STOP streams |
| `OFFICEX_RELAY_MAX_RESERVATIONS` | `1000` | Simultaneous relay reservations |
| `OFFICEX_RELAY_RESERVATION_TTL_MS` | `7200000` | Reservation lifetime |
| `OFFICEX_RELAY_MAX_DURATION_MS` | `1800000` | Maximum duration of a relayed connection |
| `OFFICEX_RELAY_MAX_DATA_BYTES` | `67108864` | Maximum data per relayed connection |

All numeric settings must be positive integers within the validation bounds in `server.mjs`.

## Identity storage

When `OFFICEX_RELAY_KEY_FILE` is set, the host creates an Ed25519 private key file with mode `0600` and reuses that key on subsequent starts. It rejects symlinks, non-regular files, overly broad POSIX permissions, and invalid key data; it does not silently replace a bad key. The key file is protobuf-encoded and is **not encrypted at rest**, so protect the containing volume and its backups.

When no key file is configured, the host creates an ephemeral identity and warns that the Peer ID will change after restart. No private key material is written to logs.

## Public WSS deployment

The built-in WebSocket listener is plain WS. Public browser peers need secure WSS, so terminate TLS at a reverse proxy such as nginx or Caddy and proxy WebSocket upgrades to the configured `/ws` listener. Set `OFFICEX_RELAY_ANNOUNCE_MULTIADDRS` to the externally reachable WSS address, for example `/dns4/relay.example.com/tcp/443/wss`. Configure the proxy and firewall to pass WebSocket upgrades and allow the TCP listener if native TCP peers need it. A proxy announcement does not itself configure certificates or open firewall ports.

## Tests

```sh
npm run relay:test
```

The smoke tests start a loopback relay, dial both transport listeners with Noise/Yamux, make an actual Circuit Relay v2 reservation and peer-to-peer relayed connection, verify stable Peer ID when a key file is configured, and validate environment parsing and permission bounds.

## Scope and limits

The default relay service limits reservations, HOP/STOP streams, relay duration, relayed bytes, and connection-manager pruning. These are capacity limits, not office-level access controls. Circuit Relay v2 does not create shared-office room semantics or authenticate OFFICE-X membership. Do not expose this host as an OFFICE-X authorization service, and do not treat reaching this relay as proof that a peer is trusted.
