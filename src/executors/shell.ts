import { spawn } from 'node:child_process';
import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { ensureDir } from '../utils.js';
import { RunInterruptedError, isAbortSignalTriggered } from '../errors.js';

export interface ShellExecutionOptions {
  command: string;
  cwd: string;
  logPath: string;
  env?: NodeJS.ProcessEnv;
  onLine?: (line: string) => void;
  abortSignal?: AbortSignal;
}

export interface ShellExecutionResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export async function runShellCommand(options: ShellExecutionOptions): Promise<ShellExecutionResult> {
  await ensureDir(path.dirname(options.logPath));
  if (isAbortSignalTriggered(options.abortSignal)) {
    throw new RunInterruptedError();
  }
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

  const abortPromise = new Promise<never>((_, reject) => {
    const signal = options.abortSignal;
    if (!signal) {
      return;
    }
    const handleAbort = (): void => {
      try {
        child.kill();
      } catch {
        // ignore kill errors during interrupt
      }
      reject(new RunInterruptedError());
    };
    signal.addEventListener('abort', handleAbort, { once: true });
    child.once('exit', () => {
      signal.removeEventListener('abort', handleAbort);
    });
  });

  try {
    const result = await Promise.race([
      once(child, 'exit').then(([exitCode, signal]) => ({ exitCode, signal })),
      once(child, 'error').then(([error]) => {
        throw error;
      }),
      abortPromise,
    ]);

    return result as ShellExecutionResult;
  } finally {
    logStream.end();
    await once(logStream, 'finish').catch(() => undefined);
  }
}
