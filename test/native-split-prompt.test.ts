import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { buildCodexPrompt } from '../src/codex-prompt.js';
import { createInitialState, createRunWorkspace } from '../src/workspace.js';
import { loadWorkflowFile } from '../src/workflow.js';
import type { CodexNodeDefinition } from '../src/types.js';

describe('native split prompt', () => {
  it('includes native split protocol commands and inline feedback context', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-native-split-prompt-'));
    const workflowDir = path.join(tempRoot, 'workspace');
    const workspaceRoot = path.join(workflowDir, '.flowbraid-runs');
    await mkdir(workflowDir, { recursive: true });
    await mkdir(path.join(workflowDir, 'context'), { recursive: true });
    await mkdir(path.join(workflowDir, 'shared-workdir'), { recursive: true });

    const workflowFile = path.join(workflowDir, 'workflow.yaml');
    const workflowText = `
id: native-split-prompt-demo
workdir: ./shared-workdir
contextDir: ./context
start: develop
nodes:
  develop:
    type: codex
    prompt: implement calc
    outputFile: develop-last-message.md
    next: done
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
          outcome: 'reject',
          summary: 'previous attempt rejected',
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
        comment: 'please add a short usage note',
        at: '2026-05-05T00:00:00.000Z',
        nodeId: 'approve',
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
      },
    );

    expect(prompt).toContain('## FlowBraid Protocol');
    expect(prompt).toContain('## Re-entry Evidence');
    expect(prompt).toContain('## Required Commands');
    expect(prompt).toContain('## FlowBraid Protocol Addendum');
    expect(prompt).not.toContain('Do not assume an exec/review split;');
    expect(prompt).toContain('runtime-state.path:');
    expect(prompt).toContain('latest.runtime-state:');
    expect(prompt).toContain('outcome: reject');
    expect(prompt).toContain('Treat the human feedback comment below as high-priority re-entry guidance.');
    expect(prompt).toContain('HIGH PRIORITY comment: please add a short usage note');
    expect(prompt).toContain('please add a short usage note');
    expect(prompt).toContain('node complete --run-dir');
    expect(prompt).toContain('--attempt-id "attempt-develop-1"');
    expect(prompt).toContain('node fail --run-dir');
    expect(prompt).toContain('latest.human.feedback:');
    expect(prompt).toContain('Keep the fail `--message` concise and specific.');
    expect(prompt).toContain('exit the current Codex session immediately');
    expect(prompt).not.toContain('After any terminal command, stop working and exit the session immediately.');
    expect(prompt).not.toContain('verify.report.path');
  });

  it('uses a dedicated re-entry prompt for resumed native split sessions', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-native-split-prompt-'));
    const workflowDir = path.join(tempRoot, 'workspace');
    const workspaceRoot = path.join(workflowDir, '.flowbraid-runs');
    await mkdir(workflowDir, { recursive: true });
    await mkdir(path.join(workflowDir, 'context'), { recursive: true });
    await mkdir(path.join(workflowDir, 'shared-workdir'), { recursive: true });

    const workflowFile = path.join(workflowDir, 'workflow.yaml');
    const originalTask = 'implement calc and print the numeric sum';
    const workflowText = `
id: native-split-resume-prompt-demo
workdir: ./shared-workdir
contextDir: ./context
start: develop
nodes:
  develop:
    type: codex
    prompt: ${originalTask}
    outputFile: develop-last-message.md
    next: done
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
          outcome: 'reject',
          summary: 'previous attempt rejected',
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
        comment: 'please add a brief usage note',
        at: '2026-05-05T00:00:00.000Z',
        nodeId: 'approve',
      })}\n`,
      'utf8',
    );

    const prompt = buildCodexPrompt(
      workflow,
      'develop',
      'attempt-develop-2',
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
        resumeSession: true,
        reentryContext: {
          fromNodeId: 'approve',
          fromNodeType: 'approval',
          reason: 'approval returned decision=reject',
          requiredAction: 'apply the recorded feedback and report the node result with the required FlowBraid command',
        },
      },
    );

    expect(prompt).toContain('## FlowBraid Protocol');
    expect(prompt).toContain('## Re-entry Priority');
    expect(prompt).toContain('## Re-entry Evidence');
    expect(prompt).not.toContain('Do not assume an exec/review split;');
    expect(prompt).toContain('from:');
    expect(prompt).toContain('reason:');
    expect(prompt).toContain('required action:');
    expect(prompt).toContain('Treat the human feedback comment below as high-priority re-entry guidance.');
    expect(prompt).toContain('HIGH PRIORITY comment: please add a brief usage note');
    expect(prompt).toContain('Original task reference:');
    expect(prompt).toContain('please add a brief usage note');
    expect(prompt).toContain(originalTask);
  });

  it('supports minimal re-entry prompt without historical context', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-native-split-prompt-'));
    const workflowDir = path.join(tempRoot, 'workspace');
    const workspaceRoot = path.join(workflowDir, '.flowbraid-runs');
    await mkdir(workflowDir, { recursive: true });
    await mkdir(path.join(workflowDir, 'context'), { recursive: true });
    await mkdir(path.join(workflowDir, 'shared-workdir'), { recursive: true });

    const workflowFile = path.join(workflowDir, 'workflow.yaml');
    await writeFile(
      workflowFile,
      `
id: native-split-reentry-minimal-demo
workdir: ./shared-workdir
contextDir: ./context
start: develop
nodes:
  develop:
    type: codex
    prompt: implement calc
    next: done
  done:
    type: end
    message: done
`,
      'utf8',
    );

    const workflow = await loadWorkflowFile(workflowFile);
    const runWorkspace = await createRunWorkspace(workspaceRoot, workflow);
    await createInitialState(runWorkspace, workflow);

    const prompt = buildCodexPrompt(
      workflow,
      'develop',
      'attempt-develop-3',
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
        resumeSession: true,
        includeReentryHistory: false,
      },
    );

    expect(prompt).toContain('## FlowBraid Protocol');
    expect(prompt).not.toContain('## Re-entry Priority');
    expect(prompt).not.toContain('## Re-entry Evidence');
    expect(prompt).not.toContain('latest.human.feedback:');
  });
});

