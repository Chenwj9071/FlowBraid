import { spawn } from 'node:child_process';
import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { ensureDir } from '../utils.js';

export interface ShellExecutionOptions {
  command: string;
  cwd: string;
  logPath: string;
  env?: NodeJS.ProcessEnv;
  onLine?: (line: string) => void;
}

export interface ShellExecutionResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export async function runShellCommand(options: ShellExecutionOptions): Promise<ShellExecutionResult> {
  await ensureDir(path.dirname(options.logPath));
  const logStream = createWriteStream(options.logPath, { flags: 'a' });
  const child = spawn(options.command, {
    cwd: options.cwd,
    shell: true,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const writeLine = async (chunk: Buffer | string, channel: 'stdout' | 'stderr'): Promise<void> => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      if (line.length === 0) {
        continue;
      }
      const formatted = `[${channel}] ${line}\n`;
      logStream.write(formatted);
      options.onLine?.(formatted.trimEnd());
    }
  };

  child.stdout?.on('data', (chunk: Buffer) => {
    void writeLine(chunk, 'stdout');
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    void writeLine(chunk, 'stderr');
  });

  const result = await Promise.race([
    once(child, 'exit').then(([exitCode, signal]) => ({ exitCode, signal })),
    once(child, 'error').then(([error]) => {
      throw error;
    }),
  ]);

  logStream.end();
  await once(logStream, 'finish').catch(() => undefined);
  return result as ShellExecutionResult;
}
