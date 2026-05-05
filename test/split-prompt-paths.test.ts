import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { loadWorkflowFile } from '../src/workflow.js';
import { startWorkflow } from '../src/engine.js';
import { readJson } from '../src/utils.js';

async function createPromptAwareCodex(binDir: string): Promise<string> {
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
    'const parsed = parseArgs(args);',
    'const prompt = readStdin();',
    "const latestVerifyMatch = prompt.match(/latest\\.verify\\.report:\\n([\\s\\S]*?)\\nlatest\\.human\\.feedback:/);",
    "const latestHumanMatch = prompt.match(/latest\\.human\\.feedback:\\n([\\s\\S]*?)\\n\\nDirectory model:/);",
    "const latestVerify = latestVerifyMatch ? latestVerifyMatch[1].trim() : '';",
    "const latestHuman = latestHumanMatch ? latestHumanMatch[1].trim() : '';",
    "const mode = process.env.FLOWBRAID_CODEX_MODE || 'exec';",
    "const calcPath = path.join(parsed.workdir, 'calc.js');",
    "if (mode === 'exec') {",
    "  const hasVerifyReport = latestVerify.includes('verdict: reject') || latestVerify.includes('missing comments');",
    "  const hasHumanFeedback = latestHuman.length > 0 && latestHuman !== 'NONE';",
    "  const script = hasVerifyReport",
    "    ? ['// Sum two CLI numbers.', 'const a = Number(process.argv[2]);', 'const b = Number(process.argv[3]);', 'console.log(a + b);', ''].join('\\n')",
    "    : ['const a = Number(process.argv[2]);', 'const b = Number(process.argv[3]);', 'console.log(a + b);', ''].join('\\n');",
    "  fs.writeFileSync(calcPath, script, 'utf8');",
    "  fs.writeFileSync(parsed.outputPath, JSON.stringify({ hasVerifyReport, hasHumanFeedback, latestVerify, latestHuman }, null, 2), 'utf8');",
    "  console.log('develop ok');",
    "  process.exit(0);",
    '}',
    "  const report = fs.readFileSync(calcPath, 'utf8').includes('//')",
    "    ? ['verdict: approve', 'has comments'].join('\\n')",
    "    : ['verdict: reject', 'missing comments'].join('\\n');",
    "  fs.writeFileSync(parsed.outputPath, report, 'utf8');",
    "  console.log(report);",
    '  process.exit(0);',
  ].join('\n');

  const scriptPath = path.join(binDir, 'fake-prompt-aware-codex.js');
  const cmdPath = path.join(binDir, 'codex.cmd');
  await writeFile(scriptPath, fakeScript, 'utf8');
  await writeFile(cmdPath, `@echo off\r\nnode "${scriptPath}" %*\r\n`, 'utf8');
  return cmdPath;
}

describe('split prompt paths', () => {
  it('第二轮 develop 即使不自行读路径文件，也能根据内联 verify 反馈补上注释', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-split-paths-'));
    const workflowDir = path.join(tempRoot, 'workspace');
    const workspaceRoot = path.join(workflowDir, '.flowbraid-runs');
    const binDir = path.join(tempRoot, 'bin');
    await mkdir(workflowDir, { recursive: true });
    await mkdir(binDir, { recursive: true });
    const codexCommand = await createPromptAwareCodex(binDir);

    const workflowFile = path.join(workflowDir, 'workflow.yaml');
    const workflowText = `
id: split-paths-demo
workdir: .
start: develop
nodes:
  develop:
    type: codex
    mode: exec
    prompt: develop calc
    outputFile: develop-last-message.json
    next: verify
  verify:
    type: codex
    mode: review
    prompt: verify calc
    outputFile: verify-report.md
    transitions:
      success: done
      failure: develop
  done:
    type: end
    message: done
`;
    await writeFile(workflowFile, workflowText, 'utf8');

    const workflow = await loadWorkflowFile(workflowFile);
    const result = await startWorkflow(workflow, {
      workspaceRoot,
      codexCommand,
      maxSteps: 8,
    });

    expect(result.status).toBe('completed');

    const calc = await readFile(path.join(workflowDir, 'calc.js'), 'utf8');
    expect(calc).toContain('// Sum two CLI numbers.');

    const developState = await readJson<{
      hasVerifyReport: boolean;
      hasHumanFeedback: boolean;
      latestVerify: string;
      latestHuman: string;
    }>(
      path.join(result.runDir, 'nodes', 'develop', 'artifacts', 'develop-last-message.json'),
    );
    expect(developState.hasVerifyReport).toBe(true);
    expect(developState.latestVerify).toContain('verdict: reject');
    expect(developState.latestHuman).toBe('NONE');
  }, 20000);
});
