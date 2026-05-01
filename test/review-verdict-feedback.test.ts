import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { loadWorkflowFile } from '../src/workflow.js';
import { resumeWorkflow, startWorkflow } from '../src/engine.js';
import { readJson } from '../src/utils.js';

async function createFakeReviewCodex(binDir: string): Promise<void> {
  const fakeScript = [
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const cp = require('node:child_process');",
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
    "  const result = { outputPath: '', cwd: process.cwd() };",
    '  for (let i = 0; i < argv.length; i += 1) {',
    '    const arg = argv[i];',
    "    if (arg === '--output-last-message') {",
    '      result.outputPath = argv[i + 1] || "";',
    '      i += 1;',
    '      continue;',
    '    }',
    "    if (arg === '-C') {",
    '      result.cwd = argv[i + 1] || process.cwd();',
    '      i += 1;',
    '      continue;',
    '    }',
    '  }',
    '  return result;',
    '}',
    '',
    'const args = process.argv.slice(2);',
    "if (args[0] !== 'exec') {",
    "  console.error('unsupported subcommand');",
    '  process.exit(1);',
    '}',
    'const parsed = parseArgs(args);',
    "const mode = process.env.FLOWBRAID_CODEX_MODE || 'exec';",
    "const runDir = process.env.FLOWBRAID_RUN_DIR || process.cwd();",
    "const reviewReportPath = path.join(runDir, 'nodes', 'verify', 'artifacts', 'verify-report.md');",
    "const humanFeedbackPath = path.join(runDir, 'messages', 'human-feedback.jsonl');",
    "const calcPath = path.join(parsed.cwd, 'calc.js');",
    "const feedbackAppliedPath = path.join(parsed.cwd, 'feedback-applied.txt');",
    "const prompt = readStdin();",
    '',
    "if (mode === 'exec') {",
    "  const hasReviewReport = fs.existsSync(reviewReportPath);",
    "  const hasHumanFeedback = fs.existsSync(humanFeedbackPath) && fs.readFileSync(humanFeedbackPath, 'utf8').includes('只输出结果值');",
    '  let script = "";',
    '  if (!hasReviewReport) {',
    '    script = [',
    "      'const a = Number(process.argv[2]);',",
    "      'const b = Number(process.argv[3]);',",
    "      'console.log(a - b);',",
    "      '',",
    "    ].join('\\n');",
    '  } else {',
    '    script = [',
    "      'const a = Number(process.argv[2]);',",
    "      'const b = Number(process.argv[3]);',",
    "      'console.log(a + b);',",
    "      '',",
    "    ].join('\\n');",
    '  }',
    "  fs.writeFileSync(calcPath, script, 'utf8');",
    '  if (hasHumanFeedback) {',
    "    fs.writeFileSync(feedbackAppliedPath, 'handled human feedback', 'utf8');",
    '  }',
    '  if (parsed.outputPath) {',
    "    fs.writeFileSync(parsed.outputPath, ['# develop', 'prompt-length=' + prompt.length].join('\\n'), 'utf8');",
    '  }',
    "  console.log('fake develop complete');",
    '  process.exit(0);',
    '}',
    '',
    'const cases = [',
    "  ['1', '2', '3'],",
    "  ['10', '-4', '6'],",
    "  ['1.5', '2.5', '4'],",
    '];',
    'let allPassed = true;',
    'const lines = [',
    "  '# verify report',",
    "  'checked: calc.js',",
    '];',
    'for (const [a, b, expected] of cases) {',
    "  const output = cp.execFileSync(process.execPath, [calcPath, a, b], { cwd: parsed.cwd, encoding: 'utf8' }).trim();",
    "  lines.push(`case ${a} ${b} => ${output}`);",
    '  if (output !== expected) {',
    '    allPassed = false;',
    '  }',
    '}',
    'if (allPassed) {',
    "  lines.push('verdict: approve');",
    "  lines.push('结果符合预期。');",
    '} else {',
    "  lines.push('verdict: reject');",
    "  lines.push('脚本没有正确输出 a+b，请修正实现并保持只输出结果值。');",
    '}',
    'if (parsed.outputPath) {',
    "  fs.writeFileSync(parsed.outputPath, lines.join('\\n'), 'utf8');",
    '}',
    "  console.log(lines.join('\\n'));",
    'process.exit(0);',
  ].join('\n');

  const scriptPath = path.join(binDir, 'fake-review-codex.js');
  const cmdPath = path.join(binDir, 'codex.cmd');
  await writeFile(scriptPath, fakeScript, 'utf8');
  await writeFile(cmdPath, '@echo off\r\nnode "%~dp0fake-review-codex.js" %*\r\n', 'utf8');
}

describe('review verdict 与人工反馈回流', () => {
  it('支持验收自动打回开发节点，并记录人工 reject 意见供下一轮处理', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-review-verdict-'));
    const workflowDir = path.join(tempRoot, 'workspace');
    const binDir = path.join(tempRoot, 'bin');
    const workspaceRoot = path.join(workflowDir, '.flowbraid-runs');
    await mkdir(workflowDir, { recursive: true });
    await mkdir(binDir, { recursive: true });
    await createFakeReviewCodex(binDir);

    const originalPath = process.env.PATH ?? '';
    process.env.PATH = `${binDir};${originalPath}`;
    try {
      const workflowFile = path.join(workflowDir, 'workflow.yaml');
      const workflow = `
id: review-verdict-demo
workdir: .
start: develop
nodes:
  develop:
    type: codex
    mode: exec
    prompt: 开发 calc.js，输出 a+b 的值
    outputFile: develop.md
    next: verify
  verify:
    type: codex
    mode: review
    prompt: 验收 calc.js，并输出 verdict
    outputFile: verify-report.md
    transitions:
      success: approve
      failure: develop
  approve:
    type: approval
    prompt: 人工确认
    transitions:
      approve: done
      reject: develop
  done:
    type: end
    message: done
`;
      await writeFile(workflowFile, workflow, 'utf8');

      const loaded = await loadWorkflowFile(workflowFile);
      const firstResult = await startWorkflow(loaded, {
        workspaceRoot,
      });

      expect(firstResult.status).toBe('paused');
      expect(firstResult.currentNodeId).toBe('approve');

      const reviewReport = await readFile(path.join(firstResult.runDir, 'nodes', 'verify', 'artifacts', 'verify-report.md'), 'utf8');
      expect(reviewReport).toContain('verdict: approve');

      const calcScript = await readFile(path.join(workflowDir, 'calc.js'), 'utf8');
      expect(calcScript).toContain('a + b');

      const rejectResult = await resumeWorkflow(firstResult.runDir, {
        approvalDecision: 'reject',
        approvalComment: '请保持只输出结果值，并确认人工确认意见已被处理',
      });

      expect(rejectResult.status).toBe('paused');
      expect(rejectResult.currentNodeId).toBe('approve');

      const humanFeedback = await readFile(path.join(firstResult.runDir, 'messages', 'human-feedback.jsonl'), 'utf8');
      expect(humanFeedback).toContain('"decision":"reject"');
      expect(humanFeedback).toContain('只输出结果值');
      expect(humanFeedback).toContain('"targetNodeId":"develop"');

      const feedbackApplied = await readFile(path.join(workflowDir, 'feedback-applied.txt'), 'utf8');
      expect(feedbackApplied).toContain('handled human feedback');

      const finalResult = await resumeWorkflow(firstResult.runDir, {
        approvalDecision: 'approve',
      });
      expect(finalResult.status).toBe('completed');

      const finalState = await readJson<{ status: string; currentNodeId: string | null }>(
        path.join(firstResult.runDir, 'state', 'run.json'),
      );
      expect(finalState.status).toBe('completed');
      expect(finalState.currentNodeId).toBeNull();
    } finally {
      process.env.PATH = originalPath;
    }
  }, 20000);
});
