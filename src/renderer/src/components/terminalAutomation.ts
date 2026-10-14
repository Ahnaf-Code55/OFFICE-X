/** Slash commands that open an interactive picker/panel instead of starting a
 * normal agent turn. Automated queue delivery must wait until that UI closes. */
const INTERACTIVE_COMMANDS = new Set([
  '/model',
  '/reasoning',
  '/permissions',
  '/permission',
  '/provider',
  '/settings',
  '/config',
  '/experimental',
  '/experiments',
  '/hooks',
  '/mcp',
  '/apps',
  '/plugins',
  '/resume',
  '/sessions'
]);

/** Native trust and tool approvals can appear without hook events. Their Enter
 * key must never be supplied by an automated prompt or inbox nudge. */
export function hasNativePermissionPrompt(screen: string): boolean {
  return /^\s*(?:Trust this folder\?|Do you trust the contents of this project\?|Would you like to run\b|Run this command\?|Requesting permission for:|Do you want to (?:run|allow|approve|proceed)\b|Allow (?:creation|editing|deletion|execution|reading) of (?:this|the) (?:file|command)\?)/im.test(screen);
}

export type NativeTerminalPrompt = 'permission' | 'feedback' | 'quota' | 'model-choice' | null;
export function nativeTerminalPrompt(screen: string): NativeTerminalPrompt {
  if (hasNativePermissionPrompt(screen)) return 'permission';
  if (/^\s*Approaching rate limits\s*$/m.test(screen)
    && /^\s*Switch to \S+ for lower credit usage\?/m.test(screen)
    && /Keep current model/.test(screen) && /enter select · esc back/.test(screen)) return 'model-choice';
  // Antigravity consumes the next key in this survey instead of the work prompt.
  if (/^\s*How's the CLI experience so far\? Help us improve:/im.test(screen)
    && /\[0\]\s*Skip/i.test(screen)) return 'feedback';
  // A failed turn returns to an empty input prompt. It is not ready for another
  // automated call: keep mail queued until the owner changes model or retries.
  // Only accept an error at the end of the latest turn, not old scrollback above
  // a subsequent successful answer or running turn.
  const quota = /^\s*⚠\s*Individual quota reached\.[\s\S]*?^\s*Error ID:[^\n]+\n([\s\S]*)/m.exec(screen);
  if (quota && quota[1].split('\n').every(line => /^\s*(?:[─━-]+|>.*|\? for shortcuts.*)?\s*$/.test(line))) return 'quota';
  return null;
}

/** Hookless Antigravity turns can think without a tool event. The live spinner
 * and cancel footer distinguish that turn from completed reasoning in history. */
export function nativeTerminalBusy(screen: string): boolean {
  return nativeTerminalPrompt(screen) === null
    && /^\s*[\u2801-\u28ff]\s+\S/m.test(screen)
    && /esc to cancel/i.test(screen);
}

export function opensInteractiveTerminalUi(input: string): boolean {
  // Only a BARE command opens a picker. `/model` prompts you to choose;
  // `/model sonnet` applies the argument and returns to the prompt with no UI
  // to close. Matching on the first token alone latched the block on the second
  // form too, and nothing could ever clear it — the agent's message queue then
  // silently stopped delivering for the rest of the session.
  const trimmed = input.trim().toLowerCase();
  if (/\s/.test(trimmed)) return false;
  return INTERACTIVE_COMMANDS.has(trimmed);
}

/** Follow output only if the user was already at (or one line from) the bottom.
 * This keeps live TUIs visible without yanking someone reading scrollback. */
export function shouldFollowTerminalOutput(viewportY: number, baseY: number): boolean {
  return baseY - viewportY <= 1;
}

/** How long an untouched draft on the prompt keeps blocking queue delivery.
 *
 * The block exists so automation can't fuse its text onto a half-written line.
 * It still has to expire, because the flag is set from KEYSTROKES and a TUI that
 * swallows keys for its own UI can leave it set while the prompt is visibly
 * empty — a phantom draft, which wedged the queue for the rest of the session.
 *
 * Half an hour, not a minute. The old 60s window fired while the user had merely
 * paused to think, and treating a real draft as abandoned is the expensive
 * mistake; leaving a queued message parked a while longer is the cheap one. When
 * it does fire, delivery simply types after the existing text (the two fuse into
 * one prompt) — automation never deletes what the user wrote. */
export const STALE_INPUT_MS = 1_800_000;

/** How long an untouched picker keeps blocking queue delivery.
 * The picker latch is set when the user submits a bare `/model`-style command
 * and is cleared by an Enter, Escape or Ctrl-C typed into that terminal — so a
 * picker closed any other way leaves it set with no path back. Same half hour,
 * same reason: it is the user's menu, so wait a long time, then deliver. We
 * never send Escape ourselves; closing someone's open menu to make room for a
 * queued message is not ours to do. */
export const STALE_PICKER_MS = 1_800_000;

export interface TerminalAutomationState {
  exited: boolean;
  pickerOpen: boolean;
  inputDirty: boolean;
  settleUntil: number;
  inputDirtyAt?: number; // last keystroke that left a draft; absent ⇒ never expires
  pickerOpenedAt?: number; // when the picker latched; absent ⇒ never expires
  nativePrompt?: NativeTerminalPrompt;
  nativeBusy?: boolean;
}

/** A picker nobody has interacted with for STALE_PICKER_MS is treated as gone. */
export function isStaleTerminalPicker(
  state: TerminalAutomationState,
  now = Date.now()
): boolean {
  return state.pickerOpen
    && state.pickerOpenedAt !== undefined
    && now - state.pickerOpenedAt >= STALE_PICKER_MS;
}

/** Why automation may not own the prompt right now, or null when it may. */
export type TerminalAutomationBlock = 'exited' | 'picker' | 'draft' | 'settling' | 'working' | NativeTerminalPrompt;

/** A draft nobody has touched for STALE_INPUT_MS is treated as abandoned. */
export function isStaleTerminalDraft(
  state: TerminalAutomationState,
  now = Date.now()
): boolean {
  return state.inputDirty
    && state.inputDirtyAt !== undefined
    && now - state.inputDirtyAt >= STALE_INPUT_MS;
}

export function terminalAutomationBlock(
  state: TerminalAutomationState,
  now = Date.now()
): TerminalAutomationBlock {
  if (state.exited) return 'exited';
  if (state.nativePrompt) return state.nativePrompt;
  if (state.nativeBusy) return 'working';
  if (state.pickerOpen && !isStaleTerminalPicker(state, now)) return 'picker';
  if (state.inputDirty && !isStaleTerminalDraft(state, now)) return 'draft';
  if (now < state.settleUntil) return 'settling';
  return null;
}

/** Automatic writes may own the prompt only when no user draft or picker does. */
export function canAutomateTerminal(
  state: TerminalAutomationState,
  now = Date.now()
): boolean {
  return terminalAutomationBlock(state, now) === null;
}
