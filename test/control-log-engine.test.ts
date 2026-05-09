import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { loadWorkflowFile } from '../src/workflow.js';
import { startWorkflow } from '../src/engine.js';
import { getControlLogPath, readControlEvents } from '../src/control-log.js';
import { getNativeSessionPath, writeNativeSessionState } from '../src/native-session.js';
import { getNodeRuntimeStatePath, writeNodeRuntimeState } from '../src/node-runtime.js';

describe('control log engine integration', () => {
  it('records scheduler attempt.started across same-node re-entry', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-control-log-engine-'));
    const workflowDir = path.join(tempRoot, 'workspace');
    const workspaceRoot = path.join(workflowDir, '.flowbraid-runs');
    await mkdir(workflowDir, { recursive: true });

    const workflowFile = path.join(workflowDir, 'workflow.yaml');
    await writeFile(
      workflowFile,
      `
id: control-log-engine-demo
workdir: .
contextDir: .
start: develop
nodes:
  develop:
    type: codex
    prompt: implement calc
    transitions:
      success: verify
  verify:
    type: codex
    prompt: verify calc
    transitions:
      success: done
      failure: develop
  done:
    type: end
    message: done
`,
      'utf8',
    );

    const workflow = await loadWorkflowFile(workflowFile);
    let developLaunchCount = 0;
    const launcher = {
      async launch(request: { title: string }): Promise<{ terminalPid: number }> {
        const terminalPid = 9300 + developLaunchCount;
        setTimeout(async () => {
          const runDir = path.join(workspaceRoot, (await readDirNames(workspaceRoot))[0]);
          const attemptId = await readCurrentAttemptId(runDir);
          if (request.title.includes('develop')) {
            developLaunchCount += 1;
            const nodeDir = path.join(runDir, 'nodes', 'develop');
            await writeNodeRuntimeState(getNodeRuntimeStatePath(nodeDir), {
              nodeId: 'develop',
              attemptId,
              status: 'completed',
              outcome: 'success',
              terminalPid,
              startedAt: '2026-05-08T12:00:00.000Z',
              updatedAt: '2026-05-08T12:00:05.000Z',
              completedAt: '2026-05-08T12:00:05.000Z',
              summary: `develop ${developLaunchCount}`,
            });
            await writeNativeSessionState(getNativeSessionPath(nodeDir), {
              mode: 'native_split_terminal',
              attemptId,
              status: 'completed',
              terminalPid,
              startedAt: '2026-05-08T12:00:00.000Z',
              updatedAt: '2026-05-08T12:00:05.000Z',
              completedAt: '2026-05-08T12:00:05.000Z',
              result: {
                kind: 'complete',
                summary: `develop ${developLaunchCount}`,
              },
            });
            return;
          }

          const nodeDir = path.join(runDir, 'nodes', 'verify');
          const reject = developLaunchCount === 1;
          await writeNodeRuntimeState(getNodeRuntimeStatePath(nodeDir), {
            nodeId: 'verify',
            attemptId,
            status: 'completed',
            outcome: reject ? 'reject' : 'approve',
            terminalPid,
            startedAt: '2026-05-08T12:00:10.000Z',
            updatedAt: '2026-05-08T12:00:15.000Z',
            completedAt: '2026-05-08T12:00:15.000Z',
            summary: reject ? 'verify reject' : 'verify approve',
          });
          await writeNativeSessionState(getNativeSessionPath(nodeDir), {
            mode: 'native_split_terminal',
            attemptId,
            status: 'completed',
            terminalPid,
            startedAt: '2026-05-08T12:00:10.000Z',
            updatedAt: '2026-05-08T12:00:15.000Z',
            completedAt: '2026-05-08T12:00:15.000Z',
            result: {
              kind: 'complete',
              summary: reject ? 'verify reject' : 'verify approve',
            },
          });
        }, 50);
        return { terminalPid };
      },
      async close(): Promise<void> {
        return;
      },
    };

    const result = await startWorkflow(workflow, {
      workspaceRoot,
      nativeSplitTerminals: true,
      interactiveTerminal: { input: process.stdin, output: process.stdout },
      externalTerminalLauncher: launcher,
    });
    expect(result.status).toBe('completed');

    const developEvents = await readControlEvents(getControlLogPath(path.join(result.runDir, 'nodes', 'develop')));
    const startEvents = developEvents.filter((event) => event.kind === 'attempt.started');
    expect(startEvents).toHaveLength(2);
    expect(new Set(startEvents.map((event) => event.attemptId)).size).toBe(2);
  });
});

async function readDirNames(dir: string): Promise<string[]> {
  const { readdir } = await import('node:fs/promises');
  return readdir(dir);
}

async function readCurrentAttemptId(runDir: string): Promise<string> {
  const runState = JSON.parse(await readFile(path.join(runDir, 'state', 'run.json'), 'utf8')) as { currentAttemptId?: string | null };
  if (!runState.currentAttemptId) {
    throw new Error(`Missing currentAttemptId for run ${runDir}`);
  }
  return runState.currentAttemptId;
}
