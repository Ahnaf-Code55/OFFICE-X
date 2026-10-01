# OFFICE-X handoff

Updated: 2026-10-01

## Goal
Ship an OQVIAN branded OFFICE-X with a shared office where two people can bring and control their own AI agents, with reciprocal trust and owner controlled permissions.

## Current checkout
- Source repo: `officex/shared-offices` (see `git log -1`).
- OQVIAN delivery PR: [Ahnaf-Code55/OQVIAN#1](https://github.com/Ahnaf-Code55/OQVIAN/pull/1), open and unmerged at `69b1e56`.
- Preserve both OQVIAN and OFFICE-X branding. Linux and Windows x64 are in scope; macOS is not.

## Implemented
- Virtual office from Munder Difflin, OQVIAN roles and working modes, plus Shared Office with reciprocal invites, pinned fingerprints, encrypted libp2p messages, separate teammate sections, and revocable access.
- Access levels support task requests, delegated agent prompts, and full control with opt-in terminal output sharing.
- Direct P2P and self-hosted Circuit Relay v2 are implemented; no permanent managed relay endpoint is configured.
- Codex remote launch now moves `--add-dir` roots to app-server config; local commit `0c1b5b89`, PR commit `69b1e56`.

## Verified
- Codex remote regression tests (7), typecheck, focused suite (919), and local Linux AppImage build passed during the prior fix.
- PR #1 Linux verification, Linux AppImage, and Windows x64 installer jobs passed at `69b1e56`.
- A temporary relay previously passed an external circuit probe, but no real two-computer acceptance has been completed.

## Open findings
- Keyring fixed 2026-09-27: gnome-keyring installed, `org.freedesktop.secrets` store/lookup verified. App-level identity creation still unchecked.
- Temp relay up 2026-09-27 (Node 26, persistent key `~/.local/share/officex-relay/relay.key`) behind a Cloudflare quick tunnel; external libp2p WSS dial passed. Address (dies when tunnel restarts): `/dns4/reducing-caribbean-posters-murray.trycloudflare.com/tcp/443/wss/p2p/12D3KooWSzm9JMyup878piqT7dKeRSqoxpTgU3e7c2YzD9uzcVMY`. Needs a VPS/named tunnel for permanence; relay officially wants Node 22.
- Two-computer invitation, control, output sharing, and revocation acceptance with the friend's Bazzite device remain unverified.

- 2026-10-01: remote `chat` from task-requests teammates no longer reaches local agents (`src/main/chat.ts`, `index.ts`; test in `test/team-chat.test.cjs`); voice download progress no longer double-emits (`voice/assets.ts`); stale `opencode-go/deepseek-flash` removed from `docs/model-catalog.json`. Focused suite 933/936: `proc-kill` fails only in containers without a zombie-reaping PID 1.
- Still missing from PLAN.md: human-to-human WebRTC (`rtc-signal`), image attach in MeetingRoom, per-AI voices, Phase 5 review notes.

## NEXT TASK
Enter the relay address in Shared Office → Self-hosted on both devices, then run reciprocal invite and cross-device control acceptance with the Bazzite teammate and fix any observed failure.

## Handoff practice
Read this note and `git log -5`, inspect only files needed for the task, and update this note with changed files, verification, open issues, and the exact next step before handing off; keep it under 40 lines and commit working steps.
