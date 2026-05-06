export type NodeKind = 'shell' | 'gate' | 'approval' | 'codex' | 'agent_session' | 'end';

export interface WorkflowDefinition {
  id: string;
  start: string;
  workdir?: string;
  contextDir?: string;
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
  workdir?: string;
  contextDir?: string;
}

export interface CodexNodeDefinition extends WorkflowBaseNode {
  type: 'codex';
  mode: 'exec' | 'review';
  prompt: string;
  cwd?: string;
  workdir?: string;
  contextDir?: string;
  model?: string;
  outputFile?: string;
}

export interface AgentSessionNodeDefinition extends WorkflowBaseNode {
  type: 'agent_session';
  provider: 'codex';
  prompt: string;
  cwd?: string;
  workdir?: string;
  contextDir?: string;
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
  timelinePath: string;
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
  currentAttemptId?: string | null;
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
  attemptId?: string;
  status: NodeStatus;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number | null;
  signal?: string | null;
  detail?: string;
}

export interface RunTimelineEntry {
  stepIndex: number;
  nodeId: string;
  attemptId: string;
  status: NodeStatus;
  startedAt: string;
  finishedAt?: string;
  detail?: string;
  outcome?: 'success' | 'failure' | 'paused';
  nextNodeId?: string | null;
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
  nativeSplitTerminals?: boolean;
  externalTerminalLauncher?: {
    launch(request: {
      title: string;
      workingDirectory: string;
      command: string;
      args: string[];
      bootstrapCommand?: string;
      keepOpenOnExit?: boolean;
    }): Promise<{ terminalPid: number }>;
    close(terminalPid: number): Promise<void>;
  };
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

export type NativeSessionStatus = 'launching' | 'running' | 'completed' | 'failed' | 'paused' | 'aborting';

export interface NativeSessionResult {
  kind: 'complete' | 'fail' | 'pause';
  summary?: string;
  message?: string;
  reason?: string;
}

export interface NativeSessionState {
  mode: 'native_split_terminal';
  status: NativeSessionStatus;
  attemptId?: string;
  sessionId?: string;
  terminalPid?: number;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  lastHeartbeatAt?: string;
  result?: NativeSessionResult;
  lastArtifactPath?: string;
  error?: string;
}
