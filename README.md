# OFFICE-X

**OFFICE-X** is an OQVIAN project: a desktop office for working with AI agents.
This repository starts from the local office application in
[Munder Difflin](https://github.com/chaitanyagiri/munder-difflin), extended with
Shared Office so real teammates and their agents can work together.

## Project status

The existing local office experience is retained from the upstream project.
OFFICE-X shared offices provide fingerprint-pinned presence and encrypted peer
messages over authenticated libp2p Noise/Yamux connections. Teammates can send
task requests, which appear in the owner's approval history; delegated access
can steer an existing local agent; full-control access can send terminal input
and receive explicitly shared terminal output. Output sharing is off by default
and enabled per teammate and local agent. Each recipient enforces the access
level stored on its own device. Presence stays bounded and separate from local
agent and PTY state. Each trusted peer is limited to 30 presence updates and
256 KiB per minute to keep repeated updates from flooding the interface.
Connections can use direct peer-to-peer routes or a Circuit Relay v2 host,
including the self-hostable relay in [`relay/`](./relay/). OQVIAN's managed relay
endpoint is not configured in this repository, so managed-relay mode is not
available by default.

## Connect two teammates

Shared Office trust is reciprocal. Each person must import and pin the other
person's device invite; one invite only authorizes one direction.

1. On both devices, open **Shared Office** and enable the connection. Choose a
   connection mode and confirm both devices can reach the selected relay or
   direct peer route.
2. On the first device, create an invite and send it to the teammate through a
   channel where you can compare fingerprints separately.
3. On the second device, paste the invite, preview it, compare the displayed
   fingerprint with the first person's fingerprint over that separate
   channel, then confirm it. Choose the access level this teammate receives on
   the second device.
4. On the second device, create its invite and send it back. The first person
   imports it, compares the fingerprint the same way, and chooses the access
   level this teammate receives on the first device.
5. Once each device lists the other as a trusted teammate and both transports
   are running, presence and agent cards appear in the shared office. Send a
   task request to check the route; it appears in **Triggers → History** on the
   receiving device for owner approval.

Each access selector controls what that teammate may do to agents on the
device where the selector appears. It does not grant the same permission on the
other person's device. Both owners choose their own inbound access level.

## Run from source

Prerequisites: Node.js 22.22 or newer, npm, and the native build tools required by
Electron dependencies such as `node-pty`.

```bash
npm install
npm run dev
```

Useful development commands:

```bash
npm run typecheck
npm run test:focused
npm run build
npm run relay:test
```

Run the self-hostable Circuit Relay v2 host with `npm run relay:start`. Configure
`OFFICEX_RELAY_LISTEN_MULTIADDRS`, `OFFICEX_RELAY_ANNOUNCE_MULTIADDRS`, and an
optional `OFFICEX_RELAY_KEY_FILE`; see [`relay/README.md`](./relay/README.md)
for deployment, TLS proxy, identity, and resource-limit details. In the app's
Shared Office settings, choose **Self-hosted** and enter the relay multiaddr,
including its Peer ID (for example,
`/dns4/relay.example.com/tcp/443/wss/p2p/12D3KooW...`). Both teammates need to
use that relay. The relay address is configured locally and is not copied into
an invitation. Direct peer-to-peer invites may contain a literal public IP
route; private IPs and DNS-based invite routes are rejected. To make a direct
route reachable, select **Peer to peer**, enter `/ip4/<your-public-ip>/tcp/4111`
in **Public peer-to-peer endpoint**, then forward that TCP port through the
router and host firewall to this computer. OFFICE-X binds the selected port and
adds the device Peer ID to invitations. Automatic NAT traversal is not
configured, so direct mode needs a reachable public endpoint; otherwise use
the managed or self-hosted relay.

The relay forwards encrypted libp2p connections but does not establish office
membership or grant permissions. A peer is accepted only when its authenticated
Peer ID matches an invitation whose fingerprint was confirmed and pinned in
that office. Presence carries teammate and agent display names, characters, and
status only. Action messages are end-to-end encrypted, signed, bounded, and
replay-protected. Approve task requests in Triggers → History. Agent prompts
target only active agents on the receiving device. Terminal input and terminal
output streams require full-control access on both devices. Output sharing is
off by default and must be enabled by the agent owner for each teammate and
local agent; streamed text is encrypted in transit, held only in memory, and is
not written to trigger history. The remote xterm view starts when sharing begins
and batches output every 250 ms. Each peer can receive up to 20 terminal frames
per second and 8 MiB per minute across at most four shared terminals; ordinary
team messages retain a separate 30-per-minute budget. Very chatty or unusually
large output may exceed the byte cap and appear with a gap marker. Managed relay
requires an OQVIAN endpoint to be configured by the deployment. Official builds
can embed the public relay multiaddr, including its Peer ID, with the
`OFFICE_X_MANAGED_RELAY_MULTIADDR` GitHub repository variable. This source tree
does not set that variable because no live OQVIAN relay endpoint is configured;
users can enter an endpoint in Shared Office settings when one is available.

The application can start without an agent CLI configured. To use an agent,
install and configure a supported CLI in the application first.

## Project documentation

- [Architecture](./docs/ARCHITECTURE.md)
- [Local agent coordination](./HIVE.md)
- [Terminal and event plane specification](./SPEC.md)
- [Design system](./DESIGN.md)
- [Security policy](./SECURITY.md)
- [Contributing](./CONTRIBUTING.md)

The local hive documentation describes the inherited multi-agent layer.
Shared Office transport and trust behavior is documented above and in the
architecture guide; inherited product design assumptions in `SPEC.md` are
clearly marked as historical.

## Attribution and licenses

OFFICE-X is based on the MIT-licensed
[Munder Difflin project by Chaitanya Giri](https://github.com/chaitanyagiri/munder-difflin).
The upstream copyright and license notice is retained in [`LICENSE`](./LICENSE).

The inherited app includes **Modern Interiors - RPG Tileset [16X16]** by
[LimeZu](https://limezu.itch.io/moderninteriors). The upstream project lists
that art under a separate Complete Version license, which requires visible
credit. Its license is separate from the source code; verify that your use and
any redistribution are covered before distributing builds. See
[`LICENSE-ASSETS`](./LICENSE-ASSETS) and the
[asset attribution notice](./src/renderer/src/assets/ATTRIBUTION.md) for details.

Other libraries and assets retain their respective licenses and notices.
