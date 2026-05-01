export type NodeKind = 'shell' | 'gate' | 'approval' | 'codex' | 'agent_session' | 'end';

export interface WorkflowDefinition {
  id: string;
  start: string;
  workdir?: string;
  nodes: Record<string, WorkflowNodeDefinition>;
}

export interface WorkflowBaseNode {
  id?: string;
  type: NodeKind;
  title?: string;
  next?: string;
  transitions?: {
    success?: string;
    failure?: string;
    default?: string;
    approve?: string;
    reject?: string;
  };
}

export interface ShellNodeDefinition extends WorkflowBaseNode {
  type: 'shell';
  command: string;
  cwd?: string;
}

export interface CodexNodeDefinition extends WorkflowBaseNode {
  type: 'codex';
  mode: 'exec' | 'review';
  prompt: string;
  cwd?: string;
  model?: string;
  outputFile?: string;
}

export interface AgentSessionNodeDefinition extends WorkflowBaseNode {
  type: 'agent_session';
  provider: 'codex';
  prompt: string;
  cwd?: string;
  model?: string;
  outputFile?: string;
}

export interface GateNodeDefinition extends WorkflowBaseNode {
  type: 'gate';
  prompt?: string;
}

export interface ApprovalNodeDefinition extends WorkflowBaseNode {
  type: 'approval';
  prompt?: string;
}

export interface EndNodeDefinition extends WorkflowBaseNode {
  type: 'end';
  message?: string;
}

export type WorkflowNodeDefinition =
  | ShellNodeDefinition
  | CodexNodeDefinition
  | AgentSessionNodeDefinition
  | GateNodeDefinition
  | ApprovalNodeDefinition
  | EndNodeDefinition;

export type NodeStatus = 'pending' | 'running' | 'paused' | 'succeeded' | 'failed' | 'closed';
export type RunStatus = 'running' | 'paused' | 'completed' | 'failed';

export interface WorkflowSourceMeta {
  filePath: string;
  directory: string;
}

export interface RunWorkspace {
  runId: string;
  runDir: string;
  manifestPath: string;
  statePath: string;
  stateDir: string;
  nodesDir: string;
  artifactsDir: string;
  messagesDir: string;
  logsDir: string;
}

export interface RunState {
  runId: string;
  workflowId: string;
  status: RunStatus;
  currentNodeId: string | null;
  pendingNodeId: string | null;
  resumeCount: number;
  stepCount: number;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  failedReason?: string;
}

export interface NodeState {
  nodeId: string;
  status: NodeStatus;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number | null;
  signal?: string | null;
  detail?: string;
}

export interface ExecutionResult {
  status: RunStatus;
  runId: string;
  runDir: string;
  currentNodeId: string | null;
  pendingNodeId: string | null;
}

export interface RunnerOptions {
  workspaceRoot?: string;
  defaultWorkdir?: string;
  logger?: (line: string) => void;
  maxSteps?: number;
  codexCommand?: string;
  approvalDecision?: 'approve' | 'reject';
  approvalComment?: string;
  interactiveTerminal?: TerminalSession;
  abortSignal?: AbortSignal;
}

export interface TerminalSession {
  input: NodeJS.ReadStream;
  output: NodeJS.WriteStream;
}

export type AgentSessionStatus = 'running' | 'waiting_input' | 'completed' | 'failed';

export interface AgentSessionState {
  nodeId: string;
  provider: 'codex';
  status: AgentSessionStatus;
  turnCount: number;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  lastUserMessage?: string;
  lastAssistantMessage?: string;
  outputFile?: string;
  error?: string;
}

export interface AgentSessionMessage {
  kind: 'message' | 'event';
  role?: 'system' | 'user' | 'assistant';
  type?: string;
  content: string;
  at: string;
  turn?: number;
}
