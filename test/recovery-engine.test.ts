import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createInitialState, createRunWorkspace, loadRunState, persistRunState, persistRunTimeline } from '../src/workspace.js';
import { loadWorkflowFile } from '../src/workflow.js';
import { writeJson } from '../src/utils.js';
import { writeNativeSessionState } from '../src/native-session.js';
import { diagnoseRecovery, recoverWorkflow } from '../src/recovery.js';
import type { NodeRuntimeState, NodeState, RunState, RunTimelineEntry } from '../src/types.js';

describe('workflow recovery engine', () => {
  it('diagnoses a paused gate run as resume_paused', async () => {
    const fixture = await createRecoveryFixture(`
id: recover-gate
start: review
nodes:
  review:
    type: gate
    prompt: wait
    next: done
  done:
    type: end
    message: done
`);

    const state = await loadRunState(fixture.workspace);
    state.status = 'paused';
    state.currentNodeId = 'review';
    state.pendingNodeId = 'done';
    state.recoveryCount = 1;
    state.recoveryState = 'idle';
    await persistRunState(fixture.workspace, state);

    await writeNodeState(fixture.workspace.runDir, 'review', {
      nodeId: 'review',
      attemptId: 'attempt-review-1',
      status: 'paused',
      startedAt: '2026-05-10T08:00:00.000Z',
      detail: 'waiting',
    });

    const diagnosis = await diagnoseRecovery(fixture.workspace.runDir);
    expect(diagnosis.kind).toBe('resume_paused');
    expect(diagnosis.nodeId).toBe('review');
  });

  it('diagnoses native codex with completed runtime-state as finalize_then_continue', async () => {
    const fixture = await createRecoveryFixture(`
id: recover-finalize
start: develop
nodes:
  develop:
    type: codex
    prompt: implement
    next: done
  done:
    type: end
    message: done
`);

    const state = await loadRunState(fixture.workspace);
    state.status = 'running';
    state.currentNodeId = 'develop';
    state.currentAttemptId = 'attempt-develop-1';
    await persistRunState(fixture.workspace, state);

    await writeNodeState(fixture.workspace.runDir, 'develop', {
      nodeId: 'develop',
      attemptId: 'attempt-develop-1',
      status: 'running',
      startedAt: '2026-05-10T08:00:00.000Z',
    });

    await writeNodeRuntimeState(fixture.workspace.runDir, 'develop', {
      nodeId: 'develop',
      attemptId: 'attempt-develop-1',
      status: 'completed',
      outcome: 'success',
      startedAt: '2026-05-10T08:00:00.000Z',
      updatedAt: '2026-05-10T08:10:00.000Z',
      completedAt: '2026-05-10T08:10:00.000Z',
      summary: 'develop done',
    });

    const diagnosis = await diagnoseRecovery(fixture.workspace.runDir);
    expect(diagnosis.kind).toBe('finalize_then_continue');
    expect(diagnosis.nodeId).toBe('develop');
  });

  it('diagnoses native codex with recorded session id as resume_codex_session', async () => {
    const fixture = await createRecoveryFixture(`
id: recover-codex-resume
start: develop
nodes:
  develop:
    type: codex
    prompt: implement
    next: done
  done:
    type: end
    message: done
`);

    const state = await loadRunState(fixture.workspace);
    state.status = 'running';
    state.currentNodeId = 'develop';
    state.currentAttemptId = 'attempt-develop-1';
    await persistRunState(fixture.workspace, state);

    await writeNodeState(fixture.workspace.runDir, 'develop', {
      nodeId: 'develop',
      attemptId: 'attempt-develop-1',
      status: 'running',
      sessionId: 'session-develop-1',
      startedAt: '2026-05-10T08:00:00.000Z',
    });

    await writeNativeSessionState(path.join(fixture.workspace.runDir, 'nodes', 'develop', 'state', 'native-session.json'), {
      mode: 'native_split_terminal',
      attemptId: 'attempt-develop-1',
      sessionId: 'session-develop-1',
      status: 'failed',
      terminalPid: 3456,
      startedAt: '2026-05-10T08:00:00.000Z',
      updatedAt: '2026-05-10T08:05:00.000Z',
      completedAt: '2026-05-10T08:05:00.000Z',
      result: {
        kind: 'fail',
        message: 'terminal closed unexpectedly',
      },
    });

    const diagnosis = await diagnoseRecovery(fixture.workspace.runDir);
    expect(diagnosis.kind).toBe('resume_codex_session');
    expect(diagnosis.nodeId).toBe('develop');
    expect(diagnosis.sessionId).toBe('session-develop-1');
  });

  it('diagnoses interrupted shell as confirm_recovery', async () => {
    const fixture = await createRecoveryFixture(`
id: recover-shell
start: prepare
nodes:
  prepare:
    type: shell
    command: echo hi
    next: done
  done:
    type: end
    message: done
`);

    const state = await loadRunState(fixture.workspace);
    state.status = 'failed';
    state.currentNodeId = 'prepare';
    state.currentAttemptId = 'attempt-prepare-1';
    state.failedReason = '用户中断运行';
    await persistRunState(fixture.workspace, state);

    await writeNodeState(fixture.workspace.runDir, 'prepare', {
      nodeId: 'prepare',
      attemptId: 'attempt-prepare-1',
      status: 'failed',
      startedAt: '2026-05-10T08:00:00.000Z',
      finishedAt: '2026-05-10T08:01:00.000Z',
      exitCode: 130,
      signal: 'SIGINT',
      detail: '用户中断运行',
    });

    const diagnosis = await diagnoseRecovery(fixture.workspace.runDir);
    expect(diagnosis.kind).toBe('confirm_recovery');
    expect(diagnosis.nodeId).toBe('prepare');
    expect(diagnosis.suggestedAction).toBe('retry-current');
  });

  it('retries the current node with a new attempt when recovery decision is retry-current', async () => {
    const fixture = await createRecoveryFixture(`
id: recover-retry
start: prepare
nodes:
  prepare:
    type: shell
    command: echo recovered > recovered.txt
    next: done
  done:
    type: end
    message: done
`);

    const state = await loadRunState(fixture.workspace);
    state.status = 'failed';
    state.currentNodeId = 'prepare';
    state.currentAttemptId = 'attempt-prepare-1';
    state.failedReason = '用户中断运行';
    await persistRunState(fixture.workspace, state);

    await writeNodeState(fixture.workspace.runDir, 'prepare', {
      nodeId: 'prepare',
      attemptId: 'attempt-prepare-1',
      status: 'failed',
      startedAt: '2026-05-10T08:00:00.000Z',
      finishedAt: '2026-05-10T08:01:00.000Z',
      detail: '用户中断运行',
    });

    await persistRunTimeline(fixture.workspace, [
      {
        stepIndex: 1,
        nodeId: 'prepare',
        attemptId: 'attempt-prepare-1',
        status: 'failed',
        startedAt: '2026-05-10T08:00:00.000Z',
        finishedAt: '2026-05-10T08:01:00.000Z',
        detail: '用户中断运行',
        outcome: 'failure',
        nextNodeId: null,
      },
    ]);

    const result = await recoverWorkflow(fixture.workspace.runDir, {
      decision: 'retry-current',
      comment: 'retry after interruption',
    });

    expect(result.status).toBe('completed');
    const recoveredFile = await readFile(path.join(fixture.workflowDir, 'recovered.txt'), 'utf8');
    expect(recoveredFile.trim()).toBe('recovered');

    const finalState = await loadRunState(fixture.workspace);
    expect(finalState.status).toBe('completed');
    expect(finalState.recoveryCount).toBe(1);

    const timeline = JSON.parse(await readFile(fixture.workspace.timelinePath, 'utf8')) as RunTimelineEntry[];
    const prepareAttempts = timeline.filter((entry) => entry.nodeId === 'prepare');
    expect(prepareAttempts).toHaveLength(2);
    expect(prepareAttempts[0].attemptId).not.toBe(prepareAttempts[1].attemptId);

    const events = await readFile(path.join(fixture.workspace.messagesDir, 'events.jsonl'), 'utf8');
    expect(events).toContain('"type":"run.recovery.decision"');
    expect(events).toContain('"decision":"retry-current"');
  });

  it('continues to the next node when recovery decision is continue-next', async () => {
    const fixture = await createRecoveryFixture(`
id: recover-continue
start: prepare
nodes:
  prepare:
    type: shell
    command: exit 1
    next: done
  done:
    type: end
    message: done
`);

    const state = await loadRunState(fixture.workspace);
    state.status = 'failed';
    state.currentNodeId = 'prepare';
    state.currentAttemptId = 'attempt-prepare-1';
    state.failedReason = '用户中断运行';
    await persistRunState(fixture.workspace, state);

    await writeNodeState(fixture.workspace.runDir, 'prepare', {
      nodeId: 'prepare',
      attemptId: 'attempt-prepare-1',
      status: 'failed',
      startedAt: '2026-05-10T08:00:00.000Z',
      finishedAt: '2026-05-10T08:01:00.000Z',
      detail: '用户中断运行',
    });

    const result = await recoverWorkflow(fixture.workspace.runDir, {
      decision: 'continue-next',
      comment: 'manual continue',
    });

    expect(result.status).toBe('completed');
    const finalState = await loadRunState(fixture.workspace);
    expect(finalState.status).toBe('completed');
    const events = await readFile(path.join(fixture.workspace.messagesDir, 'events.jsonl'), 'utf8');
    expect(events).toContain('"decision":"continue-next"');
  });

  it('fails the run when recovery decision is fail-run', async () => {
    const fixture = await createRecoveryFixture(`
id: recover-fail
start: prepare
nodes:
  prepare:
    type: shell
    command: echo hi
    next: done
  done:
    type: end
    message: done
`);

    const state = await loadRunState(fixture.workspace);
    state.status = 'failed';
    state.currentNodeId = 'prepare';
    state.currentAttemptId = 'attempt-prepare-1';
    state.failedReason = '用户中断运行';
    await persistRunState(fixture.workspace, state);

    await writeNodeState(fixture.workspace.runDir, 'prepare', {
      nodeId: 'prepare',
      attemptId: 'attempt-prepare-1',
      status: 'failed',
      startedAt: '2026-05-10T08:00:00.000Z',
      finishedAt: '2026-05-10T08:01:00.000Z',
      detail: '用户中断运行',
    });

    const result = await recoverWorkflow(fixture.workspace.runDir, {
      decision: 'fail-run',
      comment: 'stop recovery',
    });

    expect(result.status).toBe('failed');
    const finalState = await loadRunState(fixture.workspace);
    expect(finalState.status).toBe('failed');
    expect(finalState.failedReason).toBe('stop recovery');
  });
});

async function createRecoveryFixture(workflowContent: string): Promise<{
  workflowDir: string;
  workspace: {
    runDir: string;
    timelinePath: string;
    messagesDir: string;
  } & Awaited<ReturnType<typeof createRunWorkspace>>;
}> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-recovery-'));
  const workflowDir = path.join(tempRoot, 'workspace');
  const workspaceRoot = path.join(workflowDir, '.flowbraid-runs');
  await mkdir(workflowDir, { recursive: true });
  const workflowFile = path.join(workflowDir, 'workflow.yaml');
  await writeFile(workflowFile, workflowContent, 'utf8');
  const workflow = await loadWorkflowFile(workflowFile);
  const workspace = await createRunWorkspace(workspaceRoot, workflow);
  const state = await createInitialState(workspace, workflow);
  state.recoveryCount = 0;
  state.recoveryState = 'idle';
  await persistRunState(workspace, state);
  return { workflowDir, workspace };
}

async function writeNodeState(runDir: string, nodeId: string, state: NodeState): Promise<void> {
  const nodeDir = path.join(runDir, 'nodes', nodeId);
  await mkdir(path.join(nodeDir, 'state'), { recursive: true });
  await writeJson(path.join(nodeDir, 'status.json'), state);
}

async function writeNodeRuntimeState(runDir: string, nodeId: string, state: NodeRuntimeState): Promise<void> {
  const nodeDir = path.join(runDir, 'nodes', nodeId);
  await mkdir(path.join(nodeDir, 'state'), { recursive: true });
  await writeJson(path.join(nodeDir, 'state', 'runtime-state.json'), state);
}
