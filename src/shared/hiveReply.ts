/** Completion mail is required only when the sender requested it. Plain terminal
 * output is visible to the operator but cannot complete an inter-agent request. */
export function hiveReplyInstruction(message: {
  id: string;
  from: string;
  conversation: string;
  requiresReply: boolean;
}, outbox: string, isOrchestrator = false): string {
  if (!message.requiresReply) return '';
  if (isOrchestrator && message.from === 'human') return 'HUMAN RESULT REQUIRED: report the verified result or blocker directly to the human in this terminal. Do not mail your own inbox.';
  const reply = {
    to: message.from === 'breaker' ? 'god' : message.from,
    act: 'done',
    conversation: message.conversation,
    in_reply_to: message.id,
    subject: 'Task result',
    body: 'Your actual result, verification evidence, and any blocker',
    requires_reply: false
  };
  return `REPLY REQUIRED: after handling this request, write ONE JSON file into ${outbox}: ${JSON.stringify(reply)}. Use done only for verified completion; if blocked, use inform or refuse and explain why. A terminal-only answer does not reach the requester. Send no extra acknowledgment.`;
}

export function terminalWorkOrderPrompt(msg: {
  id: string; from: string; conversation: string; outboxDir: string;
  act: string; subject: string; body: string; requiresReply: boolean; createdAt: string;
}): string {
  return [
    'WORK ORDER FROM HIVE',
    `Message: ${msg.id}`,
    `From: ${msg.from}`,
    `Subject: ${msg.subject}`,
    `Act: ${msg.act}${msg.requiresReply ? ' (reply expected)' : ''}`,
    `Issued: ${msg.createdAt}`,
    '', msg.body, '',
    'Notes:',
    '- This arrived through your terminal because this provider does not support hive inbox.',
    '- Work in your current cwd.',
    hiveReplyInstruction(msg, msg.outboxDir),
    '- Report actual changes, validation, blockers, and next step.'
  ].filter(Boolean).join('\n');
}
