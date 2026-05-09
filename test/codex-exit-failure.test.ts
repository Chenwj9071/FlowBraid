import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { loadWorkflowFile } from '../src/workflow.js';
import { startWorkflow } from '../src/engine.js';
import { readJson } from '../src/utils.js';

async function createAlwaysFailCodex(binDir: string): Promise<void> {
  const fakeScript = [
    "console.error('limit exceeded');",
    'process.exit(1);',
  ].join('\n');

  const scriptPath = path.join(binDir, 'always-fail-codex.js');
  const cmdPath = path.join(binDir, 'codex.cmd');
  await writeFile(scriptPath, fakeScript, 'utf8');
  await writeFile(cmdPath, '@echo off\r\nnode "%~dp0always-fail-codex.js" %*\r\n', 'utf8');
}

describe('codex 绯荤粺澶辫触澶勭悊', () => {
  it('codex 闈為浂閫€鍑虹爜浼氱洿鎺ヨ run 澶辫触锛岃€屼笉鏄部 failure 鍥炴祦鏃犻檺閲嶈瘯', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-codex-exit-fail-'));
    const workflowDir = path.join(tempRoot, 'workspace');
    const binDir = path.join(tempRoot, 'bin');
    const workspaceRoot = path.join(workflowDir, '.flowbraid-runs');
    await mkdir(workflowDir, { recursive: true });
    await mkdir(binDir, { recursive: true });
    await createAlwaysFailCodex(binDir);

    const originalPath = process.env.PATH ?? '';
    process.env.PATH = `${binDir};${originalPath}`;
    try {
      const workflowFile = path.join(workflowDir, 'workflow.yaml');
      const workflow = `
id: codex-exit-failure
start: develop
nodes:
  develop:
    type: codex
    prompt: write calc.js
    transitions:
      success: verify
      failure: verify
  verify:
    type: codex
    prompt: verify calc.js
    transitions:
      success: done
      failure: develop
  done:
    type: end
    message: done
`;
      await writeFile(workflowFile, workflow, 'utf8');

      const loaded = await loadWorkflowFile(workflowFile);
      const result = await startWorkflow(loaded, { workspaceRoot, maxSteps: 20 });

      expect(result.status).toBe('failed');
      expect(result.currentNodeId).toBe('develop');

      const finalState = await readJson<{ status: string; currentNodeId: string | null; stepCount: number; failedReason?: string }>(
        path.join(result.runDir, 'state', 'run.json'),
      );
      expect(finalState.status).toBe('failed');
      expect(finalState.currentNodeId).toBe('develop');
      expect(finalState.failedReason).toContain('20');
      expect(finalState.stepCount).toBe(20);
    } finally {
      process.env.PATH = originalPath;
    }
  }, 40000);
});

