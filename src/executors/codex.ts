import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { spawn as spawnPty, type IPty } from 'node-pty';
import { ensureDir } from '../utils.js';
import type { TerminalSession } from '../types.js';
import { RunInterruptedError, isAbortSignalTriggered } from '../errors.js';

export interface CodexExecutionOptions {
  command?: string;
  cwd: string;
  logPath: string;
  outputPath: string;
  prompt: string;
  model?: string;
  onLine?: (line: string) => void;
  env?: NodeJS.ProcessEnv;
  interactiveTerminal?: TerminalSession;
  abortSignal?: AbortSignal;
}

export interface CodexExecutionResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export async function runCodexTask(options: CodexExecutionOptions): Promise<CodexExecutionResult> {
  await ensureDir(path.dirname(options.logPath));
  await ensureDir(path.dirname(options.outputPath));
  if (isAbortSignalTriggered(options.abortSignal)) {
    throw new RunInterruptedError();
  }

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
  if (options.interactiveTerminal) {
    try {
      const result = await runInteractiveCodexSession({
        command: codexCommand,
        args,
        cwd: options.cwd,
        logStream,
        prompt: options.prompt,
        env: options.env,
        terminal: options.interactiveTerminal,
        abortSignal: options.abortSignal,
      });
      return result;
    } finally {
      logStream.end();
      await once(logStream, 'finish').catch(() => undefined);
    }
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

    return result as CodexExecutionResult;
  } finally {
    logStream.end();
    await once(logStream, 'finish').catch(() => undefined);
  }
}

interface InteractiveCodexSessionOptions {
  command: string;
  args: string[];
  cwd: string;
  logStream: NodeJS.WritableStream;
  prompt: string;
  env?: NodeJS.ProcessEnv;
  terminal: TerminalSession;
  abortSignal?: AbortSignal;
}

async function runInteractiveCodexSession(options: InteractiveCodexSessionOptions): Promise<CodexExecutionResult> {
  const cols = options.terminal.output.columns ?? 80;
  const rows = options.terminal.output.rows ?? 24;
  const ptyCommand = resolveInteractiveCommand(options.command);
  const ptyArgs = [...options.args, normalizePromptForShell(options.prompt)];

  const ptyProcess: IPty = spawnPty(ptyCommand, ptyArgs, {
    cwd: options.cwd,
    env: options.env,
    name: 'xterm-256color',
    cols,
    rows,
    useConpty: process.platform === 'win32',
  });

  const transcript: string[] = [];
  let terminalOutputBroken = false;
  const handleTerminalError = (): void => {
    terminalOutputBroken = true;
  };
  options.terminal.output.on('error', handleTerminalError);
  options.logStream.on('error', handleTerminalError);
  const writeOutput = (data: string): void => {
    transcript.push(data);
    try {
      options.logStream.write(data);
    } catch {
      // ignore log write failures during shutdown
    }
    if (!terminalOutputBroken) {
      try {
        options.terminal.output.write(data);
      } catch {
        terminalOutputBroken = true;
      }
    }
  };
  const output = options.terminal.output;
  const canResize = typeof output.on === 'function' && typeof output.columns === 'number' && typeof output.rows === 'number';
  const handleResize = (): void => {
    if (typeof output.columns === 'number' && typeof output.rows === 'number') {
      ptyProcess.resize(output.columns, output.rows);
    }
  };
  if (canResize) {
    output.on('resize', handleResize);
  }

  const abortPromise = new Promise<never>((_, reject) => {
    const signal = options.abortSignal;
    if (!signal) {
      return;
    }
    const handleAbort = (): void => {
      try {
        ptyProcess.kill();
      } catch {
        // ignore PTY kill errors during interrupt
      }
      reject(new RunInterruptedError());
    };
    signal.addEventListener('abort', handleAbort, { once: true });
    ptyProcess.onExit(() => {
      signal.removeEventListener('abort', handleAbort);
    });
  });

  const exitPromise = new Promise<CodexExecutionResult>((resolve) => {
    ptyProcess.onExit(({ exitCode }) => {
      resolve({
        exitCode,
        signal: null,
      });
    });
  });

  ptyProcess.onData((data) => {
    writeOutput(data);
  });

  try {
    const result = await Promise.race([exitPromise, abortPromise]);
    return result;
  } finally {
    if (canResize) {
      output.removeListener('resize', handleResize);
    }
    options.terminal.output.removeListener('error', handleTerminalError);
    options.logStream.removeListener('error', handleTerminalError);
    try {
      ptyProcess.kill();
    } catch {
      // ignore process already exited
    }
    try {
      (ptyProcess as IPty & { dispose?: () => void }).dispose?.();
    } catch {
      // ignore cleanup errors after exit
    }
  }
}

function normalizePromptForShell(prompt: string): string {
  return prompt.replace(/\r?\n+/gu, ' ').trim();
}

function resolveInteractiveCommand(command: string): string {
  if (process.platform !== 'win32') {
    return command;
  }

  if (/\.(cmd|exe)$/iu.test(command)) {
    return command;
  }

  return `${command}.cmd`;
}
