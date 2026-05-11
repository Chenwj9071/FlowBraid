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
  transitions?: Record<string, string | null | undefined>;
}

export type CodexReentryMode = 'resume' | 'new_with_history' | 'new';

export interface CodexReentryOptions {
  mode?: CodexReentryMode;
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
  prompt: string;
  cwd?: string;
  workdir?: string;
  contextDir?: string;
  model?: string;
  outputFile?: string;
  reentry?: CodexReentryOptions;
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
  manualDecisionState?: 'idle' | 'awaiting_codex_intervention';
  manualDecisionNodeId?: string | null;
  manualDecisionAttemptId?: string | null;
  manualDecisionReason?: string | null;
  resumeCount: number;
  recoveryCount?: number;
  recoveryState?: 'idle' | 'awaiting_decision';
  recoveryTargetNodeId?: string | null;
  recoveryTargetAttemptId?: string | null;
  recoverySuggestedAction?: 'resume' | 'retry-current' | 'continue-next' | 'fail-run' | null;
  stepCount: number;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  failedReason?: string;
}

export interface NodeState {
  nodeId: string;
  attemptId?: string;
  sessionId?: string;
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
  terminalCloseGraceMs?: number;
  terminalCloseTimeoutMs?: number;
  codexCommand?: string;
  approvalDecision?: 'approve' | 'reject';
  approvalComment?: string;
  manualDecision?: 'retry-current' | 'continue-next';
  interactiveTerminal?: TerminalSession;
  nativeSplitTerminals?: boolean;
  isTerminalProcessAlive?: (terminalPid: number) => Promise<boolean> | boolean;
  externalTerminalLauncher?: {
    launch(request: {
      title: string;
      workingDirectory: string;
      command: string;
      args: string[];
      bootstrapCommand?: string;
    keepOpenOnExit?: boolean;
    }): Promise<{ terminalPid: number }>;
    close(terminalPid: number, options?: { timeoutMs?: number; title?: string; signal?: AbortSignal }): Promise<void>;
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

export type NodeRuntimeStatus = 'launching' | 'running' | 'waiting_input' | 'paused' | 'completed' | 'failed' | 'timed_out' | 'canceled';

export type ControlEventKind =
  | 'attempt.started'
  | 'complete'
  | 'fail'
  | 'pause'
  | 'artifact'
  | 'attempt.superseded'
  | 'recovery.orphaned'
  | 'heartbeat';

export interface ControlEventRecord {
  version: 1;
  eventId: string;
  operationId: string;
  runId: string;
  nodeId: string;
  attemptId: string;
  source: 'compat-cli' | 'ipc' | 'fallback-outbox' | 'scheduler' | 'recovery-synthesized';
  kind: ControlEventKind;
  at: string;
  payload?: Record<string, unknown>;
}

export interface NodeRuntimeState {
  nodeId: string;
  attemptId?: string;
  status: NodeRuntimeStatus;
  outcome?: string;
  sessionId?: string;
  terminalPid?: number;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  summary?: string;
  reason?: string;
  error?: string;
  lastArtifactPath?: string;
}

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
