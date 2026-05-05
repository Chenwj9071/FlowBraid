import path from 'node:path';
import os from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  getExternalSessionPath,
  readExternalSessionState,
  writeExternalSessionState,
} from '../src/external-session.js';
import type { ExternalSessionState } from '../src/types.js';

describe('external session 状态协议', () => {
  it('支持写入和读取 launching 状态', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-external-session-'));
    const nodeDir = path.join(tempRoot, 'nodes', 'develop');
    const sessionPath = getExternalSessionPath(nodeDir);

    const launchingState: ExternalSessionState = {
      mode: 'detached_terminal',
      status: 'launching',
      startedAt: '2026-05-03T10:00:00.000Z',
      updatedAt: '2026-05-03T10:00:00.000Z',
      terminalPid: 1234,
      workerPid: 5678,
      resultFile: 'artifacts/develop-last-message.md',
    };

    await writeExternalSessionState(sessionPath, launchingState);
    const loaded = await readExternalSessionState(sessionPath);

    expect(loaded).toEqual(launchingState);
  });

  it('支持更新到 running 和 completed 状态', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-external-session-'));
    const nodeDir = path.join(tempRoot, 'nodes', 'verify');
    const sessionPath = getExternalSessionPath(nodeDir);

    const runningState: ExternalSessionState = {
      mode: 'detached_terminal',
      status: 'running',
      startedAt: '2026-05-03T10:00:00.000Z',
      updatedAt: '2026-05-03T10:00:10.000Z',
      terminalPid: 2001,
      workerPid: 2002,
      codexPid: 2003,
      resultFile: 'artifacts/verify-report.md',
    };

    await writeExternalSessionState(sessionPath, runningState);

    const completedState: ExternalSessionState = {
      ...runningState,
      status: 'completed',
      updatedAt: '2026-05-03T10:01:00.000Z',
      completedAt: '2026-05-03T10:01:00.000Z',
      exitCode: 0,
      closeRequestedAt: '2026-05-03T10:01:01.000Z',
      closeObservedAt: '2026-05-03T10:01:02.000Z',
    };

    await writeExternalSessionState(sessionPath, completedState);
    const loaded = await readExternalSessionState(sessionPath);

    expect(loaded.status).toBe('completed');
    expect(loaded.exitCode).toBe(0);
    expect(loaded.codexPid).toBe(2003);
    expect(loaded.closeObservedAt).toBe('2026-05-03T10:01:02.000Z');
  });

  it('支持 failed 状态及错误信息', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-external-session-'));
    const nodeDir = path.join(tempRoot, 'nodes', 'develop');
    const sessionPath = getExternalSessionPath(nodeDir);

    const failedState: ExternalSessionState = {
      mode: 'detached_terminal',
      status: 'failed',
      startedAt: '2026-05-03T10:00:00.000Z',
      updatedAt: '2026-05-03T10:00:30.000Z',
      completedAt: '2026-05-03T10:00:30.000Z',
      terminalPid: 3001,
      workerPid: 3002,
      exitCode: 1,
      signal: 'SIGTERM',
      error: 'codex failed to start',
      resultFile: 'artifacts/develop-last-message.md',
    };

    await writeExternalSessionState(sessionPath, failedState);
    const loaded = await readExternalSessionState(sessionPath);

    expect(loaded.status).toBe('failed');
    expect(loaded.error).toBe('codex failed to start');
    expect(loaded.signal).toBe('SIGTERM');
  });
});
