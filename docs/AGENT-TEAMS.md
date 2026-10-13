# Agent Teams handoff

Updated: 2026-10-13. Publish branch: `trahman/office-teams-block-graph`.

The flat buttons in the right agent workspace are replaced by a Teams drawer and a deduplicated All agents view. Side filters cover Turjo, Ahnaf and other employees. Search preserves reporting paths; manager chevrons reveal workers. Each local row shows its role, work area, model and current status. Selecting it opens the existing workspace.

Local organization metadata persists with the roster: side, role, manager IDs and tags. A shared specialist is one agent with several managers. The details view shows the saved goal and allows team assignment edits without changing its CLI or permissions. Unknown and invalid assignments remain visible.

Ahnaf's connected agents use the existing bounded shared-presence projection. Remote IDs are namespaced, and remote rows remain read-only. Remote models and goals are not supplied by that projection. Disconnected chart positions are labeled Not connected; no remote workers are hired locally.

## Scope

- `AgentWorkspaceFrame.tsx`, `AgentTeamDock.tsx`, `agentTeamDock.css`: right workspace only, dark/light themes, responsive drawer, keyboard dismissal.
- `agentTeams.ts`, `store.ts`: hierarchy, search and durable organization metadata.
- `standingGoal.ts`, `useHive.ts`: OpenCode's lifecycle-only plugin does not inject goals; queued deliveries now carry the current saved goal.
- `rosterWriter.ts`, `store.ts`: a superseded development store cannot flush an older snapshot over newly hired workers. Hot disposal flushes the current writer and removes its unload listener.
- Focused regression coverage in `agent-teams`, `standing-goal` and `roster-writer` tests.
- No office-floor or scene files changed. Personal hire manifests, goals and profile remain outside the shared repository. Review screenshots contain only the relevant UI.

## Validation

Typecheck and production build passed. Focused suite: 990 tests, 988 passed, 2 existing skips. Desktop acceptance passed 19 checks, including both themes, narrow layout, shared-specialist paths, selection and bounded remote-presence fixtures. All seven newly hired OpenCode Go workers returned their READY acknowledgment. Core also identified Forge and backend work through normal automatic goal delivery. All 14 employees, models, goals, tags and manager links survived a renderer reload.

## Next step

The owner approved publishing the Teams and Graph UI for review. Real Ahnaf-device presence and two-computer acceptance still need a connected Shared Office; fixture checks do not prove that connection. Keep Ahnaf's floor/scene changes separate. The earlier Codex folder-trust fix is published in a separate PR.
