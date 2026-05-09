import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { createInitialState, createRunWorkspace, persistRunTimeline, persistRunState } from '../src/workspace.js';
import { loadWorkflowFile } from '../src/workflow.js';
import { main as cliMain } from '../src/cli.js';
import { writeJson } from '../src/utils.js';
import { writeNativeSessionState } from '../src/native-session.js';
import type { NodeState, RunTimelineEntry } from '../src/types.js';

describe('status CLI', () => {
  it('prints readable status summary for the current node', async () => {
    const { runDir } = await createStatusFixture();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await cliMain(['status', runDir]);
    const stdout = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    logSpy.mockRestore();
    errorSpy.mockRestore();

    expect(code).toBe(0);
    expect(stdout).toContain('runId:');
    expect(stdout).toContain('workflowId: status-cli-demo');
    expect(stdout).toContain('currentNodeId: develop');
    expect(stdout).toContain('currentAttemptId: attempt-develop-1');
    expect(stdout).toContain('reentry.mode: resume');
    expect(stdout).toContain('node.sessionId: session-develop-1');
    expect(stdout).toContain('native.status: completed');
    expect(stdout).toContain('timeline.latest: step=1 node=develop attempt=attempt-develop-1 status=succeeded');
  });

  it('prints JSON status payload when --json is set', async () => {
    const { runDir } = await createStatusFixture();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await cliMain(['status', runDir, '--json']);
    const stdout = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    logSpy.mockRestore();
    errorSpy.mockRestore();

    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as {
      workflowId: string;
      currentNodeId: string | null;
      currentAttemptId?: string | null;
      reentryMode?: string;
      nodeState?: { sessionId?: string };
      nativeSession?: { sessionId?: string };
    };
    expect(parsed.workflowId).toBe('status-cli-demo');
    expect(parsed.currentNodeId).toBe('develop');
    expect(parsed.currentAttemptId).toBe('attempt-develop-1');
    expect(parsed.reentryMode).toBe('resume');
    expect(parsed.nodeState?.sessionId).toBe('session-develop-1');
    expect(parsed.nativeSession?.sessionId).toBe('session-develop-1');
  });
});

async function createStatusFixture(): Promise<{
  runDir: string;
}> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-status-cli-'));
  const workflowDir = path.join(tempRoot, 'workspace');
  const workspaceRoot = path.join(workflowDir, '.flowbraid-runs');
  await mkdir(workflowDir, { recursive: true });

  const workflowFile = path.join(workflowDir, 'workflow.yaml');
  await writeFile(
    workflowFile,
    `
id: status-cli-demo
workdir: .
start: develop
nodes:
  develop:
    type: codex
    prompt: implement calc
    reentry:
      mode: resume
    next: done
  done:
    type: end
    message: done
`,
    'utf8',
  );

  const workflow = await loadWorkflowFile(workflowFile);
  const workspace = await createRunWorkspace(workspaceRoot, workflow);
  const runState = await createInitialState(workspace, workflow);
  runState.currentNodeId = 'develop';
  runState.currentAttemptId = 'attempt-develop-1';
  runState.pendingNodeId = 'done';
  runState.status = 'paused';
  await persistRunState(workspace, runState);

  const nodeDir = path.join(workspace.nodesDir, 'develop');
  await mkdir(path.join(nodeDir, 'state'), { recursive: true });
  const nodeState: NodeState = {
    nodeId: 'develop',
    attemptId: 'attempt-develop-1',
    sessionId: 'session-develop-1',
    status: 'paused',
    startedAt: '2026-05-06T10:00:00.000Z',
    detail: 'waiting for approval',
  };
  await writeJson(path.join(nodeDir, 'status.json'), nodeState);
  await writeNativeSessionState(path.join(nodeDir, 'state', 'native-session.json'), {
    mode: 'native_split_terminal',
    attemptId: 'attempt-develop-1',
    sessionId: 'session-develop-1',
    status: 'completed',
    terminalPid: 43210,
    startedAt: '2026-05-06T10:00:00.000Z',
    updatedAt: '2026-05-06T10:05:00.000Z',
    completedAt: '2026-05-06T10:05:00.000Z',
    result: {
      kind: 'complete',
      summary: 'done',
    },
  });

  const timeline: RunTimelineEntry[] = [
    {
      stepIndex: 1,
      nodeId: 'develop',
      attemptId: 'attempt-develop-1',
      status: 'succeeded',
      startedAt: '2026-05-06T10:00:00.000Z',
      finishedAt: '2026-05-06T10:05:00.000Z',
      detail: 'done',
      outcome: 'success',
      nextNodeId: 'done',
    },
  ];
  await persistRunTimeline(workspace, timeline);

  return { runDir: workspace.runDir };
}

