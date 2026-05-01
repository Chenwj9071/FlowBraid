import path from 'node:path';
import os from 'node:os';
import { chmod, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { readJson } from '../src/utils.js';

function stripAnsi(text: string): string {
  return text.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '');
}

async function createFakeExecCodex(binDir: string): Promise<void> {
  const fakeScript = `
const fs = require('node:fs');
const path = require('node:path');

function findCwd(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-C' || arg === '--cd') {
      return argv[i + 1] || process.cwd();
    }
  }
  return process.cwd();
}

function findPrompt(argv) {
  for (let i = argv.length - 1; i >= 0; i -= 1) {
    const arg = argv[i];
    if (!arg.startsWith('-') && arg !== 'exec') {
      return arg;
    }
  }
  return '';
}

const args = process.argv.slice(2);
const cwd = findCwd(args);
const prompt = findPrompt(args);
const sessionDir = path.join(cwd, 'generated');
fs.mkdirSync(sessionDir, { recursive: true });
fs.writeFileSync(path.join(sessionDir, 'interactive-prompt.txt'), prompt, 'utf8');
process.stdout.write('fake codex exec ready\\n');
process.stdout.write(\`fake codex prompt: \${prompt}\\n\`);
setTimeout(() => process.exit(0), 100);
`;

  const scriptPath = path.join(binDir, 'fake-codex.js');
  const cmdPath = path.join(binDir, 'codex.cmd');
  const shPath = path.join(binDir, 'codex');
  await writeFile(scriptPath, fakeScript, 'utf8');
  await writeFile(cmdPath, '@echo off\r\nnode "%~dp0fake-codex.js" %*\r\n', 'utf8');
  await writeFile(shPath, '#!/usr/bin/env sh\nnode "$(dirname "$0")/fake-codex.js" "$@"\n', 'utf8');
  await chmod(shPath, 0o755);
}

async function runInteractiveWorkflow(workflowFile: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const command = process.platform === 'win32' ? 'cmd.exe' : 'npx';
  const cliArgs =
    process.platform === 'win32'
      ? ['/c', 'npx', 'tsx', 'src/cli.ts', 'run', workflowFile, '--interactive']
      : ['tsx', 'src/cli.ts', 'run', workflowFile, '--interactive'];
  const child = spawn(command, cliArgs, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
  });

  let stdout = '';
  let stderr = '';
  let gateContinued = false;

  child.stdout.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    stdout += text;
    if (!gateContinued && text.includes('按回车继续')) {
      gateContinued = true;
      setTimeout(() => {
        child.stdin.write('\n');
      }, 100);
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
      }, 10000);
    }),
  ])) as [number | null, NodeJS.Signals | null];

  return { code, stdout, stderr };
}

describe('codex PTY 交互模式', () => {
  it('run --interactive 时 codex exec 结束后会回到主流程继续后续节点', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-codex-pty-'));
    const workflowDir = path.join(tempRoot, 'workspace');
    const binDir = path.join(tempRoot, 'bin');
    await mkdir(workflowDir, { recursive: true });
    await mkdir(binDir, { recursive: true });
    await createFakeExecCodex(binDir);

    const originalPath = process.env.PATH ?? '';
    process.env.PATH = `${binDir};${originalPath}`;
    try {
      const workflowFile = path.join(workflowDir, 'workflow.yaml');
      const workflow = `
id: codex-pty-demo
start: develop
nodes:
  develop:
    type: codex
    mode: exec
    prompt: prompt-marker-123 write a tiny test script and exit when done
    outputFile: develop-session.md
    next: pause
  pause:
    type: gate
    prompt: codex finished, continue
    next: done
  done:
    type: end
    message: done
`;
      await writeFile(workflowFile, workflow, 'utf8');

      const runResult = await runInteractiveWorkflow(workflowFile);
      const stdout = stripAnsi(runResult.stdout);
      expect(runResult.code).toBe(0);
      expect(runResult.stderr).toBe('');
      expect(stdout).toContain('fake codex exec ready');
      expect(stdout).toContain('fake codex prompt:');
      expect(stdout).toContain('按回车继续');
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

      const promptText = await readFile(path.join(workflowDir, 'generated', 'interactive-prompt.txt'), 'utf8');
      expect(promptText).toContain('prompt-marker-123');
    } finally {
      process.env.PATH = originalPath;
    }
  }, 30000);
});
