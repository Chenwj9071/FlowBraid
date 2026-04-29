import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { ensureDir } from '../utils.js';

export interface CodexExecutionOptions {
  command?: string;
  cwd: string;
  logPath: string;
  outputPath: string;
  prompt: string;
  model?: string;
  onLine?: (line: string) => void;
  env?: NodeJS.ProcessEnv;
}

export interface CodexExecutionResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export async function runCodexTask(options: CodexExecutionOptions): Promise<CodexExecutionResult> {
  await ensureDir(path.dirname(options.logPath));
  await ensureDir(path.dirname(options.outputPath));

  const logStream = createWriteStream(options.logPath, { flags: 'a' });
  const codexCommand = options.command ?? 'codex';
  const args = [
    'exec',
    '--full-auto',
    '--skip-git-repo-check',
    '--output-last-message',
    options.outputPath,
    '-C',
    options.cwd,
  ];
  if (options.model) {
    args.push('--model', options.model);
  }

  const child = spawn(codexCommand, args, {
    cwd: options.cwd,
    shell: true,
    env: options.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  child.stdin.end(options.prompt);

  const forward = async (chunk: Buffer | string, channel: 'stdout' | 'stderr'): Promise<void> => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    for (const line of text.split(/\r?\n/)) {
      if (!line) {
        continue;
      }
      const formatted = `[${channel}] ${line}\n`;
      logStream.write(formatted);
      options.onLine?.(formatted.trimEnd());
    }
  };

  child.stdout?.on('data', (chunk: Buffer) => {
    void forward(chunk, 'stdout');
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    void forward(chunk, 'stderr');
  });

  const result = await Promise.race([
    once(child, 'exit').then(([exitCode, signal]) => ({ exitCode, signal })),
    once(child, 'error').then(([error]) => {
      throw error;
    }),
  ]);

  logStream.end();
  await once(logStream, 'finish').catch(() => undefined);
  return result as CodexExecutionResult;
}
