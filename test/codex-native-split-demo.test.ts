import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { loadWorkflowFile } from '../src/workflow.js';
import { resumeWorkflow, startWorkflow } from '../src/engine.js';
import { readJson } from '../src/utils.js';
import { getNativeSessionPath, writeNativeSessionState } from '../src/native-session.js';
import { getNodeRuntimeStatePath, writeNodeRuntimeState } from '../src/node-runtime.js';

describe('codex native split demo', () => {
  it('supports verify rejection, human reject feedback, and final completion in native-split mode', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-native-split-demo-'));
    const workflowDir = path.join(tempRoot, 'workspace');
    const workspaceRoot = path.join(workflowDir, '.flowbraid-runs');
    const examplesDir = path.resolve('examples');
    await mkdir(workflowDir, { recursive: true });
    await copyDir(path.join(examplesDir, 'demo-dev'), path.join(workflowDir, 'demo-dev'));
    await copyDir(path.join(examplesDir, 'demo-verify'), path.join(workflowDir, 'demo-verify'));
    await copyDir(path.join(examplesDir, 'demo-workdir'), path.join(workflowDir, 'demo-workdir'));

    const workflowFile = path.join(workflowDir, 'workflow.yaml');
    const sourceWorkflow = await readFile(path.resolve('examples/codex-native-split-demo.workflow.yaml'), 'utf8');
    await writeFile(workflowFile, sourceWorkflow, 'utf8');

    let developCount = 0;
    let verifyCount = 0;
    const actions: string[] = [];
    const logs: string[] = [];
    const launcher = {
      async launch(request: { title: string; command: string; args: string[] }): Promise<{ terminalPid: number }> {
        const terminalPid = 8000 + developCount + verifyCount;
        actions.push(`launch:${request.title}`);
        if (developCount + verifyCount > 0 && request.title.includes('develop')) {
          const expectedSessionId = developCount === 1 ? 'session-develop-1' : 'session-develop-2';
          expect(request.command).toBe('codex');
          expect(request.args[0]).toBe('resume');
          expect(request.args[1]).toBe(expectedSessionId);
          expect(request.args).not.toContain('--last');
          expect(request.args.at(-1)).toContain('FlowBraid node protocol:');
          expect(request.args.at(-1)).toContain('Re-entry context:');
          expect(request.args.at(-1)).toContain('Command triggers:');
        }
        setTimeout(async () => {
          const runDirs = await readDirNames(workspaceRoot);
          const runDir = path.join(workspaceRoot, runDirs[0]);
          const attemptId = await readCurrentAttemptId(runDir);
          if (request.title.includes('develop')) {
            developCount += 1;
            const nodeDir = path.join(runDir, 'nodes', 'develop');
            const calcPath = path.join(workflowDir, 'demo-workdir', 'calc.js');
            const script =
              developCount === 1
                ? ['const a = Number(process.argv[2]);', 'const b = Number(process.argv[3]);', 'console.log(a + b);', ''].join('\n')
                : [
                    '// Adds two CLI numbers and prints the result.',
                    'const a = Number(process.argv[2]);',
                    'const b = Number(process.argv[3]);',
                    'console.log(a + b);',
                    '',
                  ].join('\n');
            await writeFile(calcPath, script, 'utf8');
            await writeFile(path.join(nodeDir, 'artifacts', 'develop-last-message.md'), `develop round ${developCount}\n`, 'utf8');
            await writeNodeRuntimeState(getNodeRuntimeStatePath(nodeDir), {
              nodeId: 'develop',
              attemptId,
              status: 'completed',
              outcome: 'success',
              sessionId: `session-develop-${developCount}`,
              terminalPid,
              startedAt: '2026-05-05T10:00:00.000Z',
              updatedAt: '2026-05-05T10:00:05.000Z',
              completedAt: '2026-05-05T10:00:05.000Z',
              summary: `develop round ${developCount}`,
            });
            await writeNativeSessionState(getNativeSessionPath(nodeDir), {
              mode: 'native_split_terminal',
              attemptId,
              status: 'completed',
              terminalPid,
              sessionId: `session-develop-${developCount}`,
              startedAt: '2026-05-05T10:00:00.000Z',
              updatedAt: '2026-05-05T10:00:05.000Z',
              completedAt: '2026-05-05T10:00:05.000Z',
              result: {
                kind: 'complete',
                summary: `develop round ${developCount}`,
              },
            });
            return;
          }

          verifyCount += 1;
          const nodeDir = path.join(runDir, 'nodes', 'verify');
          const report =
            verifyCount === 1
              ? [
                  '# verify report',
                  'case 1 2 => 3',
                  'case 10 -4 => 6',
                  'case 1.5 2.5 => 4',
                  'final outcome: reject',
                  'Comments are missing. Add a clear comment in calc.js.',
                  '',
                ].join('\n')
              : [
                  '# verify report',
                  'case 1 2 => 3',
                  'case 10 -4 => 6',
                  'case 1.5 2.5 => 4',
                  'final outcome: approve',
                  'Behavior and comments are acceptable.',
                  '',
                ].join('\n');
          await writeFile(path.join(nodeDir, 'artifacts', 'verify-report.md'), report, 'utf8');
          await writeNodeRuntimeState(getNodeRuntimeStatePath(nodeDir), {
            nodeId: 'verify',
            attemptId,
            status: 'completed',
            outcome: verifyCount === 1 ? 'reject' : 'approve',
            sessionId: `session-verify-${verifyCount}`,
            terminalPid,
            startedAt: '2026-05-05T10:00:10.000Z',
            updatedAt: '2026-05-05T10:00:15.000Z',
            completedAt: '2026-05-05T10:00:15.000Z',
            summary: verifyCount === 1 ? 'verify reject' : 'verify approve',
          });
          await writeNativeSessionState(getNativeSessionPath(nodeDir), {
            mode: 'native_split_terminal',
            attemptId,
            status: 'completed',
            terminalPid,
            sessionId: `session-verify-${verifyCount}`,
            startedAt: '2026-05-05T10:00:10.000Z',
            updatedAt: '2026-05-05T10:00:15.000Z',
            completedAt: '2026-05-05T10:00:15.000Z',
            result: {
              kind: 'complete',
              summary: verifyCount === 1 ? 'verify reject' : 'verify approve',
            },
          });
        }, 50);
        return { terminalPid };
      },
      async close(terminalPid: number): Promise<void> {
        actions.push(`close:${terminalPid}`);
        return;
      },
    };

    const workflow = await loadWorkflowFile(workflowFile);
    const firstResult = await startWorkflow(workflow, {
      workspaceRoot,
      nativeSplitTerminals: true,
      interactiveTerminal: { input: process.stdin, output: process.stdout },
      externalTerminalLauncher: launcher,
      logger: (line) => logs.push(line),
    });

    expect(firstResult.status).toBe('paused');
    expect(firstResult.currentNodeId).toBe('review');

    const rejectResult = await resumeWorkflow(firstResult.runDir, {
      approvalDecision: 'reject',
      approvalComment: 'Please add a brief usage note in the final review.',
      nativeSplitTerminals: true,
      interactiveTerminal: { input: process.stdin, output: process.stdout },
      externalTerminalLauncher: launcher,
      logger: (line) => logs.push(line),
    });

    expect(rejectResult.status).toBe('paused');
    expect(rejectResult.currentNodeId).toBe('review');

    const reviewApproved = await resumeWorkflow(firstResult.runDir, {
      approvalDecision: 'approve',
      nativeSplitTerminals: true,
      interactiveTerminal: { input: process.stdin, output: process.stdout },
      externalTerminalLauncher: launcher,
      logger: (line) => logs.push(line),
    });

    expect(reviewApproved.status).toBe('paused');
    // approve review -> run verify (reject) -> route to develop -> pause again at review
    expect(reviewApproved.currentNodeId).toBe('review');

    const finalResult = await resumeWorkflow(firstResult.runDir, {
      approvalDecision: 'approve',
      nativeSplitTerminals: true,
      interactiveTerminal: { input: process.stdin, output: process.stdout },
      externalTerminalLauncher: launcher,
      logger: (line) => logs.push(line),
    });

    // approve review -> run verify (approve) -> pause at final approve node
    expect(finalResult.status).toBe('paused');
    expect(finalResult.currentNodeId).toBe('approve');

    const finalApproval = await resumeWorkflow(firstResult.runDir, {
      approvalDecision: 'approve',
      nativeSplitTerminals: true,
      interactiveTerminal: { input: process.stdin, output: process.stdout },
      externalTerminalLauncher: launcher,
      logger: (line) => logs.push(line),
    });

    expect(finalApproval.status).toBe('completed');

    const calcScript = await readFile(path.join(workflowDir, 'demo-workdir', 'calc.js'), 'utf8');
    expect(calcScript).toContain('Adds two CLI numbers');

    const feedback = await readFile(path.join(firstResult.runDir, 'messages', 'human-feedback.jsonl'), 'utf8');
    expect(feedback).toContain('"decision":"reject"');

    const finalState = await readJson<{ status: string }>(path.join(firstResult.runDir, 'state', 'run.json'));
    expect(finalState.status).toBe('completed');
    expect(actions.findIndex((entry) => entry.startsWith('close:'))).toBeGreaterThan(-1);
    expect(logs.some((line) => line.includes('[run] step 1: enter node prepare'))).toBe(true);
    expect(logs.some((line) => line.includes('[native] launch develop via new codex session'))).toBe(true);
    expect(logs.some((line) => line.includes('[run] node verify failed, route to develop'))).toBe(true);
    expect(logs.some((line) => line.includes('[run] paused at approve'))).toBe(true);
  }, 20000);
});

async function copyDir(sourceDir: string, targetDir: string): Promise<void> {
  const fs = await import('node:fs/promises');
  await fs.mkdir(targetDir, { recursive: true });
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(sourceDir, entry.name);
    const to = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await copyDir(from, to);
      continue;
    }
    await fs.copyFile(from, to);
  }
}

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
