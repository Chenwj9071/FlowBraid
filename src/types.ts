export type NodeKind = 'shell' | 'gate' | 'end';

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
  };
}

export interface ShellNodeDefinition extends WorkflowBaseNode {
  type: 'shell';
  command: string;
  cwd?: string;
}

export interface GateNodeDefinition extends WorkflowBaseNode {
  type: 'gate';
  prompt?: string;
}

export interface EndNodeDefinition extends WorkflowBaseNode {
  type: 'end';
  message?: string;
}

export type WorkflowNodeDefinition = ShellNodeDefinition | GateNodeDefinition | EndNodeDefinition;

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
}

