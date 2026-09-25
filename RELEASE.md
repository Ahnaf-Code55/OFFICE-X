# OFFICE-X v0.4.6

**A pixel-office for AI agents, with a Shared Office for real teammates.**

OFFICE-X is an OQVIAN project based on the MIT-licensed Munder Difflin application by Chaitanya Giri. The OFFICE-X app logo remains in the product; OQVIAN is presented separately as the company brand.

## What's new

- **Shared Office presence.** Invite teammates by device, compare fingerprints through a separate trusted channel, and pin each other's identities.
- **Owner-controlled access.** Each device independently grants task requests, delegated agent prompts, or full terminal control. Task requests appear in the local approval history.
- **Opt-in terminal sharing.** Full-control peers can receive terminal output only after the owner enables sharing for that teammate and agent. Output is streamed in memory and is not written to trigger history.
- **Three connection choices.** Use direct peer-to-peer routes, an OQVIAN managed relay when configured by deployment, or a self-hosted Circuit Relay v2 host.
- **Local office retained.** The existing multi-agent floor, local agent controls, and local terminal workflows remain part of the app.

## Connection availability

Managed relay mode requires the OQVIAN relay address to be configured by deployment; this repository does not include a live managed relay endpoint. An official release can embed its public multiaddr (including Peer ID) through the `OFFICE_X_MANAGED_RELAY_MULTIADDR` repository variable. A saved device address takes precedence. Direct peer-to-peer mode requires a reachable public TCP route. The self-hosted relay is available in `relay/` with setup instructions in `relay/README.md`.

## Downloads

Installers and checksums are attached to the GitHub Release that carries this file. Build from source with Node.js 22.22 or newer using `npm install` and `npm run dev`.

## Attribution

OFFICE-X is based on the MIT-licensed [Munder Difflin project by Chaitanya Giri](https://github.com/chaitanyagiri/munder-difflin). Upstream licensing and contributor attribution are retained in this repository.
