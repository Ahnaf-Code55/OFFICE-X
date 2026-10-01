import type { TeamMessage } from '../shared/teamProtocol';
import type { TriggerMode } from '../shared/triggers';
import {
  parseTeamAction,
  type RtcSignal,
  teamTaskRequestRequiresApproval,
  type ParsedTeamAction,
  type TeamActionMember,
  type TeamActionTarget
} from './teamActions';

export type TeamDispatchOutcome =
  | { type: 'task-request'; decision: 'pending' | 'auto-allowed'; title: string; message: string }
  | { type: 'agent-prompt'; decision: 'auto-allowed'; agentId: string; prompt: string }
  | { type: 'terminal-input'; decision: 'auto-allowed'; agentId: string; input: string }
  | { type: 'terminal-stream'; decision: 'auto-allowed'; agentId: string; output: string; sequence: number; streamId: string; gap: boolean }
  | { type: 'chat'; decision: 'auto-allowed'; channel: 'leadership' | 'managers' | 'everyone'; text: string; image: string; authorKind: 'human' | 'agent'; authorName: string }
  | ({ type: 'rtc-signal'; decision: 'auto-allowed' } & RtcSignal);

export interface TeamDispatchInput {
  message: TeamMessage;
  member: TeamActionMember;
  triggerMode: TriggerMode;
  targets: readonly TeamActionTarget[];
  hasTerminal: (agentId: string) => boolean;
  dispatchTaskRequest: (request: Extract<ParsedTeamAction, { type: 'task-request' }>) => boolean;
  steerAgent: (agentId: string, prompt: string) => void;
  writeTerminal: (agentId: string, input: string) => void;
  receiveTerminalStream: (stream: Extract<ParsedTeamAction, { type: 'terminal-stream' }>) => void;
  receiveChat: (chat: Extract<ParsedTeamAction, { type: 'chat' }>) => void;
  receiveRtcSignal: (signal: RtcSignal) => void;
}

/** Revalidate the current member level, parse the exact payload, and perform the
 *  authorized local action. The main-process adapters own history/UI effects;
 *  this boundary keeps authorization and action dispatch testable together. */
export function dispatchTeamAction(input: TeamDispatchInput): TeamDispatchOutcome {
  const command = parseTeamAction({
    message: input.message,
    member: input.member,
    targets: input.targets,
    hasTerminal: input.hasTerminal
  });

  if (command.type === 'task-request') {
    if (teamTaskRequestRequiresApproval(input.member.controlLevel, input.triggerMode)) {
      return { ...command, decision: 'pending' };
    }
    if (!input.dispatchTaskRequest(command)) throw new Error('could not queue teammate task request');
    return { ...command, decision: 'auto-allowed' };
  }
  if (command.type === 'agent-prompt') {
    input.steerAgent(command.agentId, command.prompt);
    return { ...command, decision: 'auto-allowed' };
  }
  if (command.type === 'terminal-input') {
    input.writeTerminal(command.agentId, command.input);
    return { ...command, decision: 'auto-allowed' };
  }
  if (command.type === 'chat') {
    input.receiveChat(command);
    return { ...command, decision: 'auto-allowed' };
  }
  if (command.type === 'rtc-signal') {
    const { type: _type, ...signal } = command;
    input.receiveRtcSignal(signal);
    return { ...command, decision: 'auto-allowed' };
  }
  input.receiveTerminalStream(command);
  return { ...command, decision: 'auto-allowed' };
}
