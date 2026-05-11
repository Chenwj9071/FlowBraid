import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { createInitialState, createRunWorkspace, persistRunState } from '../src/workspace.js';
import { loadWorkflowFile } from '../src/workflow.js';
import { main as cliMain } from '../src/cli.js';
import { writeJson } from '../src/utils.js';
import type { NodeState } from '../src/types.js';

describe('recover CLI', () => {
  it('shows recover in help output', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await cliMain(['--help']);
    const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    logSpy.mockRestore();
    errorSpy.mockRestore();

    expect(code).toBe(0);
    expect(output).toContain('flowbraid recover <run-dir>');
  });

  it('fails continue-next without message', async () => {
    const { runDir } = await createRecoverCliFixture();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await cliMain(['recover', runDir, '--decision', 'continue-next']);
    const stderr = errorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    logSpy.mockRestore();
    errorSpy.mockRestore();

    expect(code).toBe(1);
    expect(stderr).toContain('continue-next requires --message');
  });

  it('fails fail-run without message', async () => {
    const { runDir } = await createRecoverCliFixture();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await cliMain(['recover', runDir, '--decision', 'fail-run']);
    const stderr = errorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    logSpy.mockRestore();
    errorSpy.mockRestore();

    expect(code).toBe(1);
    expect(stderr).toContain('fail-run requires --message');
  });

  it('accepts retry-current recovery command', async () => {
    const { runDir } = await createRecoverCliFixture();
    const stdoutChunks: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      stdoutChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stdout.write);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await cliMain(['recover', runDir, '--decision', 'retry-current']);
    const stdout = stdoutChunks.join('');
    stdoutSpy.mockRestore();
    errorSpy.mockRestore();

    expect(code).toBe(0);
    expect(stdout).toContain('workspace:');
  });

  it('can recover a paused approval run with approve decision', async () => {
    const { runDir } = await createRecoverCliPausedApprovalFixture();
    const stdoutChunks: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      stdoutChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stdout.write);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await cliMain(['recover', runDir, '--decision', 'approve']);
    const stdout = stdoutChunks.join('');
    stdoutSpy.mockRestore();
    errorSpy.mockRestore();

    expect(code).toBe(0);
    expect(stdout).toContain('=> completed');
  });

  it('recovers a paused approval run by re-entering approval interaction without recovery decision', async () => {
    const { runDir } = await createRecoverCliPausedApprovalFixture();
    const stdoutChunks: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      stdoutChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    }) as typeof process.stdout.write);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const input = new PassThrough() as PassThrough & { isTTY: boolean };
    input.isTTY = true;
    const originalStdin = process.stdin;
    const originalStdoutIsTTY = process.stdout.isTTY;
    Object.defineProperty(process, 'stdin', { value: input, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });

    const codePromise = cliMain(['recover', runDir]);
    setTimeout(() => {
      input.write('approve\n');
      input.end();
    }, 50);
    const code = await codePromise;
    const stdout = stdoutChunks.join('');

    Object.defineProperty(process, 'stdin', { value: originalStdin, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: originalStdoutIsTTY, configurable: true });
    stdoutSpy.mockRestore();
    errorSpy.mockRestore();

    expect(code).toBe(0);
    expect(stdout).toContain('审批结果 [approve/reject]:');
    expect(stdout).not.toContain('恢复动作 [retry-current/continue-next/fail-run]:');
    expect(stdout).toContain('=> completed');
  });
});

async function createRecoverCliFixture(): Promise<{ runDir: string }> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-recover-cli-'));
  const workflowDir = path.join(tempRoot, 'workspace');
  const workspaceRoot = path.join(workflowDir, '.flowbraid-runs');
  await mkdir(workflowDir, { recursive: true });

  const workflowFile = path.join(workflowDir, 'workflow.yaml');
  await writeFile(
    workflowFile,
    `
id: recover-cli-demo
start: prepare
nodes:
  prepare:
    type: shell
    command: echo recovered > recovered.txt
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
  runState.status = 'failed';
  runState.currentNodeId = 'prepare';
  runState.currentAttemptId = 'attempt-prepare-1';
  runState.failedReason = '用户中断运行';
  runState.recoveryCount = 0;
  runState.recoveryState = 'idle';
  await persistRunState(workspace, runState);

  const nodeDir = path.join(workspace.nodesDir, 'prepare');
  await mkdir(path.join(nodeDir, 'state'), { recursive: true });
  const nodeState: NodeState = {
    nodeId: 'prepare',
    attemptId: 'attempt-prepare-1',
    status: 'failed',
    startedAt: '2026-05-10T08:00:00.000Z',
    finishedAt: '2026-05-10T08:01:00.000Z',
    detail: '用户中断运行',
  };
  await writeJson(path.join(nodeDir, 'status.json'), nodeState);

  return { runDir: workspace.runDir };
}

async function createRecoverCliPausedApprovalFixture(): Promise<{ runDir: string }> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-recover-cli-'));
  const workflowDir = path.join(tempRoot, 'workspace');
  const workspaceRoot = path.join(workflowDir, '.flowbraid-runs');
  await mkdir(workflowDir, { recursive: true });

  const workflowFile = path.join(workflowDir, 'workflow.yaml');
  await writeFile(
    workflowFile,
    `
id: recover-cli-approval-demo
start: approve
nodes:
  approve:
    type: approval
    prompt: confirm
    transitions:
      approve: done
      reject: redo
  redo:
    type: end
    message: redo
  done:
    type: end
    message: done
`,
    'utf8',
  );

  const workflow = await loadWorkflowFile(workflowFile);
  const workspace = await createRunWorkspace(workspaceRoot, workflow);
  const runState = await createInitialState(workspace, workflow);
  runState.status = 'paused';
  runState.currentNodeId = 'approve';
  runState.currentAttemptId = 'attempt-approve-1';
  runState.pendingNodeId = null;
  runState.recoveryCount = 0;
  runState.recoveryState = 'idle';
  await persistRunState(workspace, runState);

  const nodeDir = path.join(workspace.nodesDir, 'approve');
  await mkdir(path.join(nodeDir, 'state'), { recursive: true });
  const nodeState: NodeState = {
    nodeId: 'approve',
    attemptId: 'attempt-approve-1',
    status: 'paused',
    startedAt: '2026-05-10T08:00:00.000Z',
    finishedAt: '2026-05-10T08:01:00.000Z',
    detail: 'approval pending',
  };
  await writeJson(path.join(nodeDir, 'status.json'), nodeState);

  return { runDir: workspace.runDir };
}
