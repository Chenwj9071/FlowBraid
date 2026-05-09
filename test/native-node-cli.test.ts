import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { loadWorkflowFile } from '../src/workflow.js';
import { createInitialState, createRunWorkspace } from '../src/workspace.js';
import { main as cliMain } from '../src/cli.js';
import { getNativeSessionPath, readNativeSessionState } from '../src/native-session.js';
import { getControlLogPath, readControlEvents } from '../src/control-log.js';

describe('native node CLI protocol', () => {
  it('records node start', async () => {
    const { runDir } = await createRunFixture();

    const code = await cliMain([
      'node',
      'start',
      '--run-dir',
      runDir,
      '--node-id',
      'develop',
      '--attempt-id',
      'attempt-develop-1',
      '--terminal-pid',
      '3001',
    ]);

    expect(code).toBe(0);
    const state = await readNativeSessionState(getNativeSessionPath(path.join(runDir, 'nodes', 'develop')));
    expect(state.status).toBe('running');
    expect(state.terminalPid).toBe(3001);
    const controlEvents = await readControlEvents(getControlLogPath(path.join(runDir, 'nodes', 'develop')));
    expect(controlEvents.some((event) => event.kind === 'attempt.started')).toBe(true);
  });

  it('records node complete', async () => {
    const { runDir } = await createRunFixture();

    const code = await cliMain([
      'node',
      'complete',
      '--run-dir',
      runDir,
      '--node-id',
      'develop',
      '--attempt-id',
      'attempt-develop-1',
      '--outcome',
      'success',
      '--summary',
      'done',
    ]);

    expect(code).toBe(0);
    const state = await readNativeSessionState(getNativeSessionPath(path.join(runDir, 'nodes', 'develop')));
    expect(state.status).toBe('completed');
    expect(state.result?.kind).toBe('complete');
    expect(state.result?.summary).toBe('done');
    const controlEvents = await readControlEvents(getControlLogPath(path.join(runDir, 'nodes', 'develop')));
    expect(controlEvents.some((event) => event.kind === 'complete')).toBe(true);
  });

  it('records node fail', async () => {
    const { runDir } = await createRunFixture();

    const code = await cliMain([
      'node',
      'fail',
      '--run-dir',
      runDir,
      '--node-id',
      'verify',
      '--attempt-id',
      'attempt-verify-1',
      '--message',
      'verification failed',
    ]);

    expect(code).toBe(0);
    const state = await readNativeSessionState(getNativeSessionPath(path.join(runDir, 'nodes', 'verify')));
    expect(state.status).toBe('failed');
    expect(state.result?.kind).toBe('fail');
    expect(state.result?.message).toBe('verification failed');
    const controlEvents = await readControlEvents(getControlLogPath(path.join(runDir, 'nodes', 'verify')));
    expect(controlEvents.some((event) => event.kind === 'fail')).toBe(true);
  });

  it('records node artifact events', async () => {
    const { runDir } = await createRunFixture();

    const code = await cliMain([
      'node',
      'artifact',
      '--run-dir',
      runDir,
      '--node-id',
      'verify',
      '--attempt-id',
      'attempt-verify-1',
      '--file',
      'artifacts\\verify-report.md',
    ]);

    expect(code).toBe(0);
    const events = await readFile(path.join(runDir, 'messages', 'events.jsonl'), 'utf8');
    expect(events).toContain('"type":"node.native.artifact"');
    expect(events).toContain('"nodeId":"verify"');
    expect(events).toContain('artifacts\\\\verify-report.md');
    const controlEvents = await readControlEvents(getControlLogPath(path.join(runDir, 'nodes', 'verify')));
    expect(controlEvents.some((event) => event.kind === 'artifact')).toBe(true);
  });

  it('does not downgrade a completed native session when artifact is reported later', async () => {
    const { runDir } = await createRunFixture();

    const completeCode = await cliMain([
      'node',
      'complete',
      '--run-dir',
      runDir,
      '--node-id',
      'develop',
      '--attempt-id',
      'attempt-develop-1',
      '--outcome',
      'success',
      '--summary',
      'done',
    ]);
    expect(completeCode).toBe(0);

    const artifactCode = await cliMain([
      'node',
      'artifact',
      '--run-dir',
      runDir,
      '--node-id',
      'develop',
      '--attempt-id',
      'attempt-develop-1',
      '--file',
      'artifacts\\develop-last-message.md',
    ]);
    expect(artifactCode).toBe(0);

    const state = await readNativeSessionState(getNativeSessionPath(path.join(runDir, 'nodes', 'develop')));
    expect(state.status).toBe('completed');
    expect(state.result?.kind).toBe('complete');
    expect(state.lastArtifactPath).toBe('artifacts\\develop-last-message.md');
  });

  it('requires an explicit outcome for node complete', async () => {
    const { runDir } = await createRunFixture();

    await expect(
      cliMain([
        'node',
        'complete',
        '--run-dir',
        runDir,
        '--node-id',
        'develop',
        '--attempt-id',
        'attempt-develop-1',
        '--summary',
        'done',
      ]),
    ).rejects.toThrow(/--outcome/);
  });
});

async function createRunFixture(): Promise<{ runDir: string }> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-native-node-cli-'));
  const workflowDir = path.join(tempRoot, 'workspace');
  const workspaceRoot = path.join(workflowDir, '.flowbraid-runs');
  await mkdir(workflowDir, { recursive: true });

  const workflowFile = path.join(workflowDir, 'workflow.yaml');
  const workflowText = `
id: native-node-cli-demo
workdir: .
start: develop
nodes:
  develop:
    type: codex
    prompt: implement calc
    next: verify
  verify:
    type: codex
    prompt: verify calc
    next: done
  done:
    type: end
    message: done
`;
  await writeFile(workflowFile, workflowText, 'utf8');

  const workflow = await loadWorkflowFile(workflowFile);
  const runWorkspace = await createRunWorkspace(workspaceRoot, workflow);
  await createInitialState(runWorkspace, workflow);
  await mkdir(path.join(runWorkspace.nodesDir, 'develop', 'state'), { recursive: true });
  await mkdir(path.join(runWorkspace.nodesDir, 'verify', 'state'), { recursive: true });
  return { runDir: runWorkspace.runDir };
}

