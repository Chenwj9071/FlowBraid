import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { loadWorkflowFile } from '../src/workflow.js';
import { readReviewVerdict, startWorkflow } from '../src/engine.js';

async function createFakeReviewRewriteCodex(binDir: string): Promise<void> {
  const fakeScript = [
    "const fs = require('node:fs');",
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
    "const mode = process.env.FLOWBRAID_CODEX_MODE || 'exec';",
    "if (mode === 'exec') {",
    "  if (parsed.outputPath) fs.writeFileSync(parsed.outputPath, 'develop ok\\n', 'utf8');",
    '  process.exit(0);',
    '}',
    "const report = ['first check', 'verdict: reject', 'fixes applied', 'verdict: approve', 'final pass', ''].join('\\n');",
    "if (parsed.outputPath) fs.writeFileSync(parsed.outputPath, report, 'utf8');",
    'process.exit(0);',
  ].join('\n');

  const scriptPath = path.join(binDir, 'fake-review-rewrite-codex.js');
  const cmdPath = path.join(binDir, 'codex.cmd');
  await writeFile(scriptPath, fakeScript, 'utf8');
  await writeFile(cmdPath, '@echo off\r\nnode "%~dp0fake-review-rewrite-codex.js" %*\r\n', 'utf8');
}

describe('review verdict parsing', () => {
  it('uses the last verdict line in the review report', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-review-verdict-parsing-'));
    const workflowDir = path.join(tempRoot, 'workspace');
    const binDir = path.join(tempRoot, 'bin');
    const workspaceRoot = path.join(workflowDir, '.flowbraid-runs');
    await mkdir(workflowDir, { recursive: true });
    await mkdir(binDir, { recursive: true });
    await createFakeReviewRewriteCodex(binDir);

    const originalPath = process.env.PATH ?? '';
    process.env.PATH = `${binDir};${originalPath}`;
    try {
      const workflowFile = path.join(workflowDir, 'workflow.yaml');
      await writeFile(
        workflowFile,
        `
id: review-verdict-parsing-demo
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
    mode: review
    prompt: review
    outputFile: verify-report.md
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
      const result = await startWorkflow(workflow, { workspaceRoot });
      expect(result.status).toBe('completed');

      const report = await readFile(path.join(result.runDir, 'nodes', 'verify', 'artifacts', 'verify-report.md'), 'utf8');
      expect(report).toContain('verdict: reject');
      expect(report).toContain('verdict: approve');
    } finally {
      process.env.PATH = originalPath;
    }
  }, 20000);

  it('does not treat a stale review report from a previous attempt as the current result', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-review-verdict-stale-'));
    await mkdir(tempRoot, { recursive: true });
    const reportPath = path.join(tempRoot, 'verify-report.md');
    await writeFile(reportPath, 'verdict: approve\n', 'utf8');
    await (await import('node:fs/promises')).utimes(reportPath, new Date('2026-04-01T00:00:00.000Z'), new Date('2026-04-01T00:00:00.000Z'));

    const result = await readReviewVerdict(reportPath, '2026-05-01T00:00:00.000Z');
    expect(result.verdict).toBeNull();
    expect(result.stale).toBe(true);
  }, 20000);
});
