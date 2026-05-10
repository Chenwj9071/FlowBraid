import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { loadWorkflowFile } from '../src/workflow.js';
import { startWorkflow } from '../src/engine.js';
import { getNativeSessionPath, writeNativeSessionState } from '../src/native-session.js';
import { appendText } from '../src/utils.js';
import { getNodeRuntimeStatePath, writeNodeRuntimeState } from '../src/node-runtime.js';

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
    const closeRequests: Array<{ terminalPid: number; title?: string; timeoutMs?: number }> = [];
    const launcher = {
      async launch(request: { command: string; args: string[] }): Promise<{ terminalPid: number }> {
        launchedRequests.push({ command: request.command, args: request.args });
        setTimeout(async () => {
          const runDirs = await readDirNames(workspaceRoot);
          const runDir = path.join(workspaceRoot, runDirs[0]);
          const nodeDir = path.join(runDir, 'nodes', 'develop');
          const sessionPath = getNativeSessionPath(nodeDir);
          const attemptId = await readCurrentAttemptId(runDir);
          await writeFile(path.join(nodeDir, 'artifacts', 'develop.md'), '# develop complete\n', 'utf8');
          await writeNodeRuntimeState(getNodeRuntimeStatePath(nodeDir), {
            nodeId: 'develop',
            attemptId,
            status: 'completed',
            outcome: 'success',
            terminalPid: 9101,
            startedAt: '2026-05-05T00:00:00.000Z',
            updatedAt: '2026-05-05T00:00:30.000Z',
            completedAt: '2026-05-05T00:00:30.000Z',
            summary: 'developed calc.js',
          });
          await writeNativeSessionState(sessionPath, {
            mode: 'native_split_terminal',
            attemptId,
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
      async close(terminalPid: number, options?: { timeoutMs?: number; title?: string }): Promise<void> {
        closeRequests.push({ terminalPid, title: options?.title, timeoutMs: options?.timeoutMs });
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
    expect(closeRequests).toEqual([
      {
        terminalPid: 9101,
        title: expect.stringContaining('FlowBraid native develop ['),
        timeoutMs: expect.any(Number),
      },
    ]);
    expect(launchedRequests).toHaveLength(1);
    expect(launchedRequests[0].command).toBe('codex');
    expect(launchedRequests[0].args.join(' ')).not.toContain('run-codex-node');

    const events = await readFile(path.join(result.runDir, 'messages', 'events.jsonl'), 'utf8');
    expect(events).toContain('"type":"terminal.launched"');
    expect(events).toContain('"type":"terminal.closed"');
  });

  it('keeps a completed native node successful even when terminal close fails on Windows', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-native-split-engine-'));
    const workflowDir = path.join(tempRoot, 'workspace');
    const workspaceRoot = path.join(workflowDir, '.flowbraid-runs');
    await mkdir(workflowDir, { recursive: true });

    const workflowFile = path.join(workflowDir, 'workflow.yaml');
    const workflowText = `
id: native-split-close-failure-demo
workdir: .
contextDir: .
start: develop
nodes:
  develop:
    type: codex
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
          const attemptId = await readCurrentAttemptId(runDir);
          await writeFile(path.join(nodeDir, 'artifacts', 'develop.md'), '# develop complete\n', 'utf8');
          await writeNodeRuntimeState(getNodeRuntimeStatePath(nodeDir), {
            nodeId: 'develop',
            attemptId,
            status: 'completed',
            outcome: 'success',
            terminalPid: 9401,
            sessionId: 'develop-session-close-failure',
            startedAt: '2026-05-06T00:00:00.000Z',
            updatedAt: '2026-05-06T00:00:30.000Z',
            completedAt: '2026-05-06T00:00:30.000Z',
            summary: 'developed calc.js',
          });
          await writeNativeSessionState(sessionPath, {
            mode: 'native_split_terminal',
            attemptId,
            status: 'completed',
            terminalPid: 9401,
            sessionId: 'develop-session-close-failure',
            startedAt: '2026-05-06T00:00:00.000Z',
            updatedAt: '2026-05-06T00:00:30.000Z',
            completedAt: '2026-05-06T00:00:30.000Z',
            result: {
              kind: 'complete',
              summary: 'developed calc.js',
            },
          });
        }, 50);
        return { terminalPid: 9401 };
      },
      async close(): Promise<void> {
        throw new Error('taskkill failed');
      },
    };

    const result = await startWorkflow(workflow, {
      workspaceRoot,
      nativeSplitTerminals: true,
      interactiveTerminal: { input: process.stdin, output: process.stdout },
      externalTerminalLauncher: launcher,
    });

    expect(result.status).toBe('completed');
    const events = await readFile(path.join(result.runDir, 'messages', 'events.jsonl'), 'utf8');
    expect(events).toContain('"type":"terminal.close_ignored"');
    expect(events).toContain('"type":"terminal.closed"');
  });

  it('waits for configured terminal close grace before closing native terminals', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-native-split-grace-'));
    const workflowDir = path.join(tempRoot, 'workspace');
    const workspaceRoot = path.join(workflowDir, '.flowbraid-runs');
    await mkdir(workflowDir, { recursive: true });

    const workflowFile = path.join(workflowDir, 'workflow.yaml');
    await writeFile(
      workflowFile,
      `
id: native-split-close-grace-demo
workdir: .
contextDir: .
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

    let completedAt = 0;
    let closeAt = 0;
    const launcher = {
      async launch(): Promise<{ terminalPid: number }> {
        setTimeout(async () => {
          const runDirs = await readDirNames(workspaceRoot);
          const runDir = path.join(workspaceRoot, runDirs[0]);
          const nodeDir = path.join(runDir, 'nodes', 'develop');
          const attemptId = await readCurrentAttemptId(runDir);
          completedAt = Date.now();
          await writeNodeRuntimeState(getNodeRuntimeStatePath(nodeDir), {
            nodeId: 'develop',
            attemptId,
            status: 'completed',
            outcome: 'success',
            terminalPid: 9501,
            startedAt: '2026-05-06T00:00:00.000Z',
            updatedAt: '2026-05-06T00:00:05.000Z',
            completedAt: '2026-05-06T00:00:05.000Z',
            summary: 'done',
          });
          await writeNativeSessionState(getNativeSessionPath(nodeDir), {
            mode: 'native_split_terminal',
            attemptId,
            status: 'completed',
            terminalPid: 9501,
            startedAt: '2026-05-06T00:00:00.000Z',
            updatedAt: '2026-05-06T00:00:05.000Z',
            completedAt: '2026-05-06T00:00:05.000Z',
            result: { kind: 'complete', summary: 'done' },
          });
        }, 20);
        return { terminalPid: 9501 };
      },
      async close(): Promise<void> {
        closeAt = Date.now();
      },
    };

    const result = await startWorkflow(workflow, {
      workspaceRoot,
      nativeSplitTerminals: true,
      terminalCloseGraceMs: 200,
      interactiveTerminal: { input: process.stdin, output: process.stdout },
      externalTerminalLauncher: launcher,
    });

    expect(result.status).toBe('completed');
    expect(closeAt).toBeGreaterThanOrEqual(completedAt + 180);
  });

  it('does not let terminal close timeout block workflow completion for long', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-native-split-close-timeout-'));
    const workflowDir = path.join(tempRoot, 'workspace');
    const workspaceRoot = path.join(workflowDir, '.flowbraid-runs');
    await mkdir(workflowDir, { recursive: true });

    const workflowFile = path.join(workflowDir, 'workflow.yaml');
    await writeFile(
      workflowFile,
      `
id: native-split-close-timeout-demo
workdir: .
contextDir: .
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

    const startedAt = Date.now();
    const launcher = {
      async launch(): Promise<{ terminalPid: number }> {
        setTimeout(async () => {
          const runDirs = await readDirNames(workspaceRoot);
          const runDir = path.join(workspaceRoot, runDirs[0]);
          const nodeDir = path.join(runDir, 'nodes', 'develop');
          const attemptId = await readCurrentAttemptId(runDir);
          await writeNodeRuntimeState(getNodeRuntimeStatePath(nodeDir), {
            nodeId: 'develop',
            attemptId,
            status: 'completed',
            outcome: 'success',
            terminalPid: 9601,
            startedAt: '2026-05-07T00:00:00.000Z',
            updatedAt: '2026-05-07T00:00:01.000Z',
            completedAt: '2026-05-07T00:00:01.000Z',
            summary: 'done',
          });
          await writeNativeSessionState(getNativeSessionPath(nodeDir), {
            mode: 'native_split_terminal',
            attemptId,
            status: 'completed',
            terminalPid: 9601,
            startedAt: '2026-05-07T00:00:00.000Z',
            updatedAt: '2026-05-07T00:00:01.000Z',
            completedAt: '2026-05-07T00:00:01.000Z',
            result: { kind: 'complete', summary: 'done' },
          });
        }, 20);
        return { terminalPid: 9601 };
      },
      async close(_terminalPid: number, options?: { timeoutMs?: number }): Promise<void> {
        const waitMs = (options?.timeoutMs ?? 50) + 200;
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      },
    };

    const result = await startWorkflow(workflow, {
      workspaceRoot,
      nativeSplitTerminals: true,
      terminalCloseGraceMs: 10,
      terminalCloseTimeoutMs: 50,
      interactiveTerminal: { input: process.stdin, output: process.stdout },
      externalTerminalLauncher: launcher,
    });

    const elapsed = Date.now() - startedAt;
    expect(result.status).toBe('completed');
    expect(elapsed).toBeLessThan(3000);
    const events = await readFile(path.join(result.runDir, 'messages', 'events.jsonl'), 'utf8');
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
          const attemptId = await readCurrentAttemptId(runDir);
          if (request.title.includes('develop')) {
            developLaunchCount += 1;
            const nodeDir = path.join(runDir, 'nodes', 'develop');
            await writeFile(path.join(nodeDir, 'artifacts', 'develop.md'), '# develop complete\n', 'utf8');
            await writeNodeRuntimeState(getNodeRuntimeStatePath(nodeDir), {
              nodeId: 'develop',
              attemptId,
              status: 'completed',
              outcome: 'success',
              terminalPid,
              sessionId: 'node-develop-session-1',
              startedAt: '2026-05-05T00:00:00.000Z',
              updatedAt: '2026-05-05T00:00:10.000Z',
              completedAt: '2026-05-05T00:00:10.000Z',
              summary: `develop ${developLaunchCount}`,
            });
            await writeNativeSessionState(getNativeSessionPath(nodeDir), {
              mode: 'native_split_terminal',
              attemptId,
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
            developLaunchCount === 1 ? 'outcome hint: reject\n' : 'outcome hint: approve\n',
            'utf8',
          );
          await writeNodeRuntimeState(getNodeRuntimeStatePath(nodeDir), {
            nodeId: 'verify',
            attemptId,
            status: 'completed',
            outcome: developLaunchCount === 1 ? 'reject' : 'approve',
            terminalPid,
            sessionId: `node-verify-session-${developLaunchCount}`,
            startedAt: '2026-05-05T00:00:20.000Z',
            updatedAt: '2026-05-05T00:00:30.000Z',
            completedAt: '2026-05-05T00:00:30.000Z',
            summary: `verify ${developLaunchCount}`,
          });
          await writeNativeSessionState(getNativeSessionPath(nodeDir), {
            mode: 'native_split_terminal',
            attemptId,
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
    const developLaunches = launchedRequests.filter((request) => request.title.includes('develop'));
    const resumedDevelopLaunch = developLaunches.at(-1);
    expect(resumedDevelopLaunch).toBeDefined();
    expect(resumedDevelopLaunch).toBeDefined();
    expect(resumedDevelopLaunch!.command).toBe('codex');
    expect(resumedDevelopLaunch!.args).toContain('--cd');
    expect(resumedDevelopLaunch!.args).toContain('node-develop-session-1');
    expect(resumedDevelopLaunch!.args).toContain('node-develop-session-1');
    expect(resumedDevelopLaunch!.args).not.toContain('--last');
    expect(resumedDevelopLaunch!.args.at(-1)).toContain('## Re-entry Priority');
    expect(resumedDevelopLaunch!.args.at(-1)).toContain('## Required Commands');
    expect(resumedDevelopLaunch!.args.at(-1)).toContain('node fail --run-dir');
    expect(resumedDevelopLaunch!.args.at(-1)).toContain('--message "explain the failure"');
    expect(resumedDevelopLaunch!.args.at(-1)).not.toContain('verify.report.path');
    const developStatus = JSON.parse(await readFile(path.join(result.runDir, 'nodes', 'develop', 'status.json'), 'utf8')) as {
      sessionId?: string;
    };
    expect(developStatus.sessionId).toBe('node-develop-session-1');
  }, 15000);

  it('falls back to a fresh session when reentry defaults to resume but no prior session id exists', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-native-split-engine-'));
    const workflowDir = path.join(tempRoot, 'workspace');
    const workspaceRoot = path.join(workflowDir, '.flowbraid-runs');
    await mkdir(workflowDir, { recursive: true });

    const workflowFile = path.join(workflowDir, 'workflow.yaml');
    const workflowText = `
id: native-split-default-reentry-fallback-demo
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
`;
    await writeFile(workflowFile, workflowText, 'utf8');
    const workflow = await loadWorkflowFile(workflowFile);

    let developLaunchCount = 0;
    const launchedRequests: Array<{ title: string; command: string; args: string[] }> = [];
    const launcher = {
      async launch(request: { title: string; command: string; args: string[] }): Promise<{ terminalPid: number }> {
        launchedRequests.push({ title: request.title, command: request.command, args: request.args });
        const terminalPid = 9700 + launchedRequests.length;
        setTimeout(async () => {
          const runDirs = await readDirNames(workspaceRoot);
          const runDir = path.join(workspaceRoot, runDirs[0]);
          const attemptId = await readCurrentAttemptId(runDir);
          if (request.title.includes('develop')) {
            developLaunchCount += 1;
            const nodeDir = path.join(runDir, 'nodes', 'develop');
            await writeFile(path.join(nodeDir, 'artifacts', 'develop.md'), '# develop complete\n', 'utf8');
            await writeNodeRuntimeState(getNodeRuntimeStatePath(nodeDir), {
              nodeId: 'develop',
              attemptId,
              status: 'completed',
              outcome: 'success',
              terminalPid,
              sessionId: 'node-develop-session-1',
              startedAt: '2026-05-05T00:00:00.000Z',
              updatedAt: '2026-05-05T00:00:10.000Z',
              completedAt: '2026-05-05T00:00:10.000Z',
              summary: `develop ${developLaunchCount}`,
            });
            await writeNativeSessionState(getNativeSessionPath(nodeDir), {
              mode: 'native_split_terminal',
              attemptId,
              status: 'completed',
              terminalPid,
              startedAt: '2026-05-06T00:00:00.000Z',
              updatedAt: '2026-05-06T00:00:10.000Z',
              completedAt: '2026-05-06T00:00:10.000Z',
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
            developLaunchCount === 1 ? 'outcome hint: reject\n' : 'outcome hint: approve\n',
            'utf8',
          );
          await writeNodeRuntimeState(getNodeRuntimeStatePath(nodeDir), {
            nodeId: 'verify',
            attemptId,
            status: 'completed',
            outcome: developLaunchCount === 1 ? 'reject' : 'approve',
            terminalPid,
            sessionId: `node-verify-session-${developLaunchCount}`,
            startedAt: '2026-05-05T00:00:20.000Z',
            updatedAt: '2026-05-05T00:00:30.000Z',
            completedAt: '2026-05-05T00:00:30.000Z',
            summary: `verify ${developLaunchCount}`,
          });
          await writeNativeSessionState(getNativeSessionPath(nodeDir), {
            mode: 'native_split_terminal',
            attemptId,
            status: 'completed',
            terminalPid,
            sessionId: `node-verify-session-${developLaunchCount}`,
            startedAt: '2026-05-06T00:00:20.000Z',
            updatedAt: '2026-05-06T00:00:30.000Z',
            completedAt: '2026-05-06T00:00:30.000Z',
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
    expect(resumedDevelopLaunch.args[0]).not.toBe('resume');
    expect(resumedDevelopLaunch.args.at(-1)).toContain('## Re-entry Priority');
    expect(resumedDevelopLaunch.args.at(-1)).toContain('from:');
    expect(resumedDevelopLaunch.args.at(-1)).toContain('reason:');
    expect(resumedDevelopLaunch.args.at(-1)).toContain('## FlowBraid Protocol');
    expect(resumedDevelopLaunch.args.at(-1)).toContain('## Required Commands');
  }, 15000);

  it('does not adopt another node session id from the shared workdir when the current node did not report one', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-native-split-engine-'));
    const workflowDir = path.join(tempRoot, 'workspace');
    const workspaceRoot = path.join(workflowDir, '.flowbraid-runs');
    await mkdir(workflowDir, { recursive: true });

    const workflowFile = path.join(workflowDir, 'workflow.yaml');
    const workflowText = `
id: native-split-session-isolation-demo
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
`;
    await writeFile(workflowFile, workflowText, 'utf8');
    const workflow = await loadWorkflowFile(workflowFile);

    let developLaunchCount = 0;
    const launchedRequests: Array<{ title: string; command: string; args: string[] }> = [];
    const launcher = {
      async launch(request: { title: string; command: string; args: string[] }): Promise<{ terminalPid: number }> {
        launchedRequests.push({ title: request.title, command: request.command, args: request.args });
        const terminalPid = 9500 + launchedRequests.length;
        setTimeout(async () => {
          const runDirs = await readDirNames(workspaceRoot);
          const runDir = path.join(workspaceRoot, runDirs[0]);
          const attemptId = await readCurrentAttemptId(runDir);
          if (request.title.includes('develop')) {
            developLaunchCount += 1;
            const nodeDir = path.join(runDir, 'nodes', 'develop');
            await writeFile(path.join(nodeDir, 'artifacts', 'develop.md'), '# develop complete\n', 'utf8');
            await writeNativeSessionState(getNativeSessionPath(nodeDir), {
              mode: 'native_split_terminal',
              attemptId,
              status: 'completed',
              terminalPid,
              sessionId: developLaunchCount === 1 ? 'node-develop-session-1' : undefined,
              startedAt: '2026-05-06T00:00:00.000Z',
              updatedAt: '2026-05-06T00:00:10.000Z',
              completedAt: '2026-05-06T00:00:10.000Z',
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
            developLaunchCount === 1 ? 'outcome hint: reject\n' : 'outcome hint: approve\n',
            'utf8',
          );
          await writeNativeSessionState(getNativeSessionPath(nodeDir), {
            mode: 'native_split_terminal',
            attemptId,
            status: 'completed',
            terminalPid,
            sessionId: `node-verify-session-${developLaunchCount}`,
            startedAt: '2026-05-06T00:00:20.000Z',
            updatedAt: '2026-05-06T00:00:30.000Z',
            completedAt: '2026-05-06T00:00:30.000Z',
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
    const resumedDevelopLaunch = launchedRequests.filter((request) => request.title.includes('develop')).at(-1);
    expect(resumedDevelopLaunch).toBeDefined();
    expect(resumedDevelopLaunch!.command).toBe('codex');
    expect(resumedDevelopLaunch!.args).toContain('--cd');
    expect(resumedDevelopLaunch!.args).not.toContain('node-verify-session-1');
  }, 15000);

  it('does not let a previous attempt completion event terminate a new native attempt', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-native-split-engine-'));
    const workflowDir = path.join(tempRoot, 'workspace');
    const workspaceRoot = path.join(workflowDir, '.flowbraid-runs');
    await mkdir(workflowDir, { recursive: true });

    const workflowFile = path.join(workflowDir, 'workflow.yaml');
    const workflowText = `
id: native-split-attempt-isolation-demo
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
`;
    await writeFile(workflowFile, workflowText, 'utf8');
    const workflow = await loadWorkflowFile(workflowFile);

    let developLaunchCount = 0;
    const launcher = {
      async launch(request: { title: string }): Promise<{ terminalPid: number }> {
        setTimeout(async () => {
          const runDirs = await readDirNames(workspaceRoot);
          const runDir = path.join(workspaceRoot, runDirs[0]);
          const { main: cliMain } = await import('../src/cli.js');
          const runState = JSON.parse(await readFile(path.join(runDir, 'state', 'run.json'), 'utf8')) as {
            currentNodeId: string | null;
            currentAttemptId?: string | null;
          };
          const nodeId = runState.currentNodeId!;
          const attemptId = runState.currentAttemptId!;

          if (request.title.includes('develop')) {
            developLaunchCount += 1;
            const developNodeDir = path.join(runDir, 'nodes', 'develop');
            if (developLaunchCount === 2) {
              await appendText(
                path.join(runDir, 'messages', 'events.jsonl'),
                `${JSON.stringify({
                  type: 'node.native.completed',
                  nodeId: 'develop',
                  attemptId: 'stale-attempt',
                  at: '2026-05-06T00:00:00.000Z',
                  summary: 'stale-complete',
                })}\n`,
              );
            }
            await writeFile(path.join(developNodeDir, 'artifacts', 'develop.md'), '# develop complete\n', 'utf8');
            await cliMain([
              'node',
              'complete',
              '--run-dir',
              runDir,
              '--node-id',
              nodeId,
              '--attempt-id',
              attemptId,
              '--outcome',
              'success',
              '--summary',
              `develop-${developLaunchCount}`,
            ]);
            return;
          }

          const verifyNodeDir = path.join(runDir, 'nodes', 'verify');
          await writeFile(
            path.join(verifyNodeDir, 'artifacts', 'codex-last-message.md'),
            developLaunchCount === 1 ? 'outcome hint: reject\n' : 'outcome hint: approve\n',
            'utf8',
          );
          await cliMain([
            'node',
            'complete',
            '--run-dir',
            runDir,
              '--node-id',
              nodeId,
              '--attempt-id',
              attemptId,
              '--outcome',
              developLaunchCount === 1 ? 'reject' : 'approve',
              '--summary',
              `verify-${developLaunchCount}`,
            ]);
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
    const timeline = JSON.parse(await readFile(path.join(result.runDir, 'state', 'timeline.json'), 'utf8')) as Array<{
      nodeId: string;
      attemptId: string;
      status: string;
    }>;
    const developAttempts = timeline.filter((entry) => entry.nodeId === 'develop');
    expect(developAttempts).toHaveLength(2);
    expect(developAttempts[0].attemptId).not.toBe(developAttempts[1].attemptId);
    expect(developAttempts.every((entry) => entry.status === 'succeeded')).toBe(true);
  }, 15000);
});

async function readDirNames(baseDir: string): Promise<string[]> {
  const fs = await import('node:fs/promises');
  const entries = await fs.readdir(baseDir, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

async function readCurrentAttemptId(runDir: string): Promise<string> {
  const runState = JSON.parse(await readFile(path.join(runDir, 'state', 'run.json'), 'utf8')) as {
    currentAttemptId?: string | null;
  };
  if (!runState.currentAttemptId) {
    throw new Error(`Missing currentAttemptId for run ${runDir}`);
  }
  return runState.currentAttemptId;
}

