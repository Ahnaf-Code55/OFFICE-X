# OFFICE-X feature plan (2026-09-27)

Everything runs on subscriptions (Claude Code / Codex / Gemini CLI / Antigravity logins) or local models. No paid API keys.
Owners work in separate files so no two tools edit the same file. HANDOFF.md = Claude only; Codex notes go in CODEX_NOTES.md; Antigravity (teammate's computer) notes go in ANTIGRAVITY_NOTES.md and its rules are in GEMINI.md.

## Phase 1: Group chat (Claude)
- New protocol message kind `chat` in `src/shared/teamProtocol.ts` (signed + encrypted like other actions, size-limited, replay-protected).
- Ingress/authorization in `src/main/teamIngress.ts`; history in SQLite (`src/main/db.ts`).
- UI: `src/renderer/src/components/meeting/ChatPanel.tsx`: messages from me, teammate, and AIs; **+** to attach a screenshot/image.
- AIs in chat: each selected local agent receives the transcript as a prompt, and its reply is posted back. Round-robin turns with a max-turns cap so AIs can talk to each other without looping forever.

## Phase 2: Meeting room + voice (Claude, with Codex's engines)
- UI `src/renderer/src/components/meeting/MeetingRoom.tsx`: one orb per participant (glows while speaking), text box, +, mute, leave. Same room as the chat.
- Human-to-human voice: WebRTC audio, signalling over the Shared Office encrypted channel (new `rtc-signal` message kind).
- AI voice pipeline: mic, then VAD, then STT (Codex), then text to the agent CLI, then the reply to TTS (Codex), then the orb speaks. Interrupting cuts the TTS.
- Honest limit: AI replies start in about 2 to 4 s (text-first). Real-time voice would need API keys and is out of scope.

## Phase 3: Floors + departments (Codex)
- Enlarge `src/renderer/src/assets/maps/office.tmj` and add `floor-2.tmj`, `floor-3.tmj` (same tilesets/gid space).
- Zones (objectgroup `zones`): Floor 1 lobby/reception, cafeteria, open engineering; Floor 2 CEO/Founder office, boardroom, CISO/security office, HR, finance; Floor 3 product/design, data/AI lab, meeting rooms. Add desk spawn points per zone.
- Floor switcher (buttons or elevator) in `OfficeFloor.tsx` + `themeRegistry.ts`; agents keep their floor.

## Phase 4: Models (Codex)
- Verify the current Gemini model IDs (official docs) and update the gemini + antigravity presets in `src/shared/agentProvider.ts`.
- Local models already exist (Settings → AI Engines, Ollama via OpenCode/Crush/Pi). Make them easier to find in Add Agent; no new engine.

## Codex: voice engines (in parallel with Phase 1)
Build `src/main/voice/` with exactly this interface:
```ts
// stt.ts
export async function transcribe(pcm16kMono: Int16Array): Promise<string>
// tts.ts
export async function synthesize(text: string, voice?: string): Promise<{ wav: Buffer }>
export function listVoices(): string[]
```
- Local only: whisper.cpp (small/base model) for STT, Piper for TTS. Linux + Windows x64.
- Download the binaries and models on first use into userData, pin sha256 hashes, and show a progress event. Don't bundle them into the installer.
- One small test per file (tiny fixture wav gives non-empty text; text gives a valid WAV header).

## Phase 5: Security + design (Antigravity, teammate's computer)
- Security review of the Shared Office path: relay (`relay/`), protocol (`src/shared/teamProtocol.ts`), ingress and permissions (`src/main/teamIngress.ts`, `src/main/teamActions.ts`). Check signatures, replay protection, size limits, and that "Task requests (owner approves)" really can't prompt or type into agents. Write findings in ANTIGRAVITY_NOTES.md.
- Design pass on the three floors (`src/renderer/src/assets/maps/`): furniture, decor and room feel per department. Don't move or rename spawn points or zones; the code seats agents by those names.
- UI polish on Team chat and Meeting tabs (`src/renderer/src/components/meeting/`) after Claude's current version lands.

## Done means
Two computers (Linux + Bazzite): text chat with teammate + 2 AIs, screenshot shared, voice call with both humans and AIs speaking, 3 floors navigable, typecheck and focused tests pass.
