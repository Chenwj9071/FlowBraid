import path from 'node:path';
import os from 'node:os';
import { readdir, readFile, stat } from 'node:fs/promises';
import type { NativeSessionState } from './types.js';
import { appendText, readJson, writeJson } from './utils.js';

export function getNativeSessionPath(nodeDir: string): string {
  return path.join(nodeDir, 'state', 'native-session.json');
}

export async function readNativeSessionState(filePath: string): Promise<NativeSessionState> {
  return readJson<NativeSessionState>(filePath);
}

export async function writeNativeSessionState(filePath: string, state: NativeSessionState): Promise<void> {
  await writeJson(filePath, state);
}

const nativeSessionUpdateLocks = new Map<string, Promise<void>>();

export async function updateNativeSessionState(
  filePath: string,
  updater: (current: NativeSessionState | null) => NativeSessionState | Promise<NativeSessionState>,
): Promise<NativeSessionState> {
  const previous = nativeSessionUpdateLocks.get(filePath) ?? Promise.resolve();
  let release!: () => void;
  const currentLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  nativeSessionUpdateLocks.set(filePath, previous.then(() => currentLock));

  await previous;
  try {
    const current = await readNativeSessionState(filePath).catch(() => null);
    const next = await updater(current);
    await writeNativeSessionState(filePath, next);
    return next;
  } finally {
    release();
    if (nativeSessionUpdateLocks.get(filePath) === currentLock) {
      nativeSessionUpdateLocks.delete(filePath);
    }
  }
}

export async function appendNativeNodeEvent(messagesDir: string, payload: Record<string, unknown>): Promise<void> {
  await appendText(path.join(messagesDir, 'events.jsonl'), `${JSON.stringify(payload)}\n`);
}

export async function readLatestNativeTerminalEvent(
  messagesDir: string,
  nodeId: string,
  attemptId: string,
  startedAt?: string,
): Promise<{
  status: 'completed' | 'failed' | 'paused';
  result: NonNullable<NativeSessionState['result']>;
}> {
  const filePath = path.join(messagesDir, 'events.jsonl');
  const content = await readFile(filePath, 'utf8');
  const lines = content
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]) as {
        type?: string;
        nodeId?: string;
        attemptId?: string;
        at?: string;
        summary?: string;
        message?: string;
        reason?: string;
      };
      if (parsed.nodeId !== nodeId) {
        continue;
      }
      if (parsed.attemptId !== attemptId) {
        continue;
      }
      if (startedAt && parsed.at && Date.parse(parsed.at) < Date.parse(startedAt)) {
        continue;
      }
      if (parsed.type === 'node.native.completed') {
        return {
          status: 'completed',
          result: {
            kind: 'complete',
            summary: parsed.summary,
          },
        };
      }
      if (parsed.type === 'node.native.failed') {
        return {
          status: 'failed',
          result: {
            kind: 'fail',
            message: parsed.message,
          },
        };
      }
      if (parsed.type === 'node.native.paused') {
        return {
          status: 'paused',
          result: {
            kind: 'pause',
            reason: parsed.reason,
          },
        };
      }
    } catch {
      continue;
    }
  }

  throw new Error(`No native terminal event found for node ${nodeId} attempt ${attemptId}`);
}

export async function readLatestCodexSessionId(cwd: string, rootDir = path.join(os.homedir(), '.codex', 'sessions')): Promise<string | null> {
  try {
    const files = await collectSessionFiles(rootDir);
    const ranked = await Promise.all(
      files.map(async (filePath) => ({
        filePath,
        stat: await stat(filePath),
      })),
    );
    ranked.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

    for (const entry of ranked) {
      const session = await readSessionMeta(entry.filePath);
      if (session && normalizePath(session.cwd) === normalizePath(cwd)) {
        return session.id;
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function collectSessionFiles(rootDir: string): Promise<string[]> {
  const pending = [rootDir];
  const files: string[] = [];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) {
      continue;
    }
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(fullPath);
        continue;
      }
      if (entry.isFile() && fullPath.endsWith('.jsonl')) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

async function readSessionMeta(filePath: string): Promise<{ id: string; cwd: string } | null> {
  try {
    const content = await readFile(filePath, 'utf8');
    const firstLine = content.split(/\r?\n/gu).find((line) => line.trim());
    if (!firstLine) {
      return null;
    }
    const parsed = JSON.parse(firstLine) as {
      type?: string;
      payload?: { id?: string; cwd?: string };
    };
    if (parsed.type !== 'session_meta' || !parsed.payload?.id || !parsed.payload.cwd) {
      return null;
    }
    return { id: parsed.payload.id, cwd: parsed.payload.cwd };
  } catch {
    return null;
  }
}

function normalizePath(value: string): string {
  return path.resolve(value).toLowerCase();
}
