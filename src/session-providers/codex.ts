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
    '-C',
    options.cwd,
  ];
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
    '你正在执行 FlowBraid 的长期交互 agent_session 节点。',
    '你必须基于下面的完整会话历史继续工作。',
    '你的最终输出必须严格符合 JSON schema，不要输出 markdown 包裹。',
    '规则：',
    '1. 如果还需要用户补充信息、确认或进一步指令，返回 status=waiting_input。',
    '2. 如果任务已经完成且可以流转到下一个节点，返回 status=completed。',
    '3. 如果无法继续，返回 status=failed。',
    '4. message 字段写给用户看，summary 可用于 completed 的简短总结。',
    '',
    '会话历史：',
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

