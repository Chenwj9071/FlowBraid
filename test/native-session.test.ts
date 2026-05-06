import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, utimes, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  appendNativeNodeEvent,
  getNativeSessionPath,
  readLatestCodexSessionId,
  readLatestNativeTerminalEvent,
  readNativeSessionState,
  updateNativeSessionState,
  writeNativeSessionState,
} from '../src/native-session.js';

describe('native session state', () => {
  it('writes and reads native session snapshots', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-native-session-'));
    const nodeDir = path.join(tempRoot, 'nodes', 'develop');
    await mkdir(path.join(nodeDir, 'state'), { recursive: true });

    const sessionPath = getNativeSessionPath(nodeDir);
    await writeNativeSessionState(sessionPath, {
      mode: 'native_split_terminal',
      status: 'running',
      terminalPid: 1001,
      startedAt: '2026-05-05T00:00:00.000Z',
      updatedAt: '2026-05-05T00:00:10.000Z',
    });

    const state = await readNativeSessionState(sessionPath);
    expect(state.mode).toBe('native_split_terminal');
    expect(state.status).toBe('running');
    expect(state.terminalPid).toBe(1001);
  });

  it('appends native node events to events.jsonl', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-native-session-'));
    const messagesDir = path.join(tempRoot, 'messages');
    await mkdir(messagesDir, { recursive: true });

    await appendNativeNodeEvent(messagesDir, {
      type: 'node.native.completed',
      nodeId: 'develop',
      at: '2026-05-05T00:00:20.000Z',
      summary: 'updated calc.js',
    });

    const content = await readFile(path.join(messagesDir, 'events.jsonl'), 'utf8');
    expect(content).toContain('"type":"node.native.completed"');
    expect(content).toContain('"nodeId":"develop"');
    expect(content).toContain('"summary":"updated calc.js"');
  });

  it('keeps the latest native session snapshot', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-native-session-'));
    const nodeDir = path.join(tempRoot, 'nodes', 'verify');
    await mkdir(path.join(nodeDir, 'state'), { recursive: true });

    const sessionPath = getNativeSessionPath(nodeDir);
    await writeNativeSessionState(sessionPath, {
      mode: 'native_split_terminal',
      status: 'launching',
      terminalPid: 2001,
      startedAt: '2026-05-05T00:00:00.000Z',
      updatedAt: '2026-05-05T00:00:01.000Z',
    });
    await writeNativeSessionState(sessionPath, {
      mode: 'native_split_terminal',
      status: 'completed',
      terminalPid: 2001,
      startedAt: '2026-05-05T00:00:00.000Z',
      updatedAt: '2026-05-05T00:00:30.000Z',
      completedAt: '2026-05-05T00:00:30.000Z',
      result: {
        kind: 'complete',
        summary: 'verification passed',
      },
    });

    const state = await readNativeSessionState(sessionPath);
    expect(state.status).toBe('completed');
    expect(state.result?.kind).toBe('complete');
    expect(state.result?.summary).toBe('verification passed');
  });

  it('finds the latest codex session id for the same workdir', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-native-session-'));
    const sessionsRoot = path.join(tempRoot, '.codex', 'sessions', '2026', '05', '05');
    const matchingDir = path.join(tempRoot, 'workspace');
    const otherDir = path.join(tempRoot, 'other');
    await mkdir(sessionsRoot, { recursive: true });
    await mkdir(matchingDir, { recursive: true });
    await mkdir(otherDir, { recursive: true });

    const older = path.join(sessionsRoot, 'older.jsonl');
    const newer = path.join(sessionsRoot, 'newer.jsonl');
    const ignored = path.join(sessionsRoot, 'ignored.jsonl');

    await writeFile(older, `${JSON.stringify({ type: 'session_meta', payload: { id: 'session-old', cwd: matchingDir } })}\n`, 'utf8');
    await writeFile(newer, `${JSON.stringify({ type: 'session_meta', payload: { id: 'session-new', cwd: matchingDir } })}\n`, 'utf8');
    await writeFile(ignored, `${JSON.stringify({ type: 'session_meta', payload: { id: 'session-other', cwd: otherDir } })}\n`, 'utf8');

    await new Promise((resolve) => setTimeout(resolve, 20));
    await utimes(newer, new Date(), new Date(Date.now() + 1000));

    const sessionId = await readLatestCodexSessionId(matchingDir, path.join(tempRoot, '.codex', 'sessions'));
    expect(sessionId).toBe('session-new');
  });

  it('reads the latest terminal event for a native node from events.jsonl', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-native-session-'));
    const messagesDir = path.join(tempRoot, 'messages');
    await mkdir(messagesDir, { recursive: true });

    await appendNativeNodeEvent(messagesDir, {
      type: 'node.native.artifact',
      nodeId: 'develop',
      attemptId: 'attempt-develop-1',
      at: '2026-05-05T00:00:05.000Z',
      file: 'artifacts\\develop-last-message.md',
    });
    await appendNativeNodeEvent(messagesDir, {
      type: 'node.native.completed',
      nodeId: 'develop',
      attemptId: 'attempt-develop-1',
      at: '2026-05-05T00:00:10.000Z',
      summary: 'done',
    });

    const event = await readLatestNativeTerminalEvent(messagesDir, 'develop', 'attempt-develop-1');
    expect(event?.status).toBe('completed');
    expect(event?.result?.kind).toBe('complete');
    expect(event?.result?.summary).toBe('done');
  });

  it('merges later artifact updates without downgrading a completed session', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-native-session-'));
    const nodeDir = path.join(tempRoot, 'nodes', 'develop');
    await mkdir(path.join(nodeDir, 'state'), { recursive: true });

    const sessionPath = getNativeSessionPath(nodeDir);
    await writeNativeSessionState(sessionPath, {
      mode: 'native_split_terminal',
      status: 'completed',
      terminalPid: 3001,
      startedAt: '2026-05-05T00:00:00.000Z',
      updatedAt: '2026-05-05T00:00:20.000Z',
      completedAt: '2026-05-05T00:00:20.000Z',
      result: {
        kind: 'complete',
        summary: 'done',
      },
    });

    await updateNativeSessionState(sessionPath, (current) => ({
      ...(current ?? {
        mode: 'native_split_terminal',
        status: 'launching',
        startedAt: '2026-05-05T00:00:00.000Z',
        updatedAt: '2026-05-05T00:00:00.000Z',
      }),
      mode: 'native_split_terminal',
      updatedAt: '2026-05-05T00:00:21.000Z',
      lastArtifactPath: 'artifacts\\develop-last-message.md',
    }));

    const state = await readNativeSessionState(sessionPath);
    expect(state.status).toBe('completed');
    expect(state.result?.kind).toBe('complete');
    expect(state.lastArtifactPath).toBe('artifacts\\develop-last-message.md');
  });
});
