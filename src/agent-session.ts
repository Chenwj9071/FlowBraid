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
  return all.sort(compareAgentSessionMessages);
}

function compareAgentSessionMessages(left: AgentSessionMessage, right: AgentSessionMessage): number {
  const leftTurn = left.turn ?? Number.MAX_SAFE_INTEGER;
  const rightTurn = right.turn ?? Number.MAX_SAFE_INTEGER;
  if (leftTurn !== rightTurn) {
    return leftTurn - rightTurn;
  }

  const leftRank = getAgentMessageRank(left);
  const rightRank = getAgentMessageRank(right);
  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }

  const leftTime = Date.parse(left.at);
  const rightTime = Date.parse(right.at);
  const leftHasTime = Number.isFinite(leftTime);
  const rightHasTime = Number.isFinite(rightTime);
  if (leftHasTime && rightHasTime && leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  if (leftHasTime !== rightHasTime) {
    return leftHasTime ? -1 : 1;
  }

  return left.content.localeCompare(right.content);
}

function getAgentMessageRank(message: AgentSessionMessage): number {
  if (message.kind === 'message') {
    if (message.role === 'system') {
      return 0;
    }
    if (message.role === 'user') {
      return 1;
    }
    if (message.role === 'assistant') {
      return 2;
    }
  }
  return 3;
}
