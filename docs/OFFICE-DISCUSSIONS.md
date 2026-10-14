# Office discussions

Team chat and Meetings share three rooms, conversation history and activation state. Saved team roles determine membership:

- Leadership: humans and orchestrators.
- Managers: humans, orchestrators and managers.
- Everyone: humans and all employees.

Room participants show actual local sessions and saved employees; teammate humans and AIs come from Shared Office membership/presence. Disconnected people are labelled accordingly. Archived sessions are excluded. Models, goals, team assignments, terminal approvals and floor/3D scenes are preserved.

## Starting and stopping

Rooms start quiet on every app launch. Ordinary chat, direct mentions and joining a meeting do not invite an AI turn. Type a request such as `@Narrative please report your progress`, or use **Ask for report** with an optional topic in the composer. Report rounds do not leave the room active.

Type `Starting the meeting, everyone join`, or click **Start meeting**. Joining is silent. Subsequent human topics invite short relevant opinions. **End meeting** / `End the meeting` returns the room to quiet. A pending report has **Stop replies**. Cancellation removes only discussion queue items; ordinary work queues remain intact. An already submitted model turn may finish, but its late reply cannot reopen the round or schedule another turn.

Each human request invites at most three agents per office, sequentially. Everyone typically includes a relevant manager, a worker and a coordinator wrap-up. A direct address invites only the named eligible local agents. **Next voices** explicitly requests another round and rotates equally relevant voices. Agents' mentions never trigger extra model turns.

Invitees are prompted to give independent opinions, concrete flaws or uncertainty, honest work evidence and a better next step. They must ask the human when an action needs approval. Discussion is not permission to implement, hire, change files or spend money. Natural-language instructions guide model behaviour; they are not a substitute for the existing tool-permission controls.

## Token controls

- At most three invited AI turns per office per human request; no paid join acknowledgments or AI reply loops.
- Prompt topic capped at 1,600 characters, recent round context at 2,200 characters. Full human chat history is retained separately.
- Each reply requested at no more than 80 words / three short sentences; displayed/shared reply capped at 1,000 characters.
- Invitations expire after 180 seconds and require the current request identity, room and speaking slot at delivery and reply time. Stopped/replaced/expired invitations cannot submit later from a busy terminal queue.
- Voice and microphone start off. Voice input is transcribed only during an active meeting; channel changes and stopped meetings invalidate pending audio. Human calls retain the existing permission flow.

These controls bound scheduled turns and added chat context, not provider reasoning, existing session context or an exact billed token count. Terminal approval or an unavailable agent can expire a round; inspect that agent, then request a new round.

## Shared Office

Both computers must run this feature for outgoing room-control and ranked-presence metadata. Legacy incoming chat/presence remains readable. Existing teammate permissions still determine whether a remote human may prompt this office's agents. Remote AI replies never prompt local agents. Each office contributes up to three voices, so two connected offices may contribute up to six replies to one request.

## Validation (2026-10-14)

- Typecheck and production build passed.
- Full focused suite: 1,020 passed, two existing skips. Room/chat/presence subset: 33 passed.
- Real desktop membership: Leadership one local AI, Managers seven, Everyone fourteen; Meetings has the same counts plus the human. Opening/joining made zero microphone requests. Start/end made zero AI prompts.
- Live Codex manager Narrative returned a short factual report; live OpenCode worker Core independently challenged a flawed API proposal. Both completed the correlated round without extra scheduled turns.
- Dark/light screenshots and ordinary side-panel review captured under the project's `ui-review` folder.
- Saved roster comparison: fourteen live, zero restorable, one archived; agent identities, names, commands/models, providers, goals, descriptions and organization metadata unchanged.
- Two-office request sharing, role boundaries, cancellation, stale replies, impersonation-safe sender identity, peer permissions and queue expiry covered by automated checks. Actual cross-device and microphone/audio acceptance remains to be run with the two connected computers; local tests are not proof of those paths.
