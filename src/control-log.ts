import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import type { ControlEventKind, ControlEventRecord, NodeRuntimeState } from './types.js';
import { appendText, nowIso, writeJson } from './utils.js';

export function getControlLogPath(nodeDir: string): string {
  return path.join(nodeDir, 'state', 'control-log.jsonl');
}

export function createOperationId(): string {
  return `op_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createControlEventId(): string {
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function appendControlEvent(logPath: string, event: ControlEventRecord): Promise<void> {
  await mkdir(path.dirname(logPath), { recursive: true });
  await appendText(logPath, `${JSON.stringify(event)}\n`);
}

export async function readControlEvents(logPath: string): Promise<ControlEventRecord[]> {
  try {
    const content = await readFile(logPath, 'utf8');
    return parseControlLog(content);
  } catch {
    return [];
  }
}

function parseControlLog(content: string): ControlEventRecord[] {
  return content
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ControlEventRecord);
}

export async function hasControlOperation(logPath: string, attemptId: string, operationId: string): Promise<boolean> {
  const events = await readControlEvents(logPath);
  return events.some((event) => event.attemptId === attemptId && event.operationId === operationId);
}

export async function deriveRuntimeStateFromControlLog(
  logPath: string,
  nodeId: string,
): Promise<NodeRuntimeState | null> {
  const events = await readControlEvents(logPath);
  if (events.length === 0) {
    return null;
  }

  const latestAttemptId = events.at(-1)?.attemptId;
  if (!latestAttemptId) {
    return null;
  }

  const latestEvents = events.filter((event) => event.attemptId === latestAttemptId);
  const state: NodeRuntimeState = {
    nodeId,
    attemptId: latestAttemptId,
    status: 'launching',
    startedAt: latestEvents[0]?.at ?? nowIso(),
    updatedAt: latestEvents.at(-1)?.at ?? nowIso(),
  };

  for (const event of latestEvents) {
    state.updatedAt = event.at;
    switch (event.kind) {
      case 'attempt.started':
        state.status = 'running';
        break;
      case 'complete':
        state.status = 'completed';
        state.outcome = typeof event.payload?.outcome === 'string' ? event.payload.outcome : undefined;
        state.summary = typeof event.payload?.summary === 'string' ? event.payload.summary : undefined;
        state.completedAt = event.at;
        break;
      case 'fail':
        state.status = 'failed';
        state.reason = typeof event.payload?.message === 'string' ? event.payload.message : undefined;
        state.error = state.reason;
        state.completedAt = event.at;
        break;
      case 'pause':
        state.status = 'paused';
        state.reason = typeof event.payload?.reason === 'string' ? event.payload.reason : undefined;
        state.completedAt = event.at;
        break;
      case 'artifact':
        state.lastArtifactPath = typeof event.payload?.file === 'string' ? event.payload.file : state.lastArtifactPath;
        break;
      case 'attempt.superseded':
        state.status = 'canceled';
        state.reason = typeof event.payload?.reason === 'string' ? event.payload.reason : 'superseded by a newer attempt';
        state.completedAt = event.at;
        break;
      case 'recovery.orphaned':
        state.status = 'failed';
        state.reason = typeof event.payload?.reason === 'string' ? event.payload.reason : 'orphaned';
        state.error = state.reason;
        state.completedAt = event.at;
        break;
      case 'heartbeat':
        if (state.status === 'launching') {
          state.status = 'running';
        }
        break;
      default:
        break;
    }
  }

  return state;
}

export async function writeDerivedRuntimeState(filePath: string, state: NodeRuntimeState | null): Promise<void> {
  if (!state) {
    return;
  }
  await writeJson(filePath, state);
}

export function buildControlPayload(kind: ControlEventKind, fields: Record<string, unknown>): Record<string, unknown> {
  return { kind, ...fields };
}
