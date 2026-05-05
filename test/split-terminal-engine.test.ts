import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { loadWorkflowFile } from '../src/workflow.js';
import { startWorkflow } from '../src/engine.js';
import { getExternalSessionPath, writeExternalSessionState } from '../src/external-session.js';

describe('split terminal engine', () => {
  it('主进程等待 external session 完成并主动关闭窗口', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-split-engine-'));
    const workflowDir = path.join(tempRoot, 'workspace');
    const workspaceRoot = path.join(workflowDir, '.flowbraid-runs');
    await mkdir(workflowDir, { recursive: true });

    const workflowFile = path.join(workflowDir, 'workflow.yaml');
    const workflowText = `
id: split-engine-demo
workdir: .
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
    const launcher = {
      async launch(): Promise<{ terminalPid: number }> {
        const runRoot = workspaceRoot;
        setTimeout(async () => {
          const runDirs = await readDirNames(runRoot);
          const runDir = path.join(runRoot, runDirs[0]);
          const sessionPath = getExternalSessionPath(path.join(runDir, 'nodes', 'develop'));
          await writeExternalSessionState(sessionPath, {
            mode: 'detached_terminal',
            status: 'completed',
            startedAt: '2026-05-03T10:00:00.000Z',
            updatedAt: '2026-05-03T10:00:10.000Z',
            completedAt: '2026-05-03T10:00:10.000Z',
            terminalPid: 9001,
            workerPid: 9002,
            exitCode: 0,
            resultFile: 'artifacts/develop.md',
          });
          await writeFile(path.join(runDir, 'nodes', 'develop', 'artifacts', 'develop.md'), '# develop complete\n', 'utf8');
        }, 50);
        return { terminalPid: 9001 };
      },
      async close(terminalPid: number): Promise<void> {
        closedTerminalPids.push(terminalPid);
      },
    };

    const result = await startWorkflow(workflow, {
      workspaceRoot,
      splitTerminals: true,
      interactiveTerminal: { input: process.stdin, output: process.stdout },
      externalTerminalLauncher: launcher,
    });

    expect(result.status).toBe('completed');
    expect(closedTerminalPids).toEqual([9001]);

    const events = await readFile(path.join(result.runDir, 'messages', 'events.jsonl'), 'utf8');
    expect(events).toContain('"type":"terminal.launched"');
    expect(events).toContain('"type":"terminal.closed"');
  });
});

async function readDirNames(baseDir: string): Promise<string[]> {
  const fs = await import('node:fs/promises');
  const entries = await fs.readdir(baseDir, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}
