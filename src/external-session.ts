import path from 'node:path';
import type { ExternalSessionState } from './types.js';
import { readJson, writeJson } from './utils.js';

export function getExternalSessionPath(nodeDir: string): string {
  return path.join(nodeDir, 'state', 'external-session.json');
}

export async function readExternalSessionState(filePath: string): Promise<ExternalSessionState> {
  return readJson<ExternalSessionState>(filePath);
}

export async function writeExternalSessionState(filePath: string, state: ExternalSessionState): Promise<void> {
  await writeJson(filePath, state);
}
