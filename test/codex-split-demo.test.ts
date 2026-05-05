import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { loadWorkflowFile } from '../src/workflow.js';
import { resumeWorkflow, startWorkflow } from '../src/engine.js';
import { readJson } from '../src/utils.js';
import { getExternalSessionPath, writeExternalSessionState } from '../src/external-session.js';

describe('codex split demo', () => {
  it('在 split-terminal 模式下支持验收打回、人工 reject 再回流并最终完成', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-split-demo-'));
    const workflowDir = path.join(tempRoot, 'workspace');
    const workspaceRoot = path.join(workflowDir, '.flowbraid-runs');
    const examplesDir = path.resolve('examples');
    await mkdir(workflowDir, { recursive: true });
    await copyDir(path.join(examplesDir, 'demo-dev'), path.join(workflowDir, 'demo-dev'));
    await copyDir(path.join(examplesDir, 'demo-verify'), path.join(workflowDir, 'demo-verify'));
    await copyDir(path.join(examplesDir, 'demo-workdir'), path.join(workflowDir, 'demo-workdir'));

    const workflowFile = path.join(workflowDir, 'workflow.yaml');
    const sourceWorkflow = await readFile(path.resolve('examples/codex-split-demo.workflow.yaml'), 'utf8');
    await writeFile(workflowFile, sourceWorkflow, 'utf8');

    let developCount = 0;
    let verifyCount = 0;
    const launcher = {
      async launch(request: { title: string; workingDirectory: string; command: string; args: string[] }): Promise<{ terminalPid: number }> {
        const terminalPid = 5000 + developCount + verifyCount;
        setTimeout(async () => {
          const runDirs = await readDirNames(workspaceRoot);
          const runDir = path.join(workspaceRoot, runDirs[0]);
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
            await writeExternalSessionState(getExternalSessionPath(nodeDir), {
              mode: 'detached_terminal',
              status: 'completed',
              startedAt: '2026-05-03T10:00:00.000Z',
              updatedAt: '2026-05-03T10:00:05.000Z',
              completedAt: '2026-05-03T10:00:05.000Z',
              terminalPid,
              workerPid: 7001,
              exitCode: 0,
              resultFile: 'artifacts/develop-last-message.md',
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
                  'verdict: reject',
                  'Comments are missing. Add a clear comment in calc.js.',
                  '',
                ].join('\n')
              : [
                  '# verify report',
                  'case 1 2 => 3',
                  'case 10 -4 => 6',
                  'case 1.5 2.5 => 4',
                  'verdict: approve',
                  'Behavior and comments are acceptable.',
                  '',
                ].join('\n');
          await writeFile(path.join(nodeDir, 'artifacts', 'verify-report.md'), report, 'utf8');
          await writeExternalSessionState(getExternalSessionPath(nodeDir), {
            mode: 'detached_terminal',
            status: verifyCount === 1 ? 'failed' : 'completed',
            startedAt: '2026-05-03T10:00:10.000Z',
            updatedAt: '2026-05-03T10:00:15.000Z',
            completedAt: '2026-05-03T10:00:15.000Z',
            terminalPid,
            workerPid: 7002,
            exitCode: 0,
            resultFile: 'artifacts/verify-report.md',
          });
        }, 50);
        return { terminalPid };
      },
      async close(): Promise<void> {
        return;
      },
    };

    const workflow = await loadWorkflowFile(workflowFile);
    const firstResult = await startWorkflow(workflow, {
      workspaceRoot,
      splitTerminals: true,
      interactiveTerminal: { input: process.stdin, output: process.stdout },
      externalTerminalLauncher: launcher,
    });

    expect(firstResult.status).toBe('paused');
    expect(firstResult.currentNodeId).toBe('approve');

    const rejectResult = await resumeWorkflow(firstResult.runDir, {
      approvalDecision: 'reject',
      approvalComment: 'Please add a brief usage note in the final review.',
      splitTerminals: true,
      interactiveTerminal: { input: process.stdin, output: process.stdout },
      externalTerminalLauncher: launcher,
    });

    expect(rejectResult.status).toBe('paused');
    expect(rejectResult.currentNodeId).toBe('approve');

    const finalResult = await resumeWorkflow(firstResult.runDir, {
      approvalDecision: 'approve',
      splitTerminals: true,
      interactiveTerminal: { input: process.stdin, output: process.stdout },
      externalTerminalLauncher: launcher,
    });

    expect(finalResult.status).toBe('completed');

    const calcScript = await readFile(path.join(workflowDir, 'demo-workdir', 'calc.js'), 'utf8');
    expect(calcScript).toContain('Adds two CLI numbers');

    const feedback = await readFile(path.join(firstResult.runDir, 'messages', 'human-feedback.jsonl'), 'utf8');
    expect(feedback).toContain('"decision":"reject"');

    const finalState = await readJson<{ status: string }>(path.join(firstResult.runDir, 'state', 'run.json'));
    expect(finalState.status).toBe('completed');
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
