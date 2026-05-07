import path from 'node:path';
import type { NodeRuntimeState } from './types.js';
import { appendText, readJson, writeJson } from './utils.js';

export function getNodeRuntimeStatePath(nodeDir: string): string {
  return path.join(nodeDir, 'state', 'runtime-state.json');
}

export async function readNodeRuntimeState(filePath: string): Promise<NodeRuntimeState> {
  return readJson<NodeRuntimeState>(filePath);
}

export async function writeNodeRuntimeState(filePath: string, state: NodeRuntimeState): Promise<void> {
  await writeJson(filePath, state);
}

export async function appendNodeRuntimeEvent(messagesDir: string, payload: Record<string, unknown>): Promise<void> {
  await appendText(path.join(messagesDir, 'events.jsonl'), `${JSON.stringify(payload)}\n`);
}
