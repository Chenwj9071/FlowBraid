import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { loadWorkflowFile } from '../src/workflow.js';
import { startWorkflow } from '../src/engine.js';
import { readJson } from '../src/utils.js';

async function createFakeOutcomeCodex(binDir: string): Promise<void> {
  const fakeScript = [
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    '',
    'function parseArgs(argv) {',
    "  const result = { outputPath: '' };",
    '  for (let i = 0; i < argv.length; i += 1) {',
    "    if (argv[i] === '--output-last-message') {",
    '      result.outputPath = argv[i + 1] || "";',
    '      i += 1;',
    '    }',
    '  }',
    '  return result;',
    '}',
    '',
    'const args = process.argv.slice(2);',
    'const parsed = parseArgs(args);',
    "const nodeId = process.env.FLOWBRAID_NODE_ID || '';",
    "const nodeDir = process.env.FLOWBRAID_NODE_DIR || '';",
    "const artifactsDir = path.join(nodeDir, 'artifacts');",
    "const runtimeStatePath = path.join(nodeDir, 'state', 'runtime-state.json');",
    'fs.mkdirSync(artifactsDir, { recursive: true });',
    'fs.mkdirSync(path.dirname(runtimeStatePath), { recursive: true });',
    "if (nodeId !== 'verify') {",
    "  if (parsed.outputPath) fs.writeFileSync(parsed.outputPath, 'develop ok\\n', 'utf8');",
    "  fs.writeFileSync(runtimeStatePath, JSON.stringify({ nodeId, status: 'completed', outcome: 'success', summary: 'develop ok' }, null, 2));",
    '  process.exit(0);',
    '}',
    "fs.writeFileSync(path.join(artifactsDir, 'verify-report.md'), 'stale report\\noutcome hint: reject\\n', 'utf8');",
    "fs.writeFileSync(runtimeStatePath, JSON.stringify({ nodeId, status: 'completed', outcome: 'success', summary: 'verify success' }, null, 2));",
    "if (parsed.outputPath) fs.writeFileSync(parsed.outputPath, 'outcome hint: reject\\ncomments missing\\n', 'utf8');",
    'process.exit(0);',
  ].join('\n');

  const scriptPath = path.join(binDir, 'fake-outcome-codex.js');
  const cmdPath = path.join(binDir, 'codex.cmd');
  await writeFile(scriptPath, fakeScript, 'utf8');
  await writeFile(cmdPath, '@echo off\r\nnode "%~dp0fake-outcome-codex.js" %*\r\n', 'utf8');
}

describe('runtime-state 与 outcome 归一化', () => {
  it('优先读取当前 attempt 的 runtime-state outcome', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-outcome-runtime-'));
    const workflowDir = path.join(tempRoot, 'workspace');
    const binDir = path.join(tempRoot, 'bin');
    const workspaceRoot = path.join(workflowDir, '.flowbraid-runs');
    await mkdir(workflowDir, { recursive: true });
    await mkdir(binDir, { recursive: true });
    await createFakeOutcomeCodex(binDir);

    const originalPath = process.env.PATH ?? '';
    process.env.PATH = `${binDir};${originalPath}`;
    try {
      const workflowFile = path.join(workflowDir, 'workflow.yaml');
      await writeFile(
        workflowFile,
        `
id: outcome-runtime-demo
workdir: .
start: develop
nodes:
  develop:
    type: codex
    mode: exec
    prompt: implement
    next: verify
  verify:
    type: codex
    prompt: verify
    outputFile: verify-report.md
    transitions:
      success: done
      failure: done
  done:
    type: end
    message: done
`,
        'utf8',
      );

      const workflow = await loadWorkflowFile(workflowFile);
      const result = await startWorkflow(workflow, { workspaceRoot });
      expect(result.status).toBe('completed');

      const runtimeState = await readJson<{ status: string; outcome?: string; summary?: string }>(
        path.join(result.runDir, 'nodes', 'verify', 'state', 'runtime-state.json'),
      );
      expect(runtimeState.status).toBe('completed');
      expect(runtimeState.outcome).toBe('success');
      expect(runtimeState.summary ?? '').toContain('success');

      const report = await readFile(path.join(result.runDir, 'nodes', 'verify', 'artifacts', 'verify-report.md'), 'utf8');
      expect(report).toContain('outcome hint: reject');
    } finally {
      process.env.PATH = originalPath;
    }
  }, 20000);

  it('不会把旧 attempt 的 artifact 当成当前结果', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-outcome-stale-'));
    const workflowDir = path.join(tempRoot, 'workspace');
    const binDir = path.join(tempRoot, 'bin');
    const workspaceRoot = path.join(workflowDir, '.flowbraid-runs');
    await mkdir(workflowDir, { recursive: true });
    await mkdir(binDir, { recursive: true });
    await createFakeOutcomeCodex(binDir);

    const originalPath = process.env.PATH ?? '';
    process.env.PATH = `${binDir};${originalPath}`;
    try {
      const workflowFile = path.join(workflowDir, 'workflow.yaml');
      await writeFile(
        workflowFile,
        `
id: outcome-stale-demo
workdir: .
start: verify
nodes:
  verify:
    type: codex
    prompt: verify
    outputFile: verify-report.md
    transitions:
      success: done
      failure: done
  done:
    type: end
    message: done
`,
        'utf8',
      );

      const workflow = await loadWorkflowFile(workflowFile);
      const result = await startWorkflow(workflow, { workspaceRoot });
      expect(result.status).toBe('completed');

      const runtimeState = await readJson<{ status: string; outcome?: string }>(
        path.join(result.runDir, 'nodes', 'verify', 'state', 'runtime-state.json'),
      );
      expect(runtimeState.status).toBe('completed');
      expect(runtimeState.outcome).toBe('success');

      const report = await readFile(path.join(result.runDir, 'nodes', 'verify', 'artifacts', 'verify-report.md'), 'utf8');
      expect(report).toContain('outcome hint: reject');
    } finally {
      process.env.PATH = originalPath;
    }
  }, 20000);
});
