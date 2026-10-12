/** Renderer-facing hook event shared across the Electron IPC boundary. */
export interface HookEvent {
  agentId?: string;
  event: string;
  tool?: string;
  notificationType?: string;
  source?: string;
  message?: string;
  blocked?: boolean;
}

const OPTIONAL_STRING_FIELDS = ['tool', 'notificationType', 'source', 'message'] as const;

/** Typed permission notifications must stop automation even with empty/localized text. */
export function notificationNeedsHuman(event: Pick<HookEvent, 'notificationType' | 'message'>): boolean {
  const type = (event.notificationType ?? '').toLowerCase();
  if (type === 'permission' || type === 'permission_prompt' || type === 'elicitation_dialog') return true;
  if (type === 'idle' || type === 'idle_prompt') return false;
  const message = (event.message ?? '').toLowerCase();
  return /permission|approv|confirm|needs your/.test(message);
}

/** Validate an untrusted payload before it crosses the Electron IPC boundary. */
export function validateHookEvent(value: unknown): value is HookEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;

  const candidate = value as Record<string, unknown>;
  if (typeof candidate.event !== 'string' || candidate.event.length === 0) return false;
  if (
    candidate.agentId !== undefined &&
    (typeof candidate.agentId !== 'string' || candidate.agentId.length === 0)
  ) return false;

  for (const field of OPTIONAL_STRING_FIELDS) {
    if (candidate[field] !== undefined && typeof candidate[field] !== 'string') return false;
  }

  return candidate.blocked === undefined || typeof candidate.blocked === 'boolean';
}
