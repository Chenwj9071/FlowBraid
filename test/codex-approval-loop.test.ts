import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { loadWorkflowFile } from '../src/workflow.js';
import { resumeWorkflow, startWorkflow } from '../src/engine.js';
import { readJson } from '../src/utils.js';

async function createFakeCodex(binDir: string): Promise<void> {
  const fakeScript = [
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    '',
    'function readStdin() {',
    '  try {',
    "    return fs.readFileSync(0, 'utf8');",
    '  } catch {',
    "    return '';",
    '  }',
    '}',
    '',
    'function parseArgs(argv) {',
    "  const result = { outputPath: '', workdir: process.cwd() };",
    '  for (let i = 0; i < argv.length; i += 1) {',
    '    const arg = argv[i];',
    "    if (arg === '--output-last-message') {",
    '      result.outputPath = argv[i + 1] || "";',
    '      i += 1;',
    '      continue;',
    '    }',
    "    if (arg === '--cd') {",
    '      result.workdir = argv[i + 1] || process.cwd();',
    '      i += 1;',
    '      continue;',
    '    }',
    '  }',
    '  return result;',
    '}',
    '',
    'const args = process.argv.slice(2);',
    "if (args[0] !== 'exec') {",
    "  console.error('unsupported subcommand: ' + (args[0] || ''));",
    '  process.exit(1);',
    '}',
    '',
    'const parsed = parseArgs(args);',
    'const prompt = readStdin();',
    "const resumeCount = Number(process.env.FLOWBRAID_RESUME_COUNT || '0');",
    "const nodeId = process.env.FLOWBRAID_NODE_ID || '';",
    "const nodeDir = process.env.FLOWBRAID_NODE_DIR || '';",
    "const nodeArtifactsDir = process.env.FLOWBRAID_NODE_ARTIFACTS_DIR || path.join(parsed.workdir, '.flowbraid-missing-artifacts');",
    "const runtimeStatePath = nodeDir ? path.join(nodeDir, 'state', 'runtime-state.json') : '';",
    "const reviewReportPath = path.join(nodeArtifactsDir, 'review.md');",
    "const generatedDir = path.join(parsed.workdir, 'generated');",
    'fs.mkdirSync(generatedDir, { recursive: true });',
    'fs.mkdirSync(nodeArtifactsDir, { recursive: true });',
    '',
    "const isDevelopNode = /development node/i.test(prompt);",
    "const isReviewNode = /review node/i.test(prompt);",
    '',
    'if (isDevelopNode) {',
    "  const reviewReport = fs.existsSync(reviewReportPath) ? fs.readFileSync(reviewReportPath, 'utf8') : '';",
    "  const needsRevision = resumeCount > 0 || /verdict: reject/i.test(reviewReport);",
    "  const scriptPath = path.join(generatedDir, 'test-script.ts');",
    '  const script = needsRevision',
    '    ? [',
    "        'export function sum(a: number, b: number) {',",
    "        '  return a + b;',",
    "        '}',",
    "        '',",
    "        '// Add the missing operation after review feedback.',",
    "        'export function multiply(a: number, b: number) {',",
    "        '  return a * b;',",
    "        '}',",
    "        '',",
    "        'if (require.main === module) {',",
    '        "  console.log(sum(1, 2), multiply(2, 3));",',
    "        '}',",
    "        '',",
    "      ].join('\\n')",
    '    : [',
    "        'export function sum(a: number, b: number) {',",
    "        '  return a + b;',",
    "        '}',",
    "        '',",
    "        'if (require.main === module) {',",
    '        "  console.log(sum(1, 2));",',
    "        '}',",
    "        '',",
    "      ].join('\\n');",
    "  fs.writeFileSync(scriptPath, script, 'utf8');",
    "  const runtimeState = { nodeId: 'develop', status: 'completed', outcome: 'success', summary: needsRevision ? 'develop revised script' : 'develop initial script' };",
    "  if (runtimeStatePath) {",
    "    fs.mkdirSync(path.dirname(runtimeStatePath), { recursive: true });",
    "    fs.writeFileSync(runtimeStatePath, JSON.stringify(runtimeState, null, 2), 'utf8');",
    '  }',
    '  if (parsed.outputPath) {',
    "    fs.writeFileSync(parsed.outputPath, JSON.stringify({ resumeCount, needsRevision, reviewReport: reviewReport.trim() || 'NONE' }, null, 2), 'utf8');",
    '  }',
    "  console.log('develop ok');",
    '  process.exit(0);',
    '}',
    '',
    'if (isReviewNode) {',
    "  const scriptPath = path.join(parsed.workdir, 'generated', 'test-script.ts');",
    "  const script = fs.existsSync(scriptPath) ? fs.readFileSync(scriptPath, 'utf8') : '';",
    "  const verdict = /multiply/i.test(script) ? 'approve' : 'reject';",
    "  const message = verdict === 'reject'",
    "    ? ['# Review', 'verdict: reject', 'missing multiply export', 'add multiply in the develop node'].join('\\n')",
    "    : ['# Review', 'verdict: approve', 'multiply export present'].join('\\n');",
    "  fs.writeFileSync(reviewReportPath, message, 'utf8');",
    "  if (runtimeStatePath) {",
    "    fs.mkdirSync(path.dirname(runtimeStatePath), { recursive: true });",
    "    fs.writeFileSync(runtimeStatePath, JSON.stringify({ nodeId: 'review', status: 'completed', outcome: verdict === 'approve' ? 'success' : 'reject', summary: message }, null, 2), 'utf8');",
    '  }',
    '  if (parsed.outputPath) {',
    "    fs.writeFileSync(parsed.outputPath, message, 'utf8');",
    '  }',
    '  console.log(message);',
    '  process.exit(0);',
    '}',
    '',
    "console.error('unsupported node: ' + nodeId);",
    'process.exit(1);',
  ].join('\n');

  const scriptPath = path.join(binDir, 'fake-codex.js');
  const cmdPath = path.join(binDir, 'codex.cmd');
  await writeFile(scriptPath, fakeScript, 'utf8');
  await writeFile(cmdPath, '@echo off\r\nnode "%~dp0fake-codex.js" %*\r\n', 'utf8');
}

describe('codex approval loop', () => {
  it('rewrites after review feedback and then approves', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-codex-loop-'));
    const workflowDir = path.join(tempRoot, 'workspace');
    const binDir = path.join(tempRoot, 'bin');
    const workspaceRoot = path.join(workflowDir, '.flowbraid-runs');
    await mkdir(workflowDir, { recursive: true });
    await mkdir(binDir, { recursive: true });
    await createFakeCodex(binDir);

    const originalPath = process.env.PATH ?? '';
    process.env.PATH = `${binDir};${originalPath}`;
    try {
      const workflowFile = path.join(workflowDir, 'workflow.yaml');
      await writeFile(
        workflowFile,
        `
id: codex-approval-loop
start: develop
nodes:
  develop:
    type: codex
    prompt: |
      You are the development node.
      Create generated/test-script.ts in the shared workdir.
      If nodes/review/artifacts/review.md exists and says verdict: reject, revise the script and add the missing multiply export.
    outputFile: develop-last-message.json
    next: review
  review:
    type: codex
    prompt: |
      You are the review node.
      Inspect generated/test-script.ts and output verdict=approve when multiply exists, otherwise verdict=reject.
    outputFile: review.md
    next: approve
  approve:
    type: approval
    prompt: Confirm the review result.
    transitions:
      approve: done
      reject: develop
  done:
    type: end
    message: completed
`,
        'utf8',
      );

      const loaded = await loadWorkflowFile(workflowFile);
      const firstResult = await startWorkflow(loaded, { workspaceRoot });

      expect(firstResult.status).toBe('paused');
      expect(firstResult.currentNodeId).toBe('approve');

      const runDir = firstResult.runDir;
      const runState = await readJson<{ status: string; pendingNodeId: string | null }>(path.join(runDir, 'state', 'run.json'));
      expect(runState.status).toBe('paused');
      expect(runState.pendingNodeId).toBeNull();

      const generatedScript = await readFile(path.join(workflowDir, 'generated', 'test-script.ts'), 'utf8');
      expect(generatedScript).toContain('export function sum');
      expect(generatedScript).not.toContain('multiply');

      const reviewReport = await readFile(path.join(runDir, 'nodes', 'review', 'artifacts', 'review.md'), 'utf8');
      expect(reviewReport).toContain('verdict: reject');

      const rejectResult = await resumeWorkflow(runDir, {
        approvalDecision: 'reject',
        approvalComment: '请补上 multiply 导出并重新提交验收。',
      });
      expect(rejectResult.status).toBe('paused');
      expect(rejectResult.currentNodeId).toBe('approve');

      const revisedScript = await readFile(path.join(workflowDir, 'generated', 'test-script.ts'), 'utf8');
      expect(revisedScript).toContain('multiply');

      const secondReview = await readFile(path.join(runDir, 'nodes', 'review', 'artifacts', 'review.md'), 'utf8');
      expect(secondReview).toContain('verdict: approve');

      const approveResult = await resumeWorkflow(runDir, {
        approvalDecision: 'approve',
      });
      expect(approveResult.status).toBe('completed');

      const finalState = await readJson<{ status: string; currentNodeId: string | null }>(path.join(runDir, 'state', 'run.json'));
      expect(finalState.status).toBe('completed');
      expect(finalState.currentNodeId).toBeNull();
    } finally {
      process.env.PATH = originalPath;
    }
  }, 20000);
});
