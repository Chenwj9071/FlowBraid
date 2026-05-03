import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { ensureDir } from '../utils.js';
import { RunInterruptedError, isAbortSignalTriggered } from '../errors.js';
import type { AgentSessionMessage } from '../types.js';
import type { AgentSessionTurnResult } from './types.js';

export interface CodexSessionTurnOptions {
  command?: string;
  cwd: string;
  workdir?: string;
  logPath: string;
  outputPath: string;
  schemaPath: string;
  env?: NodeJS.ProcessEnv;
  model?: string;
  messages: AgentSessionMessage[];
  onLine?: (line: string) => void;
  abortSignal?: AbortSignal;
}

export async function runCodexSessionTurn(options: CodexSessionTurnOptions): Promise<AgentSessionTurnResult> {
  await ensureDir(path.dirname(options.logPath));
  await ensureDir(path.dirname(options.outputPath));
  await ensureDir(path.dirname(options.schemaPath));
  if (isAbortSignalTriggered(options.abortSignal)) {
    throw new RunInterruptedError();
  }

  await writeFile(options.schemaPath, JSON.stringify(sessionTurnSchema, null, 2), 'utf8');

  const logStream = createWriteStream(options.logPath, { flags: 'a' });
  const command = options.command ?? 'codex';
  const args = [
    'exec',
    '--full-auto',
    '--skip-git-repo-check',
    '--output-schema',
    options.schemaPath,
    '--output-last-message',
    options.outputPath,
  ];
  if (options.workdir) {
    args.push('--cd', options.workdir);
  }
  if (options.model) {
    args.push('--model', options.model);
  }

  const child = spawn(command, args, {
    cwd: options.cwd,
    shell: true,
    env: options.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  child.stdin.end(buildCodexSessionPrompt(options.messages));

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

    const exit = result as { exitCode: number | null; signal: NodeJS.Signals | null };
    if ((exit.exitCode ?? 1) !== 0) {
      return {
        status: 'failed',
        message: `codex session turn failed with exit code ${exit.exitCode ?? 'null'}`,
      };
    }

    const raw = await readFile(options.outputPath, 'utf8');
    return JSON.parse(raw) as AgentSessionTurnResult;
  } finally {
    logStream.end();
    await once(logStream, 'finish').catch(() => undefined);
  }
}

function buildCodexSessionPrompt(messages: AgentSessionMessage[]): string {
  const transcript = messages
    .map((message) => {
      if (message.kind === 'event') {
        return `[event:${message.type ?? 'unknown'}] ${message.content}`;
      }
      return `[${message.role ?? 'user'}] ${message.content}`;
    })
    .join('\n');

  return [
    'You are executing a FlowBraid long-running agent_session node.',
    'Continue the task based on the complete conversation history below.',
    'Your final output must strictly follow the JSON schema. Do not wrap it in markdown.',
    'Rules:',
    '1. If you still need more information, confirmation, or instructions from the user, return status=waiting_input.',
    '2. If the task is complete and the workflow can move to the next node, return status=completed.',
    '3. If you cannot continue, return status=failed.',
    '4. message is shown to the user. summary may be used as a short completion summary.',
    '',
    'Conversation history:',
    transcript,
  ].join('\n');
}

const sessionTurnSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'message'],
  properties: {
    status: {
      type: 'string',
      enum: ['waiting_input', 'completed', 'failed'],
    },
    message: {
      type: 'string',
      minLength: 1,
    },
    summary: {
      type: 'string',
    },
    files: {
      type: 'array',
      items: {
        type: 'string',
      },
    },
  },
} as const;
