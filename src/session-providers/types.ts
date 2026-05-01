export type AgentSessionTurnStatus = 'waiting_input' | 'completed' | 'failed';

export interface AgentSessionTurnResult {
  status: AgentSessionTurnStatus;
  message: string;
  summary?: string;
  files?: string[];
}

