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
    'const subcommand = args[0];',
    'const parsed = parseArgs(args);',
    'const outputPath = parsed.outputPath;',
    'const workdir = parsed.workdir;',
    'const prompt = readStdin();',
    "const mode = process.env.FLOWBRAID_CODEX_MODE || 'exec';",
    "const resumeCount = Number(process.env.FLOWBRAID_RESUME_COUNT || '0');",
    "const nodeArtifactsDir = process.env.FLOWBRAID_NODE_ARTIFACTS_DIR || path.join(workdir, '.flowbraid-missing-artifacts');",
    "const generatedDir = path.join(workdir, 'generated');",
    'fs.mkdirSync(generatedDir, { recursive: true });',
    'fs.mkdirSync(nodeArtifactsDir, { recursive: true });',
    '',
    "if (subcommand !== 'exec') {",
    "  console.log('unsupported subcommand: ' + subcommand);",
    '  process.exit(1);',
    '}',
    '',
    "if (mode === 'exec') {",
    "  const scriptPath = path.join(generatedDir, 'test-script.ts');",
    '  const content = resumeCount === 0',
    '    ? [',
    "        'export function sum(a: number, b: number) {',",
    "        '  return a + b;',",
    "        '}',",
    "        '',",
    "        'if (require.main === module) {',",
    '        "  console.log(sum(1, 2));",',
    "        '}',",
    "        '',",
    "      ].join('\\n')",
    '    : [',
    "        'export function sum(a: number, b: number) {',",
    "        '  return a + b;',",
    "        '}',",
    "        '',",
    "        'export function multiply(a: number, b: number) {',",
    "        '  return a * b;',",
    "        '}',",
    "        '',",
    "        'if (require.main === module) {',",
    '        "  console.log(sum(1, 2), multiply(2, 3));",',
    "        '}',",
    "        '',",
    "      ].join('\\n');",
    "  fs.writeFileSync(scriptPath, content, 'utf8');",
    '  if (outputPath) {',
    '    fs.writeFileSync(',
    '      outputPath,',
    '      [',
    "        '# 开发结果',",
    '        "prompt-length=" + prompt.length,',
    '        "script=" + scriptPath,',
    '        "revision=" + resumeCount,',
    "      ].join('\\n'),",
    "      'utf8',",
    '    );',
    '  }',
    "  console.log('fake codex exec complete');",
    '  process.exit(0);',
    '}',
    '',
    "const reviewPath = path.join(nodeArtifactsDir, 'review.md');",
    "const verdict = resumeCount === 0 ? 'reject' : 'approve';",
    'const message =',
    "  verdict === 'reject'",
    '    ? [',
    "        '# 审核结果',",
    "        'verdict: reject',",
    "        '问题: 当前脚本还缺少 multiply 导出，建议补上批量计算能力。',",
    "        '建议: 在开发节点补充 multiply 并重新提交。',",
    "      ].join('\\n')",
    '    : [',
    "        '# 审核结果',",
    "        'verdict: approve',",
    "        '结论: 脚本结构清晰，已经满足最小测试任务要求。',",
    "      ].join('\\n');",
    'fs.writeFileSync(reviewPath, message, \'utf8\');',
    'if (outputPath) {',
    "  fs.writeFileSync(outputPath, message, 'utf8');",
    '}',
    'console.log(message);',
    'process.exit(0);',
    '',
  ].join('\n');

  const scriptPath = path.join(binDir, 'fake-codex.js');
  const cmdPath = path.join(binDir, 'codex.cmd');
  await writeFile(scriptPath, fakeScript, 'utf8');
  await writeFile(cmdPath, '@echo off\r\nnode "%~dp0fake-codex.js" %*\r\n', 'utf8');
}

describe('codex 开发 - 审核 - 人工确认闭环', () => {
  it('先打回修改，再批准结束', async () => {
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
      const workflow = `
id: codex-approval-loop
start: develop
nodes:
  develop:
    type: codex
    mode: exec
    prompt: |
      任务：写一个最小的 Node.js 测试脚本。
      目标：在 generated/test-script.ts 中输出一个可运行的小脚本。
      如果 nodes/review/artifacts/review.md 存在，请根据审核意见修订后再写。
    outputFile: develop-last-message.md
    next: review
  review:
    type: codex
    mode: review
    prompt: |
      请对 generated/test-script.ts 做 code review。
      要求：
      1. 输出 verdict=approve 或 verdict=reject。
      2. 如果有问题，给出具体修改意见。
    outputFile: review.md
    next: approve
  approve:
    type: approval
    prompt: 请确认是否接受本次审核结果。
    transitions:
      approve: done
      reject: develop
  done:
    type: end
    message: 完成
`;
      await writeFile(workflowFile, workflow, 'utf8');

      const loaded = await loadWorkflowFile(workflowFile);
      const firstResult = await startWorkflow(loaded, {
        workspaceRoot,
      });

      expect(firstResult.status).toBe('paused');
      expect(firstResult.currentNodeId).toBe('approve');

      const runDir = firstResult.runDir;
      const runState = await readJson<{ status: string; pendingNodeId: string | null }>(path.join(runDir, 'state', 'run.json'));
      expect(runState.status).toBe('paused');
      expect(runState.pendingNodeId).toBeNull();

      const generatedScript = await readFile(path.join(workflowDir, 'generated', 'test-script.ts'), 'utf8');
      expect(generatedScript).toContain('export function sum');

      const reviewReport = await readFile(path.join(runDir, 'nodes', 'review', 'artifacts', 'review.md'), 'utf8');
      expect(reviewReport).toContain('verdict: reject');

      const rejectResult = await resumeWorkflow(runDir, {
        approvalDecision: 'reject',
        approvalComment: '请补上 multiply 导出并重新提交验收',
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
