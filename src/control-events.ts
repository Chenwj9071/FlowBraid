import { nowIso } from './utils.js';
import { appendControlEvent, createControlEventId, createOperationId, hasControlOperation } from './control-log.js';
import type { ControlEventKind, ControlEventRecord } from './types.js';

export interface AcceptControlEventInput {
  controlLogPath: string;
  runId: string;
  nodeId: string;
  attemptId: string;
  kind: ControlEventKind;
  source: ControlEventRecord['source'];
  payload?: Record<string, unknown>;
  operationId?: string;
  at?: string;
}

export async function acceptControlEvent(input: AcceptControlEventInput): Promise<{ accepted: boolean; operationId: string }> {
  const operationId = input.operationId ?? createOperationId();
  if (await hasControlOperation(input.controlLogPath, input.attemptId, operationId)) {
    return { accepted: false, operationId };
  }

  await appendControlEvent(input.controlLogPath, {
    version: 1,
    eventId: createControlEventId(),
    operationId,
    runId: input.runId,
    nodeId: input.nodeId,
    attemptId: input.attemptId,
    source: input.source,
    kind: input.kind,
    at: input.at ?? nowIso(),
    payload: input.payload,
  });

  return { accepted: true, operationId };
}
