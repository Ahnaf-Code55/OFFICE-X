# Block Graph handoff

Updated: 2026-10-13. Local branch: `trahman/block-communication-graph`, based on the pending Teams implementation.

Graph now uses the approved top-down blocks: separate blue Ahnaf and green Turjo sections, orchestrators above six manager columns, and worker lists beneath each manager. Shared specialists reuse the same employee key and appear under each assigned manager. Current saved job labels, models, goals and permissions are preserved.

## Behavior

- Side and name/role filters retain reporting paths. Normal view has a scrollable chart at readable size; Expand graph uses the existing focus mode. Fit view and zoom expose both sections.
- Status comes directly from the local roster or bounded shared presence. Disconnected chart positions say Not connected; no preview activity is injected into the running office.
- Communication uses the latest 200 existing hive log entries with time filters. Requests and replies have separate directional edges, timestamps and one receiver arrowhead. Successful broadcasts expand to recipients; failed deliveries do not create edges. Human requests retain the Human destination despite the god delivery proxy.
- Click a block or route to select details. Open chat / Memory act only on real local agents. Remote and planned positions cannot target a local PTY.
- Previews read the existing redacted hiveMessages endpoint. Raw log subjects/bodies are never rendered. Shared presence does not provide remote communication history or models.
- Existing shared-memory topics remain available as an optional topic list.

## Scope

`MemoryGraphPanel.tsx` is the data adapter. `memoryGraph/BlockGraphView.tsx`, `blockGraph.css`, `blockLayout.ts` and `communication.ts` own the graph rendering and projections. `CommandCenterPanel.tsx` wires explicit chat, memory and focus navigation. No office-floor, scene, provider, profile or dependency files changed.

## Verification

Typecheck, production build and focused tests passed. Desktop acceptance passed 23 checks: hierarchy, both themes, actual recorded traffic, single receiver arrows, clickable labels, search, shared-worker aliases, chat navigation, narrow layout, focus mode and message previews. An isolated presentational fixture verified active statuses and reciprocal request/question routes, including remote/local ID collisions. Verification sent no tasks or agent messages and preserved all 14 employees' models, goals and manager assignments. The fixture is saved with project-local review evidence, outside the application source.

## Next step

Review the local Graph tab and the dark/light screenshots. Use All recorded to inspect the existing communication history when the current 15-minute window is quiet. Real cross-device Ahnaf communication is not supplied by presence and was not verified. Publish only after the owner's next instruction; include the pending Teams dependency and keep Ahnaf's floor changes separate.
