import path from 'node:path';
import os from 'node:os';
import { chmod, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { loadWorkflowFile } from '../src/workflow.js';
import { sendWorkflow, startWorkflow } from '../src/engine.js';
import { getAgentSessionPaths, readAgentSessionMessages, readAgentSessionState } from '../src/agent-session.js';
import { readJson } from '../src/utils.js';

async function createFakeSessionCodex(binDir: string): Promise<string> {
  const fakeScript = [
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    '',
    'function readStdin() {',
    '  try {',
    "    return fs.readFileSync(0, 'utf8');",
    '  } catch {',
    "    return '';",
    '  }',
    '}',
    '',
    'function parseArgs(argv) {',
    "  const result = { outputPath: '', schemaPath: '', workdir: process.cwd() };",
    '  for (let i = 0; i < argv.length; i += 1) {',
    '    const arg = argv[i];',
    "    if (arg === '--output-last-message') {",
    '      result.outputPath = argv[i + 1] || "";',
    '      i += 1;',
    '      continue;',
    '    }',
    "    if (arg === '--output-schema') {",
    '      result.schemaPath = argv[i + 1] || "";',
    '      i += 1;',
    '      continue;',
    '    }',
    "    if (arg === '--cd') {",
    '      result.workdir = argv[i + 1] || process.cwd();',
      '      i += 1;',
      '      continue;',
    '    }',
    '  }',
    '  return result;',
    '}',
    '',
    'const args = process.argv.slice(2);',
    'const subcommand = args[0];',
    'if (subcommand !== "exec") {',
    '  console.error("unsupported subcommand");',
    '  process.exit(1);',
    '}',
    '',
    'const parsed = parseArgs(args);',
    'const prompt = readStdin();',
    "const askedForFinalAnswer = prompt.includes('final answer: 42');",
    "const result = askedForFinalAnswer",
    '  ? {',
    "      status: 'completed',",
    "      message: '已收到最终答案 42，任务完成。',",
    "      summary: 'session complete',",
    "      files: ['artifacts/session-turn-result.json'],",
    '    }',
    '  : {',
    "      status: 'waiting_input',",
    "      message: '请继续补充最终答案，格式为 final answer: 42。',",
    '    };',
    'if (parsed.outputPath) {',
    "  fs.mkdirSync(path.dirname(parsed.outputPath), { recursive: true });",
    "  fs.writeFileSync(parsed.outputPath, JSON.stringify(result, null, 2), 'utf8');",
    '}',
    "console.log('fake session codex turn complete');",
    'process.exit(0);',
  ].join('\n');

  const scriptPath = path.join(binDir, 'fake-session-codex.js');
  const cmdPath = path.join(binDir, 'codex.cmd');
  const shPath = path.join(binDir, 'codex');
  await writeFile(scriptPath, fakeScript, 'utf8');
  await writeFile(cmdPath, '@echo off\r\nnode "%~dp0fake-session-codex.js" %*\r\n', 'utf8');
  await writeFile(shPath, '#!/usr/bin/env sh\nnode "$(dirname "$0")/fake-session-codex.js" "$@"\n', 'utf8');
  await chmod(shPath, 0o755);
  return process.platform === 'win32' ? cmdPath : shPath;
}

describe('agent_session 长期交互节点', () => {
  it('支持等待输入、send 继续对话并完成后流转到下一个节点', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-agent-session-'));
    const workflowDir = path.join(tempRoot, 'workspace');
    const binDir = path.join(tempRoot, 'bin');
    const workspaceRoot = path.join(workflowDir, '.flowbraid-runs');
    await mkdir(workflowDir, { recursive: true });
    await mkdir(binDir, { recursive: true });
    const codexCommand = await createFakeSessionCodex(binDir);

    const workflowFile = path.join(workflowDir, 'workflow.yaml');
    const workflow = `
id: agent-session-demo
start: discuss
nodes:
  discuss:
    type: agent_session
    provider: codex
    prompt: |
      先向用户索要最终答案。
      只有当用户明确回复形如 final answer: <值> 的最终答案时，才能结束当前节点。
    outputFile: turn-result.json
    next: done
  done:
    type: end
    message: completed
`;
    await writeFile(workflowFile, workflow, 'utf8');

    const loaded = await loadWorkflowFile(workflowFile);
    const firstResult = await startWorkflow(loaded, {
      workspaceRoot,
      codexCommand,
    });

    expect(firstResult.status).toBe('paused');
    expect(firstResult.currentNodeId).toBe('discuss');
    expect(firstResult.pendingNodeId).toBeNull();

    const nodeDir = path.join(firstResult.runDir, 'nodes', 'discuss');
    const { inboxPath, outboxPath, sessionStatePath } = getAgentSessionPaths(nodeDir);
    const sessionState = await readAgentSessionState(sessionStatePath);
    expect(sessionState.status).toBe('waiting_input');
    expect(sessionState.turnCount).toBe(1);
    expect(sessionState.lastAssistantMessage).toContain('final answer: 42');

    const firstMessages = await readAgentSessionMessages(inboxPath, outboxPath);
    expect(firstMessages.some((message) => message.kind === 'message' && message.role === 'system')).toBe(true);
    expect(firstMessages.some((message) => message.kind === 'message' && message.role === 'user')).toBe(true);
    expect(firstMessages.some((message) => message.kind === 'event' && message.type === 'session.waiting_input')).toBe(true);

    const pausedState = await readJson<{ status: string; currentNodeId: string | null; pendingNodeId: string | null }>(
      path.join(firstResult.runDir, 'state', 'run.json'),
    );
    expect(pausedState.status).toBe('paused');
    expect(pausedState.currentNodeId).toBe('discuss');
    expect(pausedState.pendingNodeId).toBeNull();

    const secondResult = await sendWorkflow(firstResult.runDir, 'final answer: 42', {
      codexCommand,
    });

    expect(secondResult.status).toBe('completed');
    expect(secondResult.currentNodeId).toBeNull();

    const finalSessionState = await readAgentSessionState(sessionStatePath);
    expect(finalSessionState.status).toBe('completed');
    expect(finalSessionState.turnCount).toBe(2);
    expect(finalSessionState.lastUserMessage).toBe('final answer: 42');
    expect(finalSessionState.lastAssistantMessage).toContain('任务完成');

    const finalMessages = await readAgentSessionMessages(inboxPath, outboxPath);
    expect(finalMessages.some((message) => message.kind === 'event' && message.type === 'session.completed')).toBe(true);
    expect(finalMessages.some((message) => message.kind === 'message' && message.role === 'assistant' && message.turn === 2)).toBe(true);
    expect(
      finalMessages
        .filter((message) => message.kind === 'message')
        .map((message) => `${message.turn ?? 0}:${message.role}`),
    ).toEqual(['0:system', '0:user', '1:assistant', '2:user', '2:assistant']);

    const outputFile = await readFile(path.join(nodeDir, 'artifacts', 'turn-result.json'), 'utf8');
    expect(outputFile).toContain('"status": "completed"');
    expect(outputFile).toContain('"summary": "session complete"');

    const finalState = await readJson<{ status: string; currentNodeId: string | null }>(
      path.join(firstResult.runDir, 'state', 'run.json'),
    );
    expect(finalState.status).toBe('completed');
    expect(finalState.currentNodeId).toBeNull();
  }, 20000);
});
