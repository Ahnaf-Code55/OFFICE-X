import { CommandCenterPanel } from './CommandCenterPanel';
import { type Agent } from '@/store/store';

export interface AgentDetailPanelProps { agent: Agent; }

/** Every clicked agent opens the same workspace, keyed to its own session. */
export function AgentDetailPanel({ agent }: AgentDetailPanelProps) {
  return <CommandCenterPanel key={agent.id} agent={agent} />;
}
