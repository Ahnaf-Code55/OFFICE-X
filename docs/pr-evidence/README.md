# PR evidence — screenshots

Before/after screenshots for pull request evidence, served to the PR body via
`raw.githubusercontent.com` (the API cannot produce GitHub's drag-and-drop
`user-attachments` URLs, so the raw CDN is the only scriptable path).

- `before-en.png` — the UI in English before the change.
- `after-zh.png` — the same screen with 简体中文 selected in Settings → General.
- `before-task-id.png` / `after-task-id.png` — the Tasks kanban DOING column
  without and with the task id on each card (#352). Rendered off the real
  `TaskCard` component with the real design tokens and bundled fonts, at one
  window size against one fixed set of cards, so the pair differs only by the
  change itself.
- `before-task-id-detail.png` / `after-task-id-detail.png` — the task DETAIL view
  without and with the id in its fact row (#352). Same approach: the real
  `TaskDetail`, real tokens and fonts, real English strings, one fixed task.
- `meeting-call-before.png` / `meeting-call-after.png` — the meeting room
  without and with human-to-human voice calls (WebRTC over `rtc-signal`).
  Rendered off the real `MeetingRoom` (the 226e796 file for before, the current
  one with `useTeammateCall` for after), joined past its join screen, with the
  real design tokens and bundled fonts at one 900×560 window. Both shots get the
  same fixed chat log, the same two AI seats (Pam, Dwight), the same mocked
  presence (teammates Sam and Riley online) and the same incoming offer from Sam;
  only `window.cth`, the store's agent list and a silent microphone are mocked.
  Before, presence and the offer are ignored (Sam is just a chat seat); after,
  the "Sam is calling you" accept/decline bar shows and Riley's seat carries a
  call button (disabled while a call is ringing).
- `chat-gate-before.png` / `chat-gate-after.png` — the chat gate test as real
  terminal output, rendered as monospace text at one window size. Before:
  `node --test test/team-chat.test.cjs` with `src/main/chat.ts` swapped to its
  226e796~1 version, failing "task-request teammates reach the owner but never
  prompt local agents". After: the same command on the current tree plus
  `node --test test/rtc-signal.test.cjs`, all passing.
