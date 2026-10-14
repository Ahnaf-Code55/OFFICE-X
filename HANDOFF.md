# OFFICE-X handoff

Updated: 2026-10-13

## Goal
Ship an OQVIAN branded OFFICE-X with a shared office where two people can bring and control their own AI agents, with reciprocal trust and owner controlled permissions.

## Current checkout
- Source repo: `officex/shared-offices` (see `git log -1`).
- OQVIAN delivery PR: [Ahnaf-Code55/OQVIAN#1](https://github.com/Ahnaf-Code55/OQVIAN/pull/1), open and unmerged at `69b1e56`.
- Preserve both OQVIAN and OFFICE-X branding. Linux and Windows x64 are in scope; macOS is not.

## Who owns what (claim before editing; see CONTRIBUTING "Working as a pair")
- Ahnaf (@Ahnaf-Code55): TBD
- Turjo (@TRahman2414): agent response/startup fixes and right agent workspace; floor/scene files belong to Ahnaf. Details: [agent workspace handoff](docs/AGENT-WORKSPACE.md).

## Implemented
- 2026-10-15 `trahman/agent-role-sections`: Turjo owns approved Orchestrators/Managers/Employees tabs and aligned reporting columns in the right agent workspace; floor/scene files excluded.
- 2026-10-15 `trahman/preserve-manager-groups`: Turjo owns the right agent drawer fix. All agents and search preserve manager/worker groups; no floor/scene changes. See [agent teams handoff](docs/AGENT-TEAMS.md).
- 2026-10-14 `trahman/office-discussion-rooms`: team chat/meeting membership and quiet, bounded discussion routing claimed by Turjo. Scope and steps: [office discussions](docs/OFFICE-DISCUSSIONS.md). Floor/scene files remain outside this work.
- 2026-10-13 local `trahman/block-communication-graph`: approved block hierarchy, live roster status, separate directed message routes and redacted previews. See [Graph handoff](docs/BLOCK-GRAPH.md). Depends on the pending Teams branch; floor and scene files remain unchanged.
- 2026-10-13 local feature branch `trahman/agent-team-dock`: hierarchical Teams drawer for both sides, durable worker labels/assignments, OpenCode goal delivery and stale development roster-write protection. See [agent teams handoff](docs/AGENT-TEAMS.md) for scope, validation and next step. Personal hires are local; floor/scene files are unchanged.
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
- 2026-10-01: human-to-human calls: `rtc-signal` action (`teamProtocol.ts`, `teamActions.ts` parseRtcSignal, `teamDispatch.ts`), IPC `meeting:sendRtcSignal`/`meeting:rtcSignal`, renderer `meeting/useTeammateCall.ts` + call/accept buttons in `MeetingRoom.tsx`; tests `test/rtc-signal.test.cjs`. STUN only (no TURN), rings only while the meeting room is open; never tried with real audio.
- 2026-10-01 usage fix: team chat no longer fans out (un-mentioned human msg → god only, @mentions → named only, agent posts → mentioned only, MAX_AI_TURNS 6); worker rule 1b "post plan to chat first" removed; god told to use the fewest agents. Defaults: Ponytail + new Caveman skill (`resources/skills/caveman`) always on via injected prompt rule 1e; auto-compact at 150k (`src/shared/autoCompact.ts`: Claude env pct, Codex `-c`, app trigger absolute floor). Headroom MCP was already default-on for Claude (needs `pip install "headroom-ai[mcp]"`).
- 2026-10-01: OpenCode agents showed a blank terminal: the app ran `opencode mini …`, but `mini` is a FLAG in OpenCode 1.18.x (`opencode mini` = chdir into ./mini → exit). Now `opencode --mini …`; saved argv repaired by `withOpenCodeMiniArgs` (`agentProvider.ts`). Verified the real 1.18.34 CLI starts the mini TUI with --model/--prompt.
- 2026-10-01: Slack prompt planner (ChatGPT group chats were removed): Settings → Slack → "Prompt planner" picks an agent (meant: Codex signed in with ChatGPT); Slack messages then go to it with `buildPlannerProtocol` (`src/main/slackPlanner.ts`): knows the sender (`ev.user` → `users.info`, optional `users:read` scope), writes a prompt for that person only, keeps `<hive>/prompt-board.md` so two people's branches/files don't clash, replies in-thread. Untested against real Slack.
- 2026-10-01: orchestrator spawning throttled (`src/shared/workerSpawnPolicy.ts`): max 3 workers at once (config clamped, default 3), queued spawn-requests start ONE per tick ≥60 s apart; god prompt + PROTOCOL say so.
- 2026-10-12: OQVIAN look (neutral carpet via `warmNeutral()` in `OfficeFloor.tsx`, 15 unique cast recipes in `portraitArt.ts`) and optional 3D office (`scene/office3d/`, three.js, 2D/3D button; 2D scene stays the simulation). PR #3. Linux dev launch: `npm run dev -- -- --ozone-platform=x11` (native Wayland shows no window; GPU process crashes without x11). Not drawn in 3D yet: Shared Office teammates.
- Still missing from PLAN.md: image attach in MeetingRoom, per-AI voices, Phase 5 review notes.

## NEXT TASK
Run a real two-computer call in the meeting room (accept, mute, hang up). Enter the relay address in Shared Office → Self-hosted on both devices, then run reciprocal invite and cross-device control acceptance with the Bazzite teammate and fix any observed failure.

## Handoff practice
Read this note and `git log -5`, inspect only files needed for the task, and update this note with changed files, verification, open issues, and the exact next step before handing off; keep it under 40 lines and commit working steps.
