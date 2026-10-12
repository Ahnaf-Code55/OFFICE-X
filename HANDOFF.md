# OFFICE-X handoff

Updated: 2026-10-12

## Goal and scope
OQVIAN OFFICE-X with shared offices and owner-controlled permissions, Linux and Windows.
Turjo owns current response routing, delegation prompts and permission/startup fixes.
Current branch: `trahman/office-response-routing`, based on main `1f6da34c`.
Interface changes are deferred until Turjo reviews the local office.

## Local fixes
- Fresh chat defaults route human Leadership requests to the coordinator; explicit off overrides remain respected.
- Coordinator acknowledges, assigns one owner and reports results; no idle silence rule for human requests.
- Manual Codex launches use on-request approval and workspace-write, including main-only hires.
- Native trust/approval screens block automated Enter and expose a blocked state; typed permission hooks cover workers and coordinator.
- Queue startup prompts through the normal safe delivery path.
- Unsecurable Codex daemon sockets on the mounted filesystem immediately fall back to local TUI.
- Files: chat.ts, index.ts, codexRemoteHome.ts, useHive.ts, terminalPool.ts, terminalAutomation.ts, config.ts, agentProvider.ts, hookEvents.ts and regression tests.

## Verification
- Typecheck and build passed; Node suite 972 total, 970 passed, two skipped; diff whitespace check passed.
- Personal profile and evidence live in `../Turjo-Office`, outside the source checkout.
- Seven configured owners: coordination, Cloud, Security, Digital, business/docs, AI and Automate.
- Scheduled work and auto hiring are disabled; owner approval remains enabled.
- Live worker replies/delegation remain unverified while first-run folder trust awaits the human.
- Earlier automatic app exits need continued observation; no definitive closing root cause established.

## Existing acceptance gaps
Two-computer calls, reciprocal invites, remote control/output sharing and revocation remain unverified.
No permanent managed relay endpoint; previous temporary relay address may be stale.
Shared-office/call work and earlier PR history are unchanged by this local fix.

## Next step
Human approves folder trust, then test one direct worker reply and one Michael delegation.
Capture after evidence; await Turjo's interface instructions and explicit GitHub push instruction.
Before merge require green CI and Ahnaf approval; never push main directly.
