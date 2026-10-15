# Agent role sections

Approved design: three separate bottom tabs — Orchestrators, Managers, Employees — replacing the Teams / All agents controls in the right agent workspace.

Each tab opens its own list with aligned name/work area/model, Reports to, and live status columns. Shared workers appear once with all their managers as chips. Side filters support Turjo, Ahnaf, both sides and other agents. Search is scoped to the selected role and includes reporting names, work tags, model and employee name. Counts reflect actual local/saved/connected identities; unfilled company chart positions do not inflate them.

Selected local agents open the existing workspace. The breadcrumb names the selected agent and their manager(s). Role and side preferences survive selection/remounts; old Teams/All agents preferences migrate automatically to Employees while retaining drawer visibility and side. Assignment editing, goals, model settings and Restore remain available. Saved agents that are not started have an explicit status and cannot select a running terminal until restored. Shared remote rows are read-only, and models are labelled as unavailable in shared presence rather than guessed.

The shared projection recognizes advertised remote role ranks and ties renamed coordinators to their own peer's known office/chart. It never grants terminal permission, merges remote identities into local ones or rewrites saved assignments.

## Scope

- `AgentTeamDock.tsx`, `agentTeamDock.css`: approved role navigation and aligned responsive lists, existing dark/light workspace tokens.
- `agentRoleSections.ts`: preference migration, role/side/search projection and duplicate suppression.
- `agentTeams.ts`: renamed remote coordinator rank/cohort fallback only; existing local assignments and graph tree functions remain intact.
- `agent-role-sections.test.cjs`: role separation, multi-manager labels, search, counts, migration and read-only remote projection.
- No floor/scene, provider, model, goal or chat/meeting-routing changes.

## Validation — 2026-10-15

- Typecheck and production build passed.
- Full suite: 1,029 passed, two existing skips. Role/team subset: 17 passed.
- Live saved office: Orchestrators 1, Managers 6, Employees 7; no horizontal overflow in the 370px drawer, column positions aligned across rows.
- Lighthouse search returned Auditor and Patch in Employees. Selecting Patch preserved its role/side preferences, displayed one row and named Forge and Lighthouse in the breadcrumb. Core remained selectable and highlighted.
- Dark/light screenshots: project `ui-review/role-sections-implemented-dark.png` and `role-sections-implemented-light.png`.
- Remote UI fixture showed 1 orchestrator, 1 manager, 1 employee for Ahnaf; selecting the remote employee left the local selection unchanged and exposed only read-only details. Fixture was removed after the check. Actual two-device presence remains unverified.
- Profile comparison: all 14 live agents and one archived agent retained their identities, names, models, commands, providers, goals, descriptions and organization metadata.

Implemented locally on `trahman/agent-role-sections`, retaining the pending office-discussion feature and manager grouping fix. Publishing this revision requires an isolated PR against the appropriate base once requested; no GitHub push was performed for this design implementation.
