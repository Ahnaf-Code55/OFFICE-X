# Office runtime fixes and review handoff

Branch: `trahman/office-operational-audit`, based on main `2237ea7b`.

This branch includes the pending office discussions, manager grouping and agent
role sections that the runtime fixes depend on. The grouping repair also appears
in PR #15; merging this complete branch makes that separate change redundant.
Review the complete PR rather than cherry-picking the audit commits onto a main
that does not yet contain their dependencies.

## Resulting behavior

- Orchestrators, Managers and Employees have separate aligned lists. Employees
  appear once with all reporting managers; local and connected teammate roles
  remain distinct. Existing assignments, models and goals are retained.
- Leadership, Managers and Everyone share bounded chat/meeting state. Rooms are
  quiet until a human requests a report or starts discussion. Joining is silent;
  each human request schedules at most three short sequential AI replies per
  office. Agent replies cannot start an AI reply loop.
- Automatic delivery waits for native permissions, feedback surveys, model-choice
  menus, quota errors and active Antigravity reasoning. It cannot press Enter to
  accept a model switch or permission. Initial terminal/PTY sizes now agree.
- Inbox work requests include a correlated outbox completion contract, and idle
  unread mail wakes through the guarded queue, including the orchestrator.
- Human answers and dismissals use a history guard so a stale Ask me view cannot
  overwrite a newly added question.
- Resume history belongs to its provider. Antigravity hooks use the current flat
  lifecycle schema and capture native conversations. Steering and changed goals
  reach its supported pre-invocation boundary without repeating unchanged goals.
  Codex accounting IDs cannot replace native conversation resume IDs.
- OpenCode reports actual tool arguments and session IDs once per process,
  preventing false repeated-tool circuit breakers. Missing arguments are not
  treated as evidence of identical repeated calls.
- The Antigravity picker reflects the installed CLI's Gemini 3.8 Flash and
  Claude 5.5 tiers. This catalog update does not reassign anyone's saved models.

## Validation

On Linux, `npm run typecheck`, `npm run test:focused`, `npm run build` and
`npm run check:links` passed. The final focused run passed 1,052 tests with two
existing optional voice-asset integration skips.

Live personal-office checks covered all 14 agents responding, seven employees
producing verified synthetic work, orchestrator/manager/worker delegation,
stale-question handling, native approval holds, dark/light role lists, bounded
reports and silent meeting joins. All 14 agents restored after a laptop reboot.
Restart & Continue retained an Antigravity native conversation and terminal
geometry. A real steering reply contained the requested marker. Codex native
thread IDs remained stable across multiple 30-second usage updates and existed
in their native indexes and rollout files.

Screenshots: [dark role sections](review/operational-audit/roles-dark.png),
[light role sections](review/operational-audit/roles-light.png), and the captured
[prior grouping bug](review/manager-groups/before.png).

## Applying the change

Review and merge the PR into main after its required checks pass. Then update
each checkout from main and rebuild/restart OFFICE-X normally. Both computers
need the discussion changes for shared room controls and ranked presence.

Floor/3D scene files, dependencies and lockfiles are unchanged. Personal profiles,
agent memories, hired-employee state, credentials and audit fixtures are not in
this PR. Turjo's Gemini/Codex assignments stay local; this update does not change
Ahnaf's office roster or provider permissions.

Real two-computer calls, microphone/hardware playback, Shared Office invitation
and control acceptance still require connected devices and configured services.
The local audit is not proof of those external paths. WhatsApp was unavailable
through the connected browser tools, so findings were reported in the Codex chat.
