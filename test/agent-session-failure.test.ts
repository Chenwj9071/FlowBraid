import path from 'node:path';
import os from 'node:os';
import { chmod, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { loadWorkflowFile } from '../src/workflow.js';
import { startWorkflow } from '../src/engine.js';
import { readJson } from '../src/utils.js';

async function createInvalidJsonCodex(binDir: string): Promise<string> {
  const fakeScript = [
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    'const args = process.argv.slice(2);',
    "let outputPath = '';",
    'for (let i = 0; i < args.length; i += 1) {',
    "  if (args[i] === '--output-last-message') {",
    "    outputPath = args[i + 1] || '';",
    '    i += 1;',
    '  }',
    '}',
    'if (outputPath) {',
    "  fs.mkdirSync(path.dirname(outputPath), { recursive: true });",
    "  fs.writeFileSync(outputPath, '{ invalid json', 'utf8');",
    '}',
    "console.log('wrote invalid json');",
    'process.exit(0);',
  ].join('\n');

  const scriptPath = path.join(binDir, 'invalid-json-codex.js');
  const cmdPath = path.join(binDir, 'codex.cmd');
  const shPath = path.join(binDir, 'codex');
  await writeFile(scriptPath, fakeScript, 'utf8');
  await writeFile(cmdPath, '@echo off\r\nnode "%~dp0invalid-json-codex.js" %*\r\n', 'utf8');
  await writeFile(shPath, '#!/usr/bin/env sh\nnode "$(dirname "$0")/invalid-json-codex.js" "$@"\n', 'utf8');
  await chmod(shPath, 0o755);
  return process.platform === 'win32' ? cmdPath : shPath;
}

describe('agent_session 异常收敛', () => {
  it('provider 输出损坏时会把 run 落盘为 failed，而不是直接抛出后遗留 running 状态', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-agent-session-failure-'));
    const workflowDir = path.join(tempRoot, 'workspace');
    const binDir = path.join(tempRoot, 'bin');
    const workspaceRoot = path.join(workflowDir, '.flowbraid-runs');
    await mkdir(workflowDir, { recursive: true });
    await mkdir(binDir, { recursive: true });
    const codexCommand = await createInvalidJsonCodex(binDir);

    const workflowFile = path.join(workflowDir, 'workflow.yaml');
    const workflow = `
id: agent-session-failure
start: discuss
nodes:
  discuss:
    type: agent_session
    provider: codex
    prompt: |
      ask for more input if needed
    transitions:
      failure: done
  done:
    type: end
    message: recovered
`;
    await writeFile(workflowFile, workflow, 'utf8');

    const loaded = await loadWorkflowFile(workflowFile);
    const result = await startWorkflow(loaded, {
      workspaceRoot,
      codexCommand,
    });

    expect(result.status).toBe('completed');

    const discussState = await readJson<{ status: string; detail?: string }>(
      path.join(result.runDir, 'nodes', 'discuss', 'status.json'),
    );
    expect(discussState.status).toBe('failed');
    expect(discussState.detail).toContain('JSON');

    const runState = await readJson<{ status: string; currentNodeId: string | null; stepCount: number }>(
      path.join(result.runDir, 'state', 'run.json'),
    );
    expect(runState.status).toBe('completed');
    expect(runState.currentNodeId).toBeNull();
    expect(runState.stepCount).toBe(2);
  });
});
