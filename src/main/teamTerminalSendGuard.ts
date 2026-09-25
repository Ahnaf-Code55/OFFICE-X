/** Tracks one in-flight terminal batch per teammate/agent and invalidates it on revocation. */
export interface TeamTerminalSendToken {
  readonly key: string;
  readonly generation: number;
}

export class TeamTerminalSendGuard {
  private readonly sends = new Map<string, { generation: number; active: boolean }>();

  begin(key: string): TeamTerminalSendToken | undefined {
    const current = this.sends.get(key);
    if (current?.active) return undefined;
    const generation = current?.generation ?? 0;
    this.sends.set(key, { generation, active: true });
    return { key, generation };
  }

  /** Invalidate an active batch. Queued, not-yet-started batches are removed by the caller. */
  invalidate(key: string): void {
    const current = this.sends.get(key);
    if (current?.active) this.sends.set(key, { generation: current.generation + 1, active: true });
  }

  isCurrent(token: TeamTerminalSendToken): boolean {
    const current = this.sends.get(token.key);
    return current?.active === true && current.generation === token.generation;
  }

  finish(token: TeamTerminalSendToken): void {
    const current = this.sends.get(token.key);
    if (current?.active && current.generation === token.generation) this.sends.delete(token.key);
    else if (current?.active) this.sends.delete(token.key);
  }

  isSending(key: string): boolean {
    return this.sends.get(key)?.active === true;
  }

  activeKeys(): string[] {
    return [...this.sends].filter(([, value]) => value.active).map(([key]) => key);
  }
}
