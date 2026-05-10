import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { buildCodexPrompt } from '../src/codex-prompt.js';
import { createInitialState, createRunWorkspace } from '../src/workspace.js';
import { loadWorkflowFile } from '../src/workflow.js';
import type { CodexNodeDefinition } from '../src/types.js';

describe('split prompt paths', () => {
  it('prioritizes re-entry context and generic runtime evidence over the original task text', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-split-prompt-paths-'));
    const workflowDir = path.join(tempRoot, 'workspace');
    const workspaceRoot = path.join(workflowDir, '.flowbraid-runs');
    await mkdir(workflowDir, { recursive: true });
    await mkdir(path.join(workflowDir, 'context'), { recursive: true });
    await mkdir(path.join(workflowDir, 'shared-workdir'), { recursive: true });

    const workflowFile = path.join(workflowDir, 'workflow.yaml');
    const workflowText = `
id: split-paths-demo
workdir: ./
contextDir: ./context
start: develop
nodes:
  develop:
    type: codex
    prompt: |
      You are the development node.
      develop calc
    outputFile: develop-last-message.json
    next: verify
  verify:
    type: codex
    prompt: |
      You are the verification node.
      verify calc
    outputFile: verify-report.md
    transitions:
      success: done
      failure: develop
  done:
    type: end
    message: done
`;
    await writeFile(workflowFile, workflowText, 'utf8');

    const workflow = await loadWorkflowFile(workflowFile);
    const runWorkspace = await createRunWorkspace(workspaceRoot, workflow);
    await createInitialState(runWorkspace, workflow);

    await mkdir(path.join(runWorkspace.nodesDir, 'develop', 'state'), { recursive: true });
    await writeFile(
      path.join(runWorkspace.nodesDir, 'develop', 'state', 'runtime-state.json'),
      JSON.stringify(
        {
          nodeId: 'develop',
          attemptId: 'attempt-develop-0',
          status: 'completed',
          outcome: 'success',
          summary: 'develop initial calc',
        },
        null,
        2,
      ),
      'utf8',
    );
    await writeFile(
      path.join(runWorkspace.messagesDir, 'human-feedback.jsonl'),
      `${JSON.stringify({
        decision: 'reject',
        comment: 'comments missing',
        at: '2026-05-05T00:00:00.000Z',
        nodeId: 'verify',
      })}\n`,
      'utf8',
    );

    const prompt = buildCodexPrompt(
      workflow,
      'develop',
      'attempt-develop-1',
      workflow.nodes.develop as CodexNodeDefinition,
      path.join(runWorkspace.nodesDir, 'develop'),
      path.join(runWorkspace.nodesDir, 'develop', 'artifacts'),
      runWorkspace,
      {
        contextDir: path.join(workflowDir, 'context'),
        workdir: path.join(workflowDir, 'shared-workdir'),
      },
      {
        protocolMode: 'native-split',
        reentryContext: {
          fromNodeId: 'verify',
          fromNodeType: 'codex',
          reason: 'verification rejected because comments are missing',
          requiredAction: 'add a clear comment to calc.js and report the result with the FlowBraid command',
        },
      },
    );

    expect(prompt).toContain('## Re-entry Priority');
    expect(prompt).toContain('## Re-entry Evidence');
    expect(prompt).toContain('comments missing');
    expect(prompt).toContain('runtime-state.path:');
    expect(prompt).toContain('human.feedback.path:');
    expect(prompt).not.toContain('verify.report.path');
    expect(prompt).toContain('## FlowBraid Protocol Addendum');
  });
});
