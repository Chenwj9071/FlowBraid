import path from 'node:path';
import os from 'node:os';
import { chmod, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { loadWorkflowFile } from '../src/workflow.js';
import { startWorkflow } from '../src/engine.js';
import { readJson } from '../src/utils.js';

async function createFakeBlockingCodex(binDir: string): Promise<string> {
  const fakeScript = `
process.stdout.write('fake codex exec ready\\n');
setInterval(() => {
  process.stdout.write('fake codex still running\\n');
}, 1000);
`;

  const scriptPath = path.join(binDir, 'fake-codex.js');
  const cmdPath = path.join(binDir, 'codex.cmd');
  const shPath = path.join(binDir, 'codex');
  await writeFile(scriptPath, fakeScript, 'utf8');
  await writeFile(cmdPath, '@echo off\r\nnode "%~dp0fake-codex.js" %*\r\n', 'utf8');
  await writeFile(shPath, '#!/usr/bin/env sh\nnode "$(dirname "$0")/fake-codex.js" "$@"\n', 'utf8');
  await chmod(shPath, 0o755);
  return process.platform === 'win32' ? cmdPath : shPath;
}

describe('运行中断处理', () => {
  it('abortSignal 触发后会终止当前 run 并落盘失败原因', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-run-interrupt-'));
    const workflowDir = path.join(tempRoot, 'workspace');
    const binDir = path.join(tempRoot, 'bin');
    await mkdir(workflowDir, { recursive: true });
    await mkdir(binDir, { recursive: true });
    const codexCommand = await createFakeBlockingCodex(binDir);

    const workflowFile = path.join(workflowDir, 'workflow.yaml');
    const workflowContent = `
id: interrupt-demo
start: develop
nodes:
  develop:
    type: codex
    mode: exec
    prompt: write something and keep running
    next: done
  done:
    type: end
    message: done
`;
    await writeFile(workflowFile, workflowContent, 'utf8');
    const workflow = await loadWorkflowFile(workflowFile);

    const controller = new AbortController();
    setTimeout(() => {
      controller.abort();
    }, 400);

    const result = await startWorkflow(workflow, {
      codexCommand,
      abortSignal: controller.signal,
    });

    expect(result.status).toBe('failed');

    const runState = await readJson<{ status: string; failedReason?: string; currentNodeId: string | null }>(
      path.join(result.runDir, 'state', 'run.json'),
    );
    expect(runState.status).toBe('failed');
    expect(runState.failedReason).toBe('用户中断运行');
    expect(runState.currentNodeId).toBe('develop');

    const nodeState = await readJson<{ status: string; exitCode?: number; signal?: string; detail?: string }>(
      path.join(result.runDir, 'nodes', 'develop', 'status.json'),
    );
    expect(nodeState.status).toBe('failed');
    expect(nodeState.exitCode).toBe(130);
    expect(nodeState.signal).toBe('SIGINT');
    expect(nodeState.detail).toBe('用户中断运行');
  }, 30000);
});
