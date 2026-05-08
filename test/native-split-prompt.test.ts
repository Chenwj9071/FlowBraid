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
    mode: exec
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

    await mkdir(path.join(runWorkspace.nodesDir, 'verify', 'artifacts'), { recursive: true });
    await writeFile(
      path.join(runWorkspace.nodesDir, 'verify', 'artifacts', 'verify-report.md'),
      'outcome hint: reject\ncomments are missing\n',
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

    expect(prompt).toContain('FlowBraid node protocol:');
    expect(prompt).toContain('Command triggers:');
    expect(prompt).toContain('Native split terminal protocol:');
    expect(prompt).toContain('node complete --run-dir');
    expect(prompt).toContain('--attempt-id "attempt-develop-1"');
    expect(prompt).toContain('node fail --run-dir');
    expect(prompt).toContain('latest.verify.report:');
    expect(prompt).toContain('outcome hint: reject');
    expect(prompt).toContain('latest.human.feedback:');
    expect(prompt).toContain('please add a short usage note');
    expect(prompt).toContain('Exit the session immediately only after reporting a final complete or fail state.');
    expect(prompt).toContain('exit the current codex session immediately');
    expect(prompt).not.toContain('After any terminal command, stop working and exit the session immediately.');
    expect(prompt).not.toContain('node artifact --run-dir');
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
    mode: exec
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
    await mkdir(path.join(runWorkspace.nodesDir, 'verify', 'artifacts'), { recursive: true });
    await writeFile(
      path.join(runWorkspace.nodesDir, 'verify', 'artifacts', 'verify-report.md'),
      'outcome hint: reject\ncomments are missing\n',
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

    expect(prompt).toContain('FlowBraid node protocol:');
    expect(prompt).toContain('Re-entry context:');
    expect(prompt).toContain('from:');
    expect(prompt).toContain('reason:');
    expect(prompt).toContain('required action:');
    expect(prompt).toContain('please add a brief usage note');
    expect(prompt).toContain(`Task:\n${originalTask}`);
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
    mode: exec
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

    expect(prompt).toContain('FlowBraid node protocol:');
    expect(prompt).not.toContain('Re-entry context:');
    expect(prompt).not.toContain('latest.verify.report:');
    expect(prompt).not.toContain('latest.human.feedback:');
  });
});
