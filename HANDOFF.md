# OFFICE-X handoff

Updated: 2026-09-27 (Asia/Kuala_Lumpur)

## Goal
Ship an OQVIAN branded OFFICE-X with a shared office where two people can bring and control their own AI agents, with reciprocal trust and owner controlled permissions.

## Current checkout
- Source repo: `officex/shared-offices` at `0c1b5b89`; working tree was clean before this note.
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
- Live check on 2026-09-27: no relay or Cloudflare quick tunnel process is running; the old temporary relay hostname must be treated as stale.
- Live check on 2026-09-27: `pacman -Q gnome-keyring` reports it missing and `org.freedesktop.secrets` is absent, although the user's earlier terminal transcript showed a successful install. Reconcile this before creating a new invite; do not store the device identity in plaintext.
- Two-computer invitation, control, output sharing, and revocation acceptance with the friend's Bazzite device remain unverified.

## NEXT TASK
Restore an OS-backed keyring and reachable pinned relay, then run reciprocal invite and cross-device control acceptance with the Bazzite teammate and fix any observed failure.

## Handoff practice
Read this note and `git log -5`, inspect only files needed for the task, and update this note with changed files, verification, open issues, and the exact next step before handing off; keep it under 40 lines and commit working steps.
