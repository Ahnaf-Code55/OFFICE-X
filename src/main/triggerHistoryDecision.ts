export type HeldDecision = 'approved' | 'rejected';

export interface PendingDecisionRecord {
  decision?: string;
}

export interface PendingDecisionResult<T> {
  entry: T;
  changed: boolean;
  dispatched: boolean;
}

/** Apply an owner's decision to one held event. Dispatch happens before the
 *  durable approval update; failures leave the event pending, and repeated
 *  decisions cannot dispatch it twice. */
export function decidePendingEntry<T extends PendingDecisionRecord>(input: {
  entry: T;
  decision: HeldDecision;
  dispatch: () => boolean;
  update: (decision: HeldDecision) => T;
}): PendingDecisionResult<T> {
  if (input.entry.decision !== 'pending') {
    return { entry: input.entry, changed: false, dispatched: false };
  }
  if (input.decision === 'rejected') {
    return { entry: input.update('rejected'), changed: true, dispatched: false };
  }
  if (!input.dispatch()) {
    return { entry: input.entry, changed: false, dispatched: false };
  }
  return { entry: input.update('approved'), changed: true, dispatched: true };
}
