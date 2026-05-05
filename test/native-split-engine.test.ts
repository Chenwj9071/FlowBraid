import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { loadWorkflowFile } from '../src/workflow.js';
import { startWorkflow } from '../src/engine.js';
import { getNativeSessionPath, writeNativeSessionState } from '../src/native-session.js';

describe('native split engine', () => {
  it('waits for native node completion, closes the terminal, and flows to the next node', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-native-split-engine-'));
    const workflowDir = path.join(tempRoot, 'workspace');
    const workspaceRoot = path.join(workflowDir, '.flowbraid-runs');
    await mkdir(workflowDir, { recursive: true });

    const workflowFile = path.join(workflowDir, 'workflow.yaml');
    const workflowText = `
id: native-split-engine-demo
workdir: .
contextDir: .
start: develop
nodes:
  develop:
    type: codex
    mode: exec
    prompt: implement calc
    outputFile: develop.md
    next: done
  done:
    type: end
    message: done
`;
    await writeFile(workflowFile, workflowText, 'utf8');
    const workflow = await loadWorkflowFile(workflowFile);

    const closedTerminalPids: number[] = [];
    const launchedRequests: Array<{ command: string; args: string[] }> = [];
    const launcher = {
      async launch(request: { command: string; args: string[] }): Promise<{ terminalPid: number }> {
        launchedRequests.push({ command: request.command, args: request.args });
        setTimeout(async () => {
          const runDirs = await readDirNames(workspaceRoot);
          const runDir = path.join(workspaceRoot, runDirs[0]);
          const nodeDir = path.join(runDir, 'nodes', 'develop');
          const sessionPath = getNativeSessionPath(nodeDir);
          await writeFile(path.join(nodeDir, 'artifacts', 'develop.md'), '# develop complete\n', 'utf8');
          await writeNativeSessionState(sessionPath, {
            mode: 'native_split_terminal',
            status: 'completed',
            terminalPid: 9101,
            startedAt: '2026-05-05T00:00:00.000Z',
            updatedAt: '2026-05-05T00:00:30.000Z',
            completedAt: '2026-05-05T00:00:30.000Z',
            result: {
              kind: 'complete',
              summary: 'developed calc.js',
            },
          });
        }, 50);
        return { terminalPid: 9101 };
      },
      async close(terminalPid: number): Promise<void> {
        closedTerminalPids.push(terminalPid);
      },
    };

    const result = await startWorkflow(workflow, {
      workspaceRoot,
      nativeSplitTerminals: true,
      interactiveTerminal: { input: process.stdin, output: process.stdout },
      externalTerminalLauncher: launcher,
    });

    expect(result.status).toBe('completed');
    expect(closedTerminalPids).toEqual([9101]);
    expect(launchedRequests).toHaveLength(1);
    expect(launchedRequests[0].command).toBe('codex');
    expect(launchedRequests[0].args.join(' ')).not.toContain('run-codex-node');

    const events = await readFile(path.join(result.runDir, 'messages', 'events.jsonl'), 'utf8');
    expect(events).toContain('"type":"terminal.launched"');
    expect(events).toContain('"type":"terminal.closed"');
  });

  it('resumes a native codex node with its own recorded session id on re-entry', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-native-split-engine-'));
    const workflowDir = path.join(tempRoot, 'workspace');
    const workspaceRoot = path.join(workflowDir, '.flowbraid-runs');
    await mkdir(workflowDir, { recursive: true });

    const workflowFile = path.join(workflowDir, 'workflow.yaml');
    const workflowText = `
id: native-split-resume-demo
workdir: .
contextDir: .
start: develop
nodes:
  develop:
    type: codex
    mode: exec
    prompt: implement calc
    transitions:
      success: verify
  verify:
    type: codex
    mode: review
    prompt: verify calc
    transitions:
      success: done
      failure: develop
  done:
    type: end
    message: done
`;
    await writeFile(workflowFile, workflowText, 'utf8');
    const workflow = await loadWorkflowFile(workflowFile);

    let developLaunchCount = 0;
    const launchedRequests: Array<{ title: string; command: string; args: string[] }> = [];
    const launcher = {
      async launch(request: { title: string; command: string; args: string[] }): Promise<{ terminalPid: number }> {
        launchedRequests.push({ title: request.title, command: request.command, args: request.args });
        const terminalPid = 9200 + launchedRequests.length;
        setTimeout(async () => {
          const runDirs = await readDirNames(workspaceRoot);
          const runDir = path.join(workspaceRoot, runDirs[0]);
          if (request.title.includes('develop')) {
            developLaunchCount += 1;
            const nodeDir = path.join(runDir, 'nodes', 'develop');
            await writeFile(path.join(nodeDir, 'artifacts', 'develop.md'), '# develop complete\n', 'utf8');
            await writeNativeSessionState(getNativeSessionPath(nodeDir), {
              mode: 'native_split_terminal',
              status: 'completed',
              terminalPid,
              sessionId: 'node-develop-session-1',
              startedAt: '2026-05-05T00:00:00.000Z',
              updatedAt: '2026-05-05T00:00:10.000Z',
              completedAt: '2026-05-05T00:00:10.000Z',
              result: {
                kind: 'complete',
                summary: `develop ${developLaunchCount}`,
              },
            });
            return;
          }

          const nodeDir = path.join(runDir, 'nodes', 'verify');
          await writeFile(
            path.join(nodeDir, 'artifacts', 'codex-last-message.md'),
            developLaunchCount === 1 ? 'verdict: reject\n' : 'verdict: approve\n',
            'utf8',
          );
          await writeNativeSessionState(getNativeSessionPath(nodeDir), {
            mode: 'native_split_terminal',
            status: 'completed',
            terminalPid,
            sessionId: `node-verify-session-${developLaunchCount}`,
            startedAt: '2026-05-05T00:00:20.000Z',
            updatedAt: '2026-05-05T00:00:30.000Z',
            completedAt: '2026-05-05T00:00:30.000Z',
            result: {
              kind: 'complete',
              summary: `verify ${developLaunchCount}`,
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
    const resumedDevelopLaunch = launchedRequests.filter((request) => request.title.includes('develop'))[1];
    expect(resumedDevelopLaunch.command).toBe('codex');
    expect(resumedDevelopLaunch.args[0]).toBe('resume');
    expect(resumedDevelopLaunch.args[1]).toBe('node-develop-session-1');
    expect(resumedDevelopLaunch.args).not.toContain('--last');
  }, 15000);

  it('treats a native completion event as terminal even if the session snapshot is later overwritten', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-native-split-engine-'));
    const workflowDir = path.join(tempRoot, 'workspace');
    const workspaceRoot = path.join(workflowDir, '.flowbraid-runs');
    await mkdir(workflowDir, { recursive: true });

    const workflowFile = path.join(workflowDir, 'workflow.yaml');
    const workflowText = `
id: native-split-race-demo
workdir: .
contextDir: .
start: develop
nodes:
  develop:
    type: codex
    mode: exec
    prompt: implement calc
    next: done
  done:
    type: end
    message: done
`;
    await writeFile(workflowFile, workflowText, 'utf8');
    const workflow = await loadWorkflowFile(workflowFile);

    const launcher = {
      async launch(): Promise<{ terminalPid: number }> {
        setTimeout(async () => {
          const runDirs = await readDirNames(workspaceRoot);
          const runDir = path.join(workspaceRoot, runDirs[0]);
          const nodeDir = path.join(runDir, 'nodes', 'develop');
          const sessionPath = getNativeSessionPath(nodeDir);
          const { main: cliMain } = await import('../src/cli.js');

          await cliMain([
            'node',
            'complete',
            '--run-dir',
            runDir,
            '--node-id',
            'develop',
            '--summary',
            'done',
          ]);

          await cliMain([
            'node',
            'artifact',
            '--run-dir',
            runDir,
            '--node-id',
            'develop',
            '--file',
            'artifacts\\develop-last-message.md',
          ]);

          const state = await readFile(sessionPath, 'utf8');
          expect(state).toContain('"status": "completed"');
        }, 50);
        return { terminalPid: 9301 };
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
  }, 15000);
});

async function readDirNames(baseDir: string): Promise<string[]> {
  const fs = await import('node:fs/promises');
  const entries = await fs.readdir(baseDir, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}
