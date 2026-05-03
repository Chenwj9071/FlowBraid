import path from 'node:path';
import os from 'node:os';
import { chmod, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { readJson } from '../src/utils.js';

function stripTerminalSequences(text: string): string {
  return text
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001B\][^\u0007]*\u0007/g, '');
}

function countOccurrences(text: string, pattern: string): number {
  return text.split(pattern).length - 1;
}

function toYamlSingleQuoted(value: string): string {
  return `'${value.replace(/'/gu, "''").replace(/\\/gu, '/')}'`;
}

async function copyDir(sourceDir: string, targetDir: string): Promise<void> {
  await mkdir(targetDir, { recursive: true });
  const entries = await (await import('node:fs/promises')).readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await copyDir(sourcePath, targetPath);
      continue;
    }
    await writeFile(targetPath, await readFile(sourcePath));
  }
}

async function createFakeCodex(binDir: string): Promise<void> {
  const fakeScript = `
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

function parseArgs(argv) {
  const result = { outputPath: '', cwd: process.cwd(), prompt: '', workdir: process.cwd() };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--output-last-message') {
      result.outputPath = argv[i + 1] || '';
      i += 1;
      continue;
    }
    if (arg === '--cd') {
      result.workdir = argv[i + 1] || process.cwd();
      i += 1;
      continue;
    }
    if (!arg.startsWith('-') && arg !== 'exec' && i === argv.length - 1) {
      result.prompt = arg;
    }
  }
  return result;
}

function append(filePath, text) {
  fs.appendFileSync(filePath, text + '\\n', 'utf8');
}

const args = process.argv.slice(2);
if (args[0] !== 'exec') {
  console.error('unsupported subcommand');
  process.exit(1);
}

const parsed = parseArgs(args);
const mode = process.env.FLOWBRAID_CODEX_MODE || 'exec';
const runDir = process.env.FLOWBRAID_RUN_DIR || process.cwd();
const calcPath = path.join(parsed.workdir, 'calc.js');
const feedbackAppliedPath = path.join(parsed.workdir, 'feedback-applied.txt');
const developLogPath = path.join(parsed.workdir, 'develop-history.log');
const verifyLogPath = path.join(parsed.workdir, 'verify-history.log');
const humanFeedbackPath = path.join(runDir, 'messages', 'human-feedback.jsonl');
const reviewReportPath = path.join(runDir, 'nodes', 'verify', 'artifacts', 'verify-report.md');

if (mode === 'exec') {
  const reviewReport = fs.existsSync(reviewReportPath) ? fs.readFileSync(reviewReportPath, 'utf8') : '';
  const humanFeedback = fs.existsSync(humanFeedbackPath) ? fs.readFileSync(humanFeedbackPath, 'utf8') : '';
  const hasVerifyReport = reviewReport.length > 0;
  const needsComments = /comment/i.test(reviewReport);
  const hasHumanFeedback = humanFeedback.length > 0;
  const lines = hasVerifyReport && (needsComments || hasHumanFeedback)
    ? [
        '// Add two CLI numbers and print only the result.',
        'const a = Number(process.argv[2]);',
        'const b = Number(process.argv[3]);',
        '',
        '// Keep output to the final numeric result only.',
        'console.log(a + b);',
        '',
      ]
    : [
        'const a = Number(process.argv[2]);',
        'const b = Number(process.argv[3]);',
        'console.log(a + b);',
        '',
      ];
  fs.writeFileSync(calcPath, lines.join('\\n'), 'utf8');
  append(developLogPath, 'hasVerifyReport=' + hasVerifyReport + ';needsComments=' + needsComments + ';hasHumanFeedback=' + hasHumanFeedback);

  if (hasHumanFeedback) {
    fs.writeFileSync(feedbackAppliedPath, humanFeedback, 'utf8');
  }

  if (parsed.outputPath) {
    fs.writeFileSync(
      parsed.outputPath,
      [
        '# develop report',
        'updated=calc.js',
        'readVerify=' + hasVerifyReport,
        'readHumanFeedback=' + hasHumanFeedback,
        'cwd=' + parsed.cwd,
        'workdir=' + parsed.workdir,
      ].join('\\n'),
      'utf8',
    );
  }
  console.log('fake develop complete');
  process.exit(0);
}

const cases = [
  ['1', '2', '3'],
  ['10', '-4', '6'],
  ['1.5', '2.5', '4'],
];
let allPassed = true;
const outputs = ['# verify report'];
for (const [a, b, expected] of cases) {
  const output = cp.execFileSync(process.execPath, [calcPath, a, b], {
    cwd: parsed.workdir,
    encoding: 'utf8',
  }).trim();
  outputs.push(\`case \${a} \${b} => \${output}\`);
  if (output !== expected) {
    allPassed = false;
  }
}

const calcContent = fs.readFileSync(calcPath, 'utf8');
const hasComment = /^\\s*\\/\\/|\\/\\*/m.test(calcContent);
append(verifyLogPath, 'hasComment=' + hasComment + ';allPassed=' + allPassed);

if (!allPassed) {
  outputs.push('verdict: reject');
  outputs.push('Problem: calc.js does not print the correct sum for all required cases.');
  outputs.push('Fix: print only a + b as the final output value.');
} else if (!hasComment) {
  outputs.push('verdict: reject');
  outputs.push('Problem: calc.js is missing the required comment.');
  outputs.push('Fix: add a clear comment that explains the script purpose or CLI parsing logic, then resubmit.');
} else {
  outputs.push('verdict: approve');
  outputs.push('Summary: behavior is correct and the required comments are present.');
}

if (parsed.outputPath) {
  fs.writeFileSync(parsed.outputPath, outputs.join('\\n'), 'utf8');
}
console.log(outputs.join('\\n'));
process.exit(0);
`;

  const scriptPath = path.join(binDir, 'fake-codex.js');
  const cmdPath = path.join(binDir, 'codex.cmd');
  const shPath = path.join(binDir, 'codex');
  await writeFile(scriptPath, fakeScript, 'utf8');
  await writeFile(cmdPath, '@echo off\r\nnode "%~dp0fake-codex.js" %*\r\n', 'utf8');
  await writeFile(shPath, '#!/usr/bin/env sh\nnode "$(dirname "$0")/fake-codex.js" "$@"\n', 'utf8');
  await chmod(shPath, 0o755);
}

async function runInteractiveWorkflow(workflowFile: string, env: NodeJS.ProcessEnv): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const command = process.platform === 'win32' ? 'cmd.exe' : 'npx';
  const cliArgs =
    process.platform === 'win32'
      ? ['/c', 'npx', 'tsx', 'src/cli.ts', 'run', workflowFile, '--interactive']
      : ['tsx', 'src/cli.ts', 'run', workflowFile, '--interactive'];
  const child = spawn(command, cliArgs, {
    cwd: process.cwd(),
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
  });

  let stdout = '';
  let stderr = '';
  let approvalPromptCount = 0;

  child.stdout.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    stdout += text;
    const nextCount = countOccurrences(stdout, 'approve/reject');
    while (approvalPromptCount < nextCount) {
      if (approvalPromptCount === 0) {
        child.stdin.write('reject\n');
        child.stdin.write('请补充一条命令行使用说明，并确认注释足够清晰。\n');
      } else {
        child.stdin.write('approve\n');
        child.stdin.end();
      }
      approvalPromptCount += 1;
    }
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });

  const [code] = (await Promise.race([
    once(child, 'exit'),
    once(child, 'error').then(([error]) => {
      throw error;
    }),
    new Promise<[number | null, NodeJS.Signals | null]>((_, reject) => {
      setTimeout(() => {
        child.kill();
        reject(new Error(`interactive workflow timeout\nstdout:\n${stdout}\nstderr:\n${stderr}`));
      }, 50000);
    }),
  ])) as [number | null, NodeJS.Signals | null];

  return { code, stdout, stderr };
}

describe('codex PTY 交互模式', () => {
  it('主示例会因缺少注释被验收打回，补注释后再进入人工确认并允许 reject 回流', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-codex-pty-'));
    const workflowDir = path.join(tempRoot, 'workspace');
    const workdir = path.join(workflowDir, 'workdir');
    const developContextDir = path.join(workflowDir, 'demo-dev');
    const verifyContextDir = path.join(workflowDir, 'demo-verify');
    const binDir = path.join(tempRoot, 'bin');
    await mkdir(workflowDir, { recursive: true });
    await mkdir(workdir, { recursive: true });
    await mkdir(binDir, { recursive: true });
    await copyDir(path.join(process.cwd(), 'examples', 'demo-dev'), developContextDir);
    await copyDir(path.join(process.cwd(), 'examples', 'demo-verify'), verifyContextDir);
    await createFakeCodex(binDir);

    const exampleWorkflowPath = path.join(process.cwd(), 'examples', 'codex-pty-demo.workflow.yaml');
    const workflowText = await readFile(exampleWorkflowPath, 'utf8');
    const patchedWorkflow = workflowText
      .replace('workdir: ./demo-workdir', 'workdir: ./workdir')
      .replace(/workdir: \.\/demo-workdir/gu, 'workdir: ./workdir')
      .replace('contextDir: ./demo-dev', `contextDir: ${toYamlSingleQuoted(developContextDir)}`)
      .replace('contextDir: ./demo-verify', `contextDir: ${toYamlSingleQuoted(verifyContextDir)}`)
      .replace('contextDir: ./demo-workdir', 'contextDir: ./workdir');
    const workflowFile = path.join(workflowDir, 'workflow.yaml');
    await writeFile(workflowFile, patchedWorkflow, 'utf8');

    const originalPath = process.env.PATH ?? '';
    const env = {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${originalPath}`,
    };

    const runResult = await runInteractiveWorkflow(workflowFile, env);
    const stdout = stripTerminalSequences(runResult.stdout);
    expect(runResult.code, `stdout:\n${stdout}\nstderr:\n${runResult.stderr}`).toBe(0);
    expect(runResult.stderr).toBe('');
    expect(stdout).toContain('verdict: reject');
    expect(stdout).toContain('missing the required comment');
    expect(stdout).toContain('verdict: approve');
    expect(stdout).toContain('approve/reject');
    expect(stdout).toContain('completed');

    const runDirMatch = stdout.match(/workspace:\s*(.+)/);
    expect(runDirMatch).not.toBeNull();
    const runDir = runDirMatch?.[1]?.trim();
    expect(runDir).toBeTruthy();

    const finalState = await readJson<{ status: string; currentNodeId: string | null }>(
      path.join(runDir!, 'state', 'run.json'),
    );
    expect(finalState.status).toBe('completed');
    expect(finalState.currentNodeId).toBeNull();

    const calcScript = await readFile(path.join(workdir, 'calc.js'), 'utf8');
    expect(calcScript).toContain('//');

    const developHistory = await readFile(path.join(workdir, 'develop-history.log'), 'utf8');
    expect(developHistory).toContain('hasVerifyReport=false;needsComments=false;hasHumanFeedback=false');
    expect(developHistory).toContain('hasVerifyReport=true;needsComments=true;hasHumanFeedback=false');
    expect(developHistory).toContain('hasHumanFeedback=true');

    const feedbackApplied = await readFile(path.join(workdir, 'feedback-applied.txt'), 'utf8');
    expect(feedbackApplied).toContain('请补充一条命令行使用说明，并确认注释足够清晰。');
  }, 60000);
});
