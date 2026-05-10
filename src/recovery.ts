import path from 'node:path';
import {
  loadManifest,
  loadRunState,
  loadRunTimeline,
  persistRunState,
  persistRunTimeline,
} from './workspace.js';
import { appendText, nowIso, readJson, writeJson } from './utils.js';
import { FlowBraidEngine } from './engine.js';
import { resolveNodeNext, resolveNodeTransition } from './workflow.js';
import { getNativeSessionPath, readNativeSessionState } from './native-session.js';
import { getNodeRuntimeStatePath, readNodeRuntimeState } from './node-runtime.js';
import type {
  ExecutionResult,
  NodeRuntimeState,
  NodeState,
  RunState,
  RunTimelineEntry,
  RunnerOptions,
  WorkflowDefinition,
  WorkflowNodeDefinition,
  WorkflowSourceMeta,
} from './types.js';

export type RecoveryDecision = 'retry-current' | 'continue-next' | 'fail-run';

export interface RecoveryDiagnosis {
  kind: 'resume_paused' | 'finalize_then_continue' | 'resume_codex_session' | 'confirm_recovery' | 'fail_unrecoverable';
  nodeId: string | null;
  attemptId?: string | null;
  sessionId?: string | null;
  suggestedAction?: 'resume' | 'retry-current' | 'continue-next' | 'fail-run' | null;
  nextNodeId?: string | null;
  reason: string;
}

export async function diagnoseRecovery(runDir: string): Promise<RecoveryDiagnosis> {
  const { workspace, manifest } = await loadManifest(runDir);
  const state = await loadRunState(workspace);
  const nodeId = state.currentNodeId;

  if (!nodeId) {
    return {
      kind: 'fail_unrecoverable',
      nodeId: null,
      attemptId: state.currentAttemptId ?? null,
      reason: `run status=${state.status} but currentNodeId is empty`,
    };
  }

  const node = manifest.workflow.nodes[nodeId];
  if (!node) {
    return {
      kind: 'fail_unrecoverable',
      nodeId,
      attemptId: state.currentAttemptId ?? null,
      reason: `current node ${nodeId} is missing from workflow`,
    };
  }

  const nodeDir = path.join(workspace.nodesDir, nodeId);
  const runtimeState = await readNodeRuntimeStateSafely(getNodeRuntimeStatePath(nodeDir));
  const nodeState = await readJsonSafely<NodeState>(path.join(nodeDir, 'status.json'));
  const nativeSession = await readNativeSessionStateSafely(getNativeSessionPath(nodeDir));

  if (state.status === 'paused') {
    return {
      kind: 'resume_paused',
      nodeId,
      attemptId: state.currentAttemptId ?? nodeState?.attemptId ?? null,
      suggestedAction: 'resume',
      nextNodeId: state.pendingNodeId,
      reason: `run paused at ${nodeId}`,
    };
  }

  if (node.type === 'codex' && runtimeState && isTerminalRuntimeState(runtimeState, state.currentAttemptId)) {
    return {
      kind: 'finalize_then_continue',
      nodeId,
      attemptId: runtimeState.attemptId ?? state.currentAttemptId ?? null,
      nextNodeId: resolveNodeNextFromRuntime(node, runtimeState),
      reason: `codex runtime-state already reached ${runtimeState.status}`,
    };
  }

  if (node.type === 'codex' && nativeSession?.sessionId) {
    return {
      kind: 'resume_codex_session',
      nodeId,
      attemptId: state.currentAttemptId ?? nativeSession.attemptId ?? null,
      sessionId: nativeSession.sessionId,
      suggestedAction: 'retry-current',
      reason: `codex session ${nativeSession.sessionId} can be resumed`,
    };
  }

  return {
    kind: 'confirm_recovery',
    nodeId,
    attemptId: state.currentAttemptId ?? nodeState?.attemptId ?? null,
    suggestedAction: 'retry-current',
    nextNodeId: resolveNodeNext(node, 'success'),
    reason: `manual recovery required for node ${nodeId}`,
  };
}

export async function recoverWorkflow(
  runDir: string,
  options: RunnerOptions & {
    decision?: RecoveryDecision;
    comment?: string;
  } = {},
): Promise<ExecutionResult> {
  const diagnosis = await diagnoseRecovery(runDir);
  const { workspace, manifest } = await loadManifest(runDir);
  const runtimeWorkflow = manifest.workflow as WorkflowDefinition & WorkflowSourceMeta;
  const state = await loadRunState(workspace);
  state.recoveryCount = (state.recoveryCount ?? 0) + 1;
  state.recoveryState = 'idle';
  state.recoveryTargetNodeId = diagnosis.nodeId;
  state.recoveryTargetAttemptId = diagnosis.attemptId ?? null;
  state.recoverySuggestedAction = diagnosis.suggestedAction ?? null;
  await persistRunState(workspace, state);
  await appendRecoveryEvent(workspace.messagesDir, {
    type: 'run.recovery.detected',
    nodeId: diagnosis.nodeId,
    attemptId: diagnosis.attemptId ?? null,
    kind: diagnosis.kind,
    reason: diagnosis.reason,
  });

  if (diagnosis.kind === 'resume_paused') {
    await appendRecoveryEvent(workspace.messagesDir, {
      type: 'run.recovery.resume_paused',
      nodeId: diagnosis.nodeId,
      attemptId: diagnosis.attemptId ?? null,
    });
    return {
      status: state.status,
      runId: state.runId,
      runDir: workspace.runDir,
      currentNodeId: state.currentNodeId,
      pendingNodeId: state.pendingNodeId,
    };
  }

  if (diagnosis.kind === 'finalize_then_continue') {
    await finalizeCurrentNodeFromRuntime(workspace.runDir, runtimeWorkflow, state, diagnosis);
    const engine = new FlowBraidEngine(runtimeWorkflow, options, runtimeWorkflow.directory);
    await appendRecoveryEvent(workspace.messagesDir, {
      type: 'run.recovery.finalize_then_continue',
      nodeId: diagnosis.nodeId,
      attemptId: diagnosis.attemptId ?? null,
      nextNodeId: diagnosis.nextNodeId ?? null,
    });
    if (diagnosis.nextNodeId) {
      state.status = 'running';
      state.currentNodeId = diagnosis.nextNodeId;
      state.currentAttemptId = null;
      state.pendingNodeId = null;
      state.failedReason = undefined;
      await persistRunState(workspace, state);
      return engine.continueRun(workspace, state);
    }
    state.status = 'completed';
    state.currentNodeId = null;
    state.currentAttemptId = null;
    state.pendingNodeId = null;
    await persistRunState(workspace, state);
    return {
      status: state.status,
      runId: state.runId,
      runDir: workspace.runDir,
      currentNodeId: state.currentNodeId,
      pendingNodeId: state.pendingNodeId,
    };
  }

  if (diagnosis.kind === 'resume_codex_session') {
    const engine = new FlowBraidEngine(runtimeWorkflow, options, runtimeWorkflow.directory);
    state.status = 'running';
    state.currentNodeId = diagnosis.nodeId;
    state.currentAttemptId = null;
    state.pendingNodeId = null;
    state.failedReason = undefined;
    await persistRunState(workspace, state);
    await appendRecoveryEvent(workspace.messagesDir, {
      type: 'run.recovery.resume_codex_session',
      nodeId: diagnosis.nodeId,
      attemptId: diagnosis.attemptId ?? null,
      sessionId: diagnosis.sessionId ?? null,
    });
    return engine.continueRun(workspace, state);
  }

  if (diagnosis.kind === 'confirm_recovery') {
    if (!options.decision) {
      state.recoveryState = 'awaiting_decision';
      await persistRunState(workspace, state);
      await appendRecoveryEvent(workspace.messagesDir, {
        type: 'run.recovery.confirmation_required',
        nodeId: diagnosis.nodeId,
        attemptId: diagnosis.attemptId ?? null,
        suggestedAction: diagnosis.suggestedAction ?? null,
      });
      return {
        status: state.status,
        runId: state.runId,
        runDir: workspace.runDir,
        currentNodeId: state.currentNodeId,
        pendingNodeId: state.pendingNodeId,
      };
    }

    return executeRecoveryDecision(runDir, runtimeWorkflow, state, diagnosis, options);
  }

  throw new Error(diagnosis.reason);
}

async function executeRecoveryDecision(
  runDir: string,
  workflow: WorkflowDefinition & WorkflowSourceMeta,
  state: RunState,
  diagnosis: RecoveryDiagnosis,
  options: RunnerOptions & { decision?: RecoveryDecision; comment?: string },
): Promise<ExecutionResult> {
  const { workspace } = await loadManifest(runDir);
  const engine = new FlowBraidEngine(workflow, options, workflow.directory);
  state.recoveryState = 'idle';
  await appendRecoveryEvent(workspace.messagesDir, {
    type: 'run.recovery.decision',
    nodeId: diagnosis.nodeId,
    attemptId: diagnosis.attemptId ?? null,
    decision: options.decision ?? null,
    comment: options.comment,
    targetNodeId: diagnosis.nextNodeId ?? null,
  });

  if (options.decision === 'retry-current') {
    state.status = 'running';
    state.currentNodeId = diagnosis.nodeId;
    state.currentAttemptId = null;
    state.pendingNodeId = null;
    state.failedReason = undefined;
    await persistRunState(workspace, state);
    return engine.continueRun(workspace, state);
  }

  if (options.decision === 'continue-next') {
    if (!options.comment) {
      throw new Error('continue-next requires --message');
    }
    state.status = 'running';
    state.currentNodeId = diagnosis.nextNodeId ?? resolveNodeNext(workflow.nodes[diagnosis.nodeId!], 'success');
    state.currentAttemptId = null;
    state.pendingNodeId = null;
    state.failedReason = undefined;
    await persistRunState(workspace, state);
    if (!state.currentNodeId) {
      state.status = 'completed';
      await persistRunState(workspace, state);
      return {
        status: state.status,
        runId: state.runId,
        runDir: workspace.runDir,
        currentNodeId: state.currentNodeId,
        pendingNodeId: state.pendingNodeId,
      };
    }
    return engine.continueRun(workspace, state);
  }

  if (options.decision === 'fail-run') {
    if (!options.comment) {
      throw new Error('fail-run requires --message');
    }
    state.status = 'failed';
    state.failedReason = options.comment;
    await persistRunState(workspace, state);
    return {
      status: state.status,
      runId: state.runId,
      runDir: workspace.runDir,
      currentNodeId: state.currentNodeId,
      pendingNodeId: state.pendingNodeId,
    };
  }

  throw new Error('recovery decision is required');
}

async function finalizeCurrentNodeFromRuntime(
  runDir: string,
  workflow: WorkflowDefinition,
  state: RunState,
  diagnosis: RecoveryDiagnosis,
): Promise<void> {
  const { workspace } = await loadManifest(runDir);
  const nodeId = diagnosis.nodeId!;
  const node = workflow.nodes[nodeId];
  const nodeDir = path.join(workspace.nodesDir, nodeId);
  const runtimeState = await readNodeRuntimeState(getNodeRuntimeStatePath(nodeDir));
  const nodeStatusPath = path.join(nodeDir, 'status.json');
  const timeline = await loadRunTimeline(workspace);
  const status: NodeState = {
    ...(await readJsonSafely<NodeState>(nodeStatusPath)),
    nodeId,
    attemptId: diagnosis.attemptId ?? runtimeState.attemptId,
    status: runtimeState.status === 'completed' ? 'succeeded' : runtimeState.status === 'paused' ? 'paused' : 'failed',
    startedAt: runtimeState.startedAt,
    finishedAt: runtimeState.completedAt ?? nowIso(),
    detail: runtimeState.summary ?? runtimeState.reason ?? runtimeState.error,
  };
  await writeJson(nodeStatusPath, status);

  const nextNodeId = diagnosis.nextNodeId ?? resolveNodeNextFromRuntime(node, runtimeState);
  const existing = timeline.find((entry) => entry.attemptId === (diagnosis.attemptId ?? runtimeState.attemptId));
  if (existing) {
    existing.status = status.status;
    existing.finishedAt = status.finishedAt;
    existing.detail = status.detail;
    existing.outcome = status.status === 'succeeded' ? 'success' : status.status === 'paused' ? 'paused' : 'failure';
    existing.nextNodeId = nextNodeId;
  } else {
    timeline.push({
      stepIndex: state.stepCount > 0 ? state.stepCount : timeline.length + 1,
      nodeId,
      attemptId: diagnosis.attemptId ?? runtimeState.attemptId ?? nowIso(),
      status: status.status,
      startedAt: runtimeState.startedAt,
      finishedAt: status.finishedAt,
      detail: status.detail,
      outcome: status.status === 'succeeded' ? 'success' : status.status === 'paused' ? 'paused' : 'failure',
      nextNodeId,
    });
  }
  await persistRunTimeline(workspace, timeline);
}

function isTerminalRuntimeState(runtimeState: NodeRuntimeState, attemptId?: string | null): boolean {
  if (attemptId && runtimeState.attemptId && runtimeState.attemptId !== attemptId) {
    return false;
  }
  return runtimeState.status === 'completed' || runtimeState.status === 'failed' || runtimeState.status === 'paused';
}

function resolveNodeNextFromRuntime(node: WorkflowNodeDefinition, runtimeState: NodeRuntimeState): string | null {
  const keys: string[] = [];
  if (runtimeState.outcome) {
    keys.push(`${runtimeState.status}.${runtimeState.outcome}`, runtimeState.outcome);
  }
  keys.push(runtimeState.status);
  if (runtimeState.status === 'completed') {
    keys.push(runtimeState.outcome === 'reject' || runtimeState.outcome === 'failure' ? 'failure' : 'success');
  } else if (runtimeState.status === 'failed') {
    keys.push('failure');
  }
  return resolveNodeTransition(node, keys);
}

async function appendRecoveryEvent(messagesDir: string, payload: Record<string, unknown>): Promise<void> {
  await appendText(path.join(messagesDir, 'events.jsonl'), `${JSON.stringify({ ...payload, at: nowIso() })}\n`);
}

async function readJsonSafely<T>(filePath: string): Promise<T | null> {
  try {
    return await readJson<T>(filePath);
  } catch {
    return null;
  }
}

async function readNativeSessionStateSafely(filePath: string) {
  try {
    return await readNativeSessionState(filePath);
  } catch {
    return null;
  }
}

async function readNodeRuntimeStateSafely(filePath: string) {
  try {
    return await readNodeRuntimeState(filePath);
  } catch {
    return null;
  }
}
