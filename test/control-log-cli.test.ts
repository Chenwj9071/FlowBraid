import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { loadWorkflowFile } from '../src/workflow.js';
import { createInitialState, createRunWorkspace } from '../src/workspace.js';
import { main as cliMain } from '../src/cli.js';
import { getControlLogPath, readControlEvents } from '../src/control-log.js';

describe('control log compatibility path', () => {
  it('derives runtime-state from control-log after complete', async () => {
    const { runDir } = await createRunFixture();
    const code = await cliMain([
      'node',
      'complete',
      '--run-dir',
      runDir,
      '--node-id',
      'develop',
      '--attempt-id',
      'attempt-1',
      '--outcome',
      'success',
      '--summary',
      'done',
    ]);

    expect(code).toBe(0);
    const runtimeState = JSON.parse(await readFile(path.join(runDir, 'nodes', 'develop', 'state', 'runtime-state.json'), 'utf8')) as {
      attemptId?: string;
      status?: string;
      outcome?: string;
      summary?: string;
    };
    expect(runtimeState.attemptId).toBe('attempt-1');
    expect(runtimeState.status).toBe('completed');
    expect(runtimeState.outcome).toBe('success');
    expect(runtimeState.summary).toBe('done');
  });

  it('writes accepted control events to control-log', async () => {
    const { runDir } = await createRunFixture();
    await cliMain([
      'node',
      'fail',
      '--run-dir',
      runDir,
      '--node-id',
      'develop',
      '--attempt-id',
      'attempt-2',
      '--message',
      'boom',
    ]);

    const events = await readControlEvents(getControlLogPath(path.join(runDir, 'nodes', 'develop')));
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('fail');
    expect(events[0].attemptId).toBe('attempt-2');
    expect(events[0].payload?.message).toBe('boom');
  });

  it('deduplicates retry with the same operation-id', async () => {
    const { runDir } = await createRunFixture();
    const args = [
      'node',
      'complete',
      '--run-dir',
      runDir,
      '--node-id',
      'develop',
      '--attempt-id',
      'attempt-3',
      '--outcome',
      'success',
      '--summary',
      'done',
      '--operation-id',
      'op-retry-1',
    ];

    expect(await cliMain(args)).toBe(0);
    expect(await cliMain(args)).toBe(0);

    const events = await readControlEvents(getControlLogPath(path.join(runDir, 'nodes', 'develop')));
    expect(events).toHaveLength(1);
    expect(events[0].operationId).toBe('op-retry-1');
  });
});

async function createRunFixture(): Promise<{ runDir: string }> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-control-log-cli-'));
  const workflowDir = path.join(tempRoot, 'workspace');
  const workspaceRoot = path.join(workflowDir, '.flowbraid-runs');
  await mkdir(workflowDir, { recursive: true });

  const workflowFile = path.join(workflowDir, 'workflow.yaml');
  await writeFile(
    workflowFile,
    `
id: control-log-cli-demo
workdir: .
start: develop
nodes:
  develop:
    type: codex
    prompt: implement calc
    next: done
  done:
    type: end
    message: done
`,
    'utf8',
  );

  const workflow = await loadWorkflowFile(workflowFile);
  const runWorkspace = await createRunWorkspace(workspaceRoot, workflow);
  await createInitialState(runWorkspace, workflow);
  await mkdir(path.join(runWorkspace.nodesDir, 'develop', 'state'), { recursive: true });
  return { runDir: runWorkspace.runDir };
}
