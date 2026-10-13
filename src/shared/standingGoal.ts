import { bridgeOf, inferAgentProvider, providerPreset, type AgentProvider } from './agentProvider';

/** Lifecycle hooks do not necessarily inject prompt context. In particular the
 * OpenCode plugin only emits tool/idle events, so its goals must travel with the
 * message. Read the current goal on delivery so edits apply without a restart. */
export function withStandingGoal(agent: { command?: string; provider?: AgentProvider; goal?: string }, text: string): string {
  const goal = agent.goal?.trim();
  if (!goal || text.includes('<goal>')) return text;
  const provider = inferAgentProvider(agent.command, agent.provider);
  const preset = providerPreset(provider);
  const injectsGoal = provider !== 'opencode' && (preset.hiveAware || bridgeOf(provider)?.kind === 'hooks');
  return injectsGoal ? text : `<goal>\n${goal}\n</goal>\n\n${text}`;
}
