import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { appendText, nowIso, readJson, writeJson } from './utils.js';
import type { AgentSessionMessage, AgentSessionState } from './types.js';

export function getAgentSessionPaths(nodeDir: string): {
  inboxPath: string;
  outboxPath: string;
  sessionStatePath: string;
  schemaPath: string;
  turnOutputPath: string;
} {
  return {
    inboxPath: path.join(nodeDir, 'messages', 'inbox.jsonl'),
    outboxPath: path.join(nodeDir, 'messages', 'outbox.jsonl'),
    sessionStatePath: path.join(nodeDir, 'state', 'session.json'),
    schemaPath: path.join(nodeDir, 'state', 'session-schema.json'),
    turnOutputPath: path.join(nodeDir, 'artifacts', 'session-turn-result.json'),
  };
}

export async function writeAgentSessionState(filePath: string, state: AgentSessionState): Promise<void> {
  state.updatedAt = nowIso();
  await writeJson(filePath, state);
}

export async function readAgentSessionState(filePath: string): Promise<AgentSessionState> {
  return readJson<AgentSessionState>(filePath);
}

export async function appendAgentSessionMessage(filePath: string, message: AgentSessionMessage): Promise<void> {
  await appendText(filePath, `${JSON.stringify(message)}\n`);
}

export async function readAgentSessionMessages(...paths: string[]): Promise<AgentSessionMessage[]> {
  const all: AgentSessionMessage[] = [];
  for (const filePath of paths) {
    try {
      const raw = await readFile(filePath, 'utf8');
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        all.push(JSON.parse(trimmed) as AgentSessionMessage);
      }
    } catch {
      // ignore missing files before first turn
    }
  }
  return all;
}

