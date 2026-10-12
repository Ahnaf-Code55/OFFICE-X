# OFFICE-X handoff

Updated: 2026-10-12

## Goal and scope
OQVIAN OFFICE-X with shared offices and owner-controlled permissions, Linux and Windows.
Current branch: `trahman/agent-workspace-ui`, based on main `1f6da34c`.
Turjo approved the dark/light agent-workspace mockup; implementation is local for review.
The existing office floor, scene code and artwork are unchanged.
Merge preview against ahnaf/office-3d is clean; shared handoff claims are kept separate.

## Agent workspace
- Floor stays left; a shared agent sidebar and conversation workspace sit right.
- Every selected agent opens its own identity, model, composer and session views.
- Sidebar retains tasks, approvals, monitor, memory, skills, activity and office tools.
- More tools retains Git, message threads, traces, lifecycle controls and roster arrangement.
- Composer retains attachments, drafts, queue delivery and steering; model editing uses the existing restart semantics.
- Compact agent dock replaces the floor-wide strip; team restoration still runs without a selected agent.
- Dark/light controls update both the workspace and existing terminal theme.
- New chat queues the engine's reset command after confirmation; native trust is never auto-approved.

## Earlier response fixes retained
Coordinator routing and one-owner delegation prompts, manual Codex approval defaults,
native permission guards, safe startup queues and mounted-filesystem socket fallback.
The earlier fix commit is retained as `a754d26c` on this branch.

## Verification
Typecheck and production build passed; 972 tests: 970 passed, two skipped; whitespace check passed.
Live UI: all seven agents, draft preservation, 18 navigation views, model editor and both themes checked.
Responsive checks passed at 1280, 1024 and 900 pixels; no renderer exceptions during acceptance checks.
Screenshots and verification records: `../ui-review`; personal profile and logs: `../Turjo-Office`.
Live replies/delegation await human CLI trust approval. Antigravity output uses Terminal;
structured conversation rendering retains the existing Claude/Codex transcript support.

## GitHub review
Turjo approved publication to GitHub. This branch targets main for Ahnaf review.
Merge requires green CI and Ahnaf approval; never push main directly.
Two-computer calls and shared-office acceptance gaps remain outside this change.
