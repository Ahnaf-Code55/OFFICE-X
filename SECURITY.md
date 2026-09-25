# Security Policy

OFFICE-X runs agent CLIs and tools on the user's machine. The optional shared
office feature also opens libp2p connections for presence and end-to-end
encrypted teammate messages. A self-hosted Circuit Relay v2 host forwards
encrypted connections; it does not authenticate office membership or grant
permissions. See [the shared-office architecture](./docs/ARCHITECTURE.md) and
[relay deployment notes](./relay/README.md).

## Security boundaries

- Renderer code has no direct Node.js access. Privileged operations pass through
  narrow `contextBridge` APIs and are validated in the main process.
- Shared-office peers must be explicitly pinned by public-key fingerprint.
  Transport Peer IDs, message signatures, office IDs and replay protection are
  checked before actions are dispatched.
- The receiving device enforces its locally stored access level for every
  teammate action. Terminal output sharing requires explicit per-member and
  per-agent opt-in, and is disabled when access is downgraded or revoked.
- Terminal output can contain credentials or other private data. It is encrypted
  in transit, kept in memory for live delivery, and is not added to trigger
  history.
- A relay is a network exposure. Bind and publish only the addresses intended
  for your deployment, persist its identity key with restrictive permissions,
  terminate public WebSocket TLS at a correctly configured proxy, and enforce
  host-level network controls.

These controls do not replace review of the operating system, agent CLI,
integrations, relay host, or the prompts and files agents can access.

## Reporting a vulnerability

Please do not post credentials, private keys, invite payloads, or an unpatched
vulnerability in a public issue. Contact the OQVIAN project maintainers through
your organization's private security channel and include reproduction steps,
affected versions, and impact. Do not send live secrets with the report.

## Supported versions

Until OQVIAN publishes a release policy, security fixes are developed against
the current OFFICE-X source branch. Treat locally built or unreleased versions
as unsupported for production use.
