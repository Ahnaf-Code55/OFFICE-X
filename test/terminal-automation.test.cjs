'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const {
  canAutomateTerminal,
  hasNativePermissionPrompt,
  nativeTerminalPrompt,
  isStaleTerminalDraft,
  opensInteractiveTerminalUi,
  shouldFollowTerminalOutput,
  terminalAutomationBlock,
  isStaleTerminalPicker,
  STALE_INPUT_MS,
  STALE_PICKER_MS
} = loadTs('src/renderer/src/components/terminalAutomation.ts');

test('first-run folder trust and tool approvals stop automated Enter before hooks are available', () => {
  assert.equal(hasNativePermissionPrompt('Folder access\n  Trust this folder? Codex can read, edit, and run files here.\n› 1. Trust and continue'), true);
  assert.equal(hasNativePermissionPrompt('Accessing workspace:\nDo you trust the contents of this project?\n> Yes, I trust this folder'), true);
  assert.equal(hasNativePermissionPrompt('Would you like to run the following command?\n  $ rm file'), true);
  assert.equal(hasNativePermissionPrompt('• I reviewed the permissions.\n› Ask Codex to do anything'), false);
  assert.equal(hasNativePermissionPrompt('The documentation explains "Trust this folder?" in the CLI.'), false);
});

test('an active Antigravity quota error holds automatic retries but old errors do not', () => {
  const error = '⚠ Individual quota reached. Please upgrade your subscription to increase your limits. Resets in\n4h21m20s.\nError ID: quota-test-5\n\n──────────────────\n>\n──────────────────\n? for shortcuts       Claude Sonnet 5.5 · medium\n';
  assert.equal(nativeTerminalPrompt(error), 'quota');
  const ready = { exited: false, pickerOpen: false, inputDirty: false, settleUntil: 0 };
  assert.equal(canAutomateTerminal({ ...ready, nativePrompt: nativeTerminalPrompt(error) }, 1e12), false);
  assert.equal(nativeTerminalPrompt(error + '\n● Read file\nNew answer succeeded.\n>'), null);
  assert.equal(nativeTerminalPrompt('The documentation says "Individual quota reached" means wait.'), null);
});

test('the Codex rate-limit model choice belongs to the human, never queued Enter', () => {
  const screen = 'Approaching rate limits\nSwitch to gpt-6-luna for lower credit usage?\n› 1. Switch to gpt-6-luna\n  2. Keep current model\n  3. Keep current model (never show again)\n\nenter select · esc back';
  assert.equal(nativeTerminalPrompt(screen), 'model-choice');
  assert.equal(canAutomateTerminal({ exited: false, pickerOpen: false, inputDirty: false, settleUntil: 0, nativePrompt: nativeTerminalPrompt(screen) }), false);
  assert.equal(nativeTerminalPrompt('I kept the current model after an approaching rate limits warning.'), null);
});

test('interactive provider commands pause queue automation', () => {
  assert.equal(opensInteractiveTerminalUi('/model'), true);
  assert.equal(opensInteractiveTerminalUi(' /provider '), true);
  assert.equal(opensInteractiveTerminalUi('/compact'), false);
  assert.equal(opensInteractiveTerminalUi('implement this'), false);
});

test('a command with an argument opens no picker to wait for', () => {
  // Only the BARE command opens a picker. `/model sonnet` applies the argument
  // and returns to the prompt, leaving no UI to close — but the picker latch is
  // cleared only by an Enter/Escape/Ctrl-C in that terminal, so latching here
  // wedged the agent's message queue permanently. Matching on the first token
  // alone is what caused it.
  assert.equal(opensInteractiveTerminalUi('/model sonnet'), false);
  assert.equal(opensInteractiveTerminalUi('/permissions allow'), false);
  assert.equal(opensInteractiveTerminalUi(' /provider anthropic '), false);
});

test('terminal automation waits for user drafts and interactive states', () => {
  const ready = { exited: false, pickerOpen: false, inputDirty: false, settleUntil: 0 };
  assert.equal(canAutomateTerminal(ready, 100), true);
  assert.equal(canAutomateTerminal({ ...ready, inputDirty: true }, 100), false);
  assert.equal(canAutomateTerminal({ ...ready, pickerOpen: true }, 100), false);
  assert.equal(canAutomateTerminal({ ...ready, exited: true }, 100), false);
  assert.equal(canAutomateTerminal({ ...ready, settleUntil: 101 }, 100), false);
});

test('an abandoned draft stops blocking delivery once it goes stale', () => {
  const typedAt = 1_000_000;
  const draft = {
    exited: false, pickerOpen: false, inputDirty: true,
    settleUntil: 0, inputDirtyAt: typedAt
  };
  // Fresh draft: the user is mid-sentence, automation must not type over it.
  assert.equal(canAutomateTerminal(draft, typedAt + 1), false);
  assert.equal(isStaleTerminalDraft(draft, typedAt + 1), false);
  // Untouched past the window: the queue must not stay wedged forever.
  assert.equal(isStaleTerminalDraft(draft, typedAt + STALE_INPUT_MS), true);
  assert.equal(canAutomateTerminal(draft, typedAt + STALE_INPUT_MS), true);
  // A draft with no timestamp keeps the old never-expires behavior.
  assert.equal(canAutomateTerminal({ ...draft, inputDirtyAt: undefined }, typedAt + 1e9), false);
});

test('an abandoned picker stops blocking delivery once it goes stale', () => {
  const openedAt = 1_000_000;
  const picker = {
    exited: false, pickerOpen: true, inputDirty: false,
    settleUntil: 0, pickerOpenedAt: openedAt
  };
  // While it is plausibly still open, automation must not type into the menu.
  assert.equal(canAutomateTerminal(picker, openedAt + 1), false);
  assert.equal(isStaleTerminalPicker(picker, openedAt + 1), false);
  // The latch is cleared only by Enter/Escape/Ctrl-C typed into that terminal.
  // A picker closed any other way left it set forever and the agent's queue
  // never drained again, so the block HAS to expire.
  assert.equal(isStaleTerminalPicker(picker, openedAt + STALE_PICKER_MS), true);
  assert.equal(canAutomateTerminal(picker, openedAt + STALE_PICKER_MS), true);
  assert.equal(terminalAutomationBlock(picker, openedAt + STALE_PICKER_MS), null);
  // No timestamp ⇒ the old never-expires behavior, so nothing silently changes
  // for a state recorded before this field existed.
  assert.equal(canAutomateTerminal({ ...picker, pickerOpenedAt: undefined }, openedAt + 1e9), false);
});

test('automation block reports why delivery is held', () => {
  const ready = { exited: false, pickerOpen: false, inputDirty: false, settleUntil: 0 };
  assert.equal(terminalAutomationBlock(ready, 100), null);
  assert.equal(terminalAutomationBlock({ ...ready, exited: true }, 100), 'exited');
  assert.equal(terminalAutomationBlock({ ...ready, pickerOpen: true }, 100), 'picker');
  assert.equal(terminalAutomationBlock({ ...ready, inputDirty: true }, 100), 'draft');
  assert.equal(terminalAutomationBlock({ ...ready, settleUntil: 101 }, 100), 'settling');
  // A picker outranks a draft: both are true while a slash menu is open.
  assert.equal(
    terminalAutomationBlock({ ...ready, pickerOpen: true, inputDirty: true }, 100),
    'picker'
  );
});

test('the user owns the prompt for a long time before automation takes it', () => {
  // Half an hour, both blocks. A 60s window fired while the user had merely
  // paused to think; treating a live draft as abandoned is the expensive
  // mistake, and parking a queued message a while longer is the cheap one.
  assert.equal(STALE_INPUT_MS, 1_800_000);
  assert.equal(STALE_PICKER_MS, 1_800_000);

  const at = 1_000_000;
  const ready = { exited: false, pickerOpen: false, inputDirty: false, settleUntil: 0 };
  const draft = { ...ready, inputDirty: true, inputDirtyAt: at };
  const picker = { ...ready, pickerOpen: true, pickerOpenedAt: at };

  // Ten minutes in, both still belong to the user.
  assert.equal(canAutomateTerminal(draft, at + 600_000), false);
  assert.equal(canAutomateTerminal(picker, at + 600_000), false);

  // Past the window delivery proceeds — it types AFTER whatever is on the line
  // (the two fuse into one prompt). Automation never erases the user's text and
  // never closes the user's menu, so there is nothing to undo either way.
  assert.equal(canAutomateTerminal(draft, at + STALE_INPUT_MS), true);
  assert.equal(canAutomateTerminal(picker, at + STALE_PICKER_MS), true);
});

test('terminal output follows only when already at the bottom', () => {
  assert.equal(shouldFollowTerminalOutput(100, 100), true);
  assert.equal(shouldFollowTerminalOutput(99, 100), true);
  assert.equal(shouldFollowTerminalOutput(80, 100), false);
});

test('Antigravity file approvals hold automated delivery instead of selecting the default Yes', () => {
  const screen = 'Create file\n/home/office/mood.md\n  1 + waiting\n\nAllow creation of this file?\n> 1. Yes, allow creation\n  2. No, deny creation\n\n  ↑/↓ Navigate · tab Amend · f full diff\nesc to cancel';
  assert.equal(hasNativePermissionPrompt(screen), true);
  assert.equal(hasNativePermissionPrompt('Allow editing of this file?\n> 1. Yes, allow edit\n  2. No'), true);
  assert.equal(hasNativePermissionPrompt('Allow execution of this command?\n> 1. Yes\n  2. No'), true);
  assert.equal(hasNativePermissionPrompt('The docs explain "Allow creation of this file?" as a confirmation.'), false);
  assert.equal(hasNativePermissionPrompt('File created successfully.\n>'), false);
});

test('Antigravity run-command approval and its optional survey hold work without pretending both are permissions', () => {
  assert.equal(nativeTerminalPrompt('Requesting permission for:\n  python3 -c ...\nRun this command?\n> 1. Yes, run command\n  4. No, cancel'), 'permission');
  const feedback="How's the CLI experience so far? Help us improve:\n [1] Good  [2] Fine  [3] Bad  [0] Skip";
  assert.equal(nativeTerminalPrompt(feedback), 'feedback');
  assert.equal(nativeTerminalPrompt('The CLI experience is fine.\n>'), null);
  const ready={exited:false,pickerOpen:false,inputDirty:false,settleUntil:0};
  for(const nativePrompt of ['permission','feedback']) {
    assert.equal(canAutomateTerminal({...ready,nativePrompt},1e12),false);
    assert.equal(terminalAutomationBlock({...ready,nativePrompt},1e12),nativePrompt);
  }
  assert.equal(canAutomateTerminal({...ready,nativePrompt:null},100),true);
});

test('a live Antigravity thinking spinner owns input until its cancel footer clears', () => {
  const {nativeTerminalBusy}=loadTs('src/renderer/src/components/terminalAutomation.ts');
  const thinking='⣷  Considering the cloud deployment...\n>\nesc to cancel  Gemini 3.8 Flash';
  assert.equal(nativeTerminalBusy(thinking),true);
  assert.equal(nativeTerminalBusy('○ Thought for 9.4s\nDone.\n>\n? for shortcuts Gemini 3.8 Flash'),false);
  assert.equal(nativeTerminalBusy('Documentation: ⣷ means thinking.\n>'),false);
  assert.equal(nativeTerminalBusy('⣷ Earlier work\nAllow creation of this file?\n> 1. Yes\nesc to cancel'),false);
  const ready={exited:false,pickerOpen:false,inputDirty:false,settleUntil:0};
  assert.equal(canAutomateTerminal({...ready,nativeBusy:true},100),false);
  assert.equal(terminalAutomationBlock({...ready,nativeBusy:true},100),'working');
  assert.equal(canAutomateTerminal({...ready,nativeBusy:false},100),true);
});
