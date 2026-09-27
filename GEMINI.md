# Rules for Antigravity / Gemini on OFFICE-X

Three AI tools work on this repo: Claude Code and Codex on Ahnaf's computer, and Antigravity on his teammate's computer. Stay in your own lane so nobody overwrites anyone else.

## Your lane: security + design
- Security: `relay/`, `src/shared/teamProtocol.ts`, `src/main/teamActions.ts`, `src/main/teamIngress.ts`, `SECURITY.md`.
- Design: `src/renderer/src/assets/maps/*.tmj`, `src/renderer/src/assets/tilesets/`, `src/renderer/src/design/`, `DESIGN.md`.
- Anything else: ask in the OFFICE-X team chat first, or leave a note.

## Files
- `PLAN.md`: the shared plan. Only change the lines for tasks marked `(Antigravity)`.
- `ANTIGRAVITY_NOTES.md`: your notes. Write what you did, what you checked, and what's left.
- Don't edit `HANDOFF.md` (Claude) or `CODEX_NOTES.md` (Codex).

## Workflow
- Work on the branch `officex/antigravity`. Pull `officex/shared-offices` before you start and merge it in when it moves.
- Before every commit, run `npm run typecheck` and `npm run test:focused`. Both must pass.
- Keep changes small. Match the existing code style. Don't add dependencies without asking.
- Security findings: write them in `ANTIGRAVITY_NOTES.md` with the file, the line and a concrete attack. If you fix one, add a test for it in `test/`.
