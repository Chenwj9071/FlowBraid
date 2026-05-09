import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { loadWorkflowFile } from '../src/workflow.js';
import { resumeWorkflow, startWorkflow } from '../src/engine.js';
import { readJson } from '../src/utils.js';

async function createFakeOutcomeCodex(binDir: string): Promise<void> {
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
    "  console.error('unsupported subcommand');",
    '  process.exit(1);',
    '}',
    'const parsed = parseArgs(args);',
    "const prompt = readStdin();",
    "const runDir = process.env.FLOWBRAID_RUN_DIR || process.cwd();",
    "const nodeId = process.env.FLOWBRAID_NODE_ID || '';",
    "const nodeDir = process.env.FLOWBRAID_NODE_DIR || '';",
    "const humanFeedbackPath = path.join(runDir, 'messages', 'human-feedback.jsonl');",
    "const calcPath = path.join(parsed.workdir, 'calc.js');",
    "const feedbackAppliedPath = path.join(parsed.workdir, 'feedback-applied.txt');",
    "const runtimeStatePath = path.join(nodeDir, 'state', 'runtime-state.json');",
    "const verifyReportPath = path.join(nodeDir, 'artifacts', 'verify-report.md');",
    'if (nodeDir) {',
    "  fs.mkdirSync(path.dirname(runtimeStatePath), { recursive: true });",
    "  fs.mkdirSync(path.dirname(verifyReportPath), { recursive: true });",
    '}',
    '',
    'if (nodeId !== "verify") {',
    "  const hasHumanFeedback = fs.existsSync(humanFeedbackPath) && fs.readFileSync(humanFeedbackPath, 'utf8').includes('\"decision\":\"reject\"');",
    "  const script = hasHumanFeedback ? ['const a = Number(process.argv[2]);', 'const b = Number(process.argv[3]);', 'console.log(a + b);', ''].join('\\n') : ['const a = Number(process.argv[2]);', 'const b = Number(process.argv[3]);', 'console.log(a - b);', ''].join('\\n');",
    "  fs.writeFileSync(calcPath, script, 'utf8');",
    '  if (hasHumanFeedback) {',
    "    fs.writeFileSync(feedbackAppliedPath, 'handled human feedback', 'utf8');",
    '  }',
    '  if (parsed.outputPath) {',
    "    fs.writeFileSync(parsed.outputPath, ['# develop', 'prompt-length=' + prompt.length].join('\\n'), 'utf8');",
    '  }',
    '  if (runtimeStatePath) {',
    "    fs.writeFileSync(runtimeStatePath, JSON.stringify({ nodeId, status: 'completed', outcome: 'success', summary: 'develop complete' }, null, 2));",
    '  }',
    '  process.exit(0);',
    '}',
    '',
    "const report = ['checked: calc.js', 'outcome hint: success', 'comments missing', ''].join('\\n');",
    'if (parsed.outputPath) {',
    "  fs.writeFileSync(parsed.outputPath, report, 'utf8');",
    '}',
    'if (runtimeStatePath) {',
    "  fs.writeFileSync(runtimeStatePath, JSON.stringify({ nodeId, status: 'completed', outcome: 'success', summary: 'verify success' }, null, 2));",
    '}',
    'if (verifyReportPath) {',
    "  fs.writeFileSync(verifyReportPath, report, 'utf8');",
    '}',
    'process.exit(0);',
  ].join('\n');

  const scriptPath = path.join(binDir, 'fake-outcome-codex.js');
  const cmdPath = path.join(binDir, 'codex.cmd');
  await writeFile(scriptPath, fakeScript, 'utf8');
  await writeFile(cmdPath, '@echo off\r\nnode "%~dp0fake-outcome-codex.js" %*\r\n', 'utf8');
}

describe('outcome and human feedback loop', () => {
  it('supports auto rejection, human feedback, and a second pass', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-outcome-feedback-'));
    const workflowDir = path.join(tempRoot, 'workspace');
    const binDir = path.join(tempRoot, 'bin');
    const workspaceRoot = path.join(workflowDir, '.flowbraid-runs');
    await mkdir(workflowDir, { recursive: true });
    await mkdir(binDir, { recursive: true });
    await createFakeOutcomeCodex(binDir);

    const originalPath = process.env.PATH ?? '';
    process.env.PATH = `${binDir};${originalPath}`;
    try {
      const codexCommand = `node "${path.join(binDir, 'fake-outcome-codex.js')}"`;
      const workflowFile = path.join(workflowDir, 'workflow.yaml');
      await writeFile(
        workflowFile,
        `
id: outcome-feedback-demo
workdir: .
start: develop
nodes:
  develop:
    type: codex
    prompt: 开发 calc.js，输出 a+b 的值
    outputFile: develop.md
    next: verify
  verify:
    type: codex
    prompt: 验收 calc.js，并输出 outcome
    outputFile: verify-report.md
    transitions:
      success: approve
      failure: develop
  approve:
    type: approval
    prompt: 浜哄伐纭
    transitions:
      approve: done
      reject: develop
  done:
    type: end
    message: done
`,
        'utf8',
      );

      const loaded = await loadWorkflowFile(workflowFile);
      const logs: string[] = [];
      const firstResult = await startWorkflow(loaded, {
        workspaceRoot,
        codexCommand,
        logger: (line) => logs.push(line),
      });

      expect(firstResult.status).toBe('paused');
      expect(firstResult.currentNodeId).toBe('approve');

      const verifyRuntimeState = await readJson<{ status: string; outcome?: string; summary?: string }>(
        path.join(firstResult.runDir, 'nodes', 'verify', 'state', 'runtime-state.json'),
      );
      expect(verifyRuntimeState.status).toBe('completed');
      expect(verifyRuntimeState.outcome).toBe('success');
      expect(verifyRuntimeState.summary).toBe('verify success');

      const initialCalcScript = await readFile(path.join(workflowDir, 'calc.js'), 'utf8');
      expect(initialCalcScript).toContain('a - b');

      const rejectResult = await resumeWorkflow(firstResult.runDir, {
        approvalDecision: 'reject',
        approvalComment: '请保持只输出结果值，并确认人工意见已被处理。',
        codexCommand,
        logger: (line) => logs.push(line),
      });

      expect(rejectResult.status).toBe('paused');
      expect(rejectResult.currentNodeId).toBe('approve');

      const humanFeedback = await readFile(path.join(firstResult.runDir, 'messages', 'human-feedback.jsonl'), 'utf8');
      expect(humanFeedback).toContain('"decision":"reject"');
      expect(humanFeedback).toContain('请保持只输出结果值，并确认人工意见已被处理。');

      const feedbackApplied = await readFile(path.join(workflowDir, 'feedback-applied.txt'), 'utf8');
      expect(feedbackApplied).toContain('handled human feedback');

      const updatedCalcScript = await readFile(path.join(workflowDir, 'calc.js'), 'utf8');
      expect(updatedCalcScript).toContain('a + b');
      expect(humanFeedback).toContain('只输出结果值');
      const finalResult = await resumeWorkflow(firstResult.runDir, {
        approvalDecision: 'approve',
        codexCommand,
        logger: (line) => logs.push(line),
      });
      expect(finalResult.status).toBe('completed');

      const finalState = await readJson<{ status: string; currentNodeId: string | null }>(
        path.join(firstResult.runDir, 'state', 'run.json'),
      );
      expect(finalState.status).toBe('completed');
      expect(finalState.currentNodeId).toBeNull();
      expect(logs.some((line) => line.includes('node develop succeeded'))).toBe(true);
      expect(logs.some((line) => line.includes('node verify succeeded'))).toBe(true);
    } finally {
      process.env.PATH = originalPath;
    }
  }, 60000);
});

