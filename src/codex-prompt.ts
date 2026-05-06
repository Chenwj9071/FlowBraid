import path from 'node:path';
import { readFileSync } from 'node:fs';
import type { CodexNodeDefinition, RunWorkspace, WorkflowDefinition, WorkflowSourceMeta } from './types.js';
import { buildFlowBraidNodeCommandPrefix } from './executors/codex.js';

export interface CodexPromptDirectories {
  contextDir: string;
  workdir: string;
}

export interface CodexPromptOptions {
  protocolMode?: 'standard' | 'native-split';
  resumeSession?: boolean;
}

type RuntimeWorkflow = WorkflowDefinition & Partial<WorkflowSourceMeta>;

export function buildCodexPrompt(
  workflow: RuntimeWorkflow,
  nodeId: string,
  attemptId: string,
  node: CodexNodeDefinition,
  nodeDir: string,
  nodeArtifactsDir: string,
  workspace: RunWorkspace,
  dirs: CodexPromptDirectories,
  options: CodexPromptOptions = {},
): string {
  const verifyReportPath = path.join(workspace.nodesDir, 'verify', 'artifacts', 'verify-report.md');
  const humanFeedbackPath = path.join(workspace.messagesDir, 'human-feedback.jsonl');
  const contextInstructionsPath = path.join(dirs.contextDir, 'AGENTS.md');
  const latestVerifyReport = tryReadPromptContextSync(verifyReportPath) ?? 'NONE';
  const latestHumanFeedback = tryReadLastHumanFeedbackSync(humanFeedbackPath) ?? 'NONE';
  const modeText =
    node.mode === 'review'
      ? 'You are the verification node. Start from context.dir for your role instructions, but actually run and inspect the deliverable inside workdir. Return verdict: approve or verdict: reject exactly as required.'
      : 'You are the development node. Start from context.dir for your role instructions, but modify the shared business files inside workdir and deliver a runnable result.';
  const protocolMode = options.protocolMode ?? 'standard';
  const resumeSession = options.resumeSession === true;
  const flowbraidNodePrefix = buildFlowBraidNodeCommandPrefix();
  const completeCommand = `${flowbraidNodePrefix} node complete --run-dir "${workspace.runDir}" --node-id "${nodeId}" --attempt-id "${attemptId}" --summary "done"`;
  const failCommand = `${flowbraidNodePrefix} node fail --run-dir "${workspace.runDir}" --node-id "${nodeId}" --attempt-id "${attemptId}" --message "explain the failure"`;
  const artifactCommand = `${flowbraidNodePrefix} node artifact --run-dir "${workspace.runDir}" --node-id "${nodeId}" --attempt-id "${attemptId}" --file "${path.join(
    'artifacts',
    node.outputFile ?? 'codex-last-message.md',
  )}"`;

  if (resumeSession) {
    return [
      node.mode === 'review'
        ? 'Continue the existing verification session. Do not restart the whole task. Use the existing session history and only process the latest re-entry context below.'
        : 'Continue the existing development session. Do not restart the whole task. Use the existing session history and only process the latest re-entry context below.',
      '',
      `workflow.id: ${workflow.id}`,
      `node.id: ${nodeId}`,
      `run.dir: ${workspace.runDir}`,
      `context.dir: ${dirs.contextDir}`,
      `workdir: ${dirs.workdir}`,
      '',
      'Re-entry context:',
      '- This node was resumed because the workflow looped back to it.',
      '- Keep the existing session context and continue from the current state.',
      '- Do not ask for the original task again and do not restart from scratch.',
      '- Focus only on the latest verification report and latest human feedback below.',
      '',
      'latest.verify.report:',
      latestVerifyReport,
      'latest.human.feedback:',
      latestHumanFeedback,
      '',
      node.mode === 'review'
        ? 'Re-entry task: rerun verification against the latest deliverable, produce an updated verdict, and report only the incremental outcome required for this round.'
        : 'Re-entry task: apply the latest verification or human feedback to the existing deliverable and finish this round with the smallest required change.',
      '',
      protocolMode === 'native-split'
        ? [
            'Native split terminal protocol:',
            '- You are running in a native codex terminal managed by FlowBraid.',
            '- Do not silently exit the terminal without reporting status.',
            `- When you produce the key node artifact, run: ${artifactCommand}`,
            `- When the node task is completed, run: ${completeCommand}`,
            `- If the node cannot continue, run: ${failCommand}`,
            '- After reporting a final state, exit the current codex session immediately so FlowBraid can close the terminal cleanly.',
            '- The main FlowBraid process will continue the workflow only after those commands update node state.',
          ].join('\n')
        : null,
    ]
      .filter((value): value is string => value !== null)
      .join('\n');
  }

  return [
    modeText,
    '',
    `workflow.id: ${workflow.id}`,
    `node.id: ${nodeId}`,
    `run.dir: ${workspace.runDir}`,
    `node.dir: ${nodeDir}`,
    `artifacts.dir: ${nodeArtifactsDir}`,
    `context.dir: ${dirs.contextDir}`,
    `context.instructions.path: ${contextInstructionsPath}`,
    `workdir: ${dirs.workdir}`,
    `verify.report.path: ${verifyReportPath}`,
    `human.feedback.path: ${humanFeedbackPath}`,
    'latest.verify.report:',
    latestVerifyReport,
    'latest.human.feedback:',
    latestHumanFeedback,
    '',
    'Directory model:',
    '- The terminal starts in context.dir.',
    '- Use context.dir for node identity, local instructions, and role-specific guidance.',
    '- Use workdir for the real shared business files and command execution target.',
    '- Different nodes may use different context.dir values while sharing the same workdir.',
    '- When you need previous review or human feedback, read the explicit absolute paths above instead of inventing placeholders.',
    '- latest.verify.report and latest.human.feedback are authoritative inline context snapshots from FlowBraid. Use them directly even if you choose not to read the files again.',
    '',
    'Task:',
    node.prompt,
    '',
    'Shared requirements:',
    node.mode === 'review'
      ? '1. You must execute the verification commands and checks from the task. Do not review by reading code only.'
      : '1. Only modify business files in the current workdir. Do not create extra test scripts, design docs, or unrelated files unless explicitly required.',
    node.mode === 'review'
      ? '2. Your conclusion must cover every acceptance criterion in the task, including comments, output format, and human feedback handling requirements.'
      : '2. Respect the current module system and runtime environment. The delivered script must run directly in this repository configuration.',
    node.mode === 'review'
      ? '3. Your final output must contain a standalone line with verdict: approve or verdict: reject, plus the reason.'
      : '3. Your final output must state which files you changed and how you verified the result.',
    protocolMode === 'native-split'
      ? [
          '',
          'Native split terminal protocol:',
          '- You are running in a native codex terminal managed by FlowBraid.',
          '- Do not silently exit the terminal without reporting status.',
          `- When you produce the key node artifact, run: ${artifactCommand}`,
          `- When the node task is completed, run: ${completeCommand}`,
          `- If the node cannot continue, run: ${failCommand}`,
          '- After reporting a final state, exit the current codex session immediately so FlowBraid can close the terminal cleanly.',
          '- The main FlowBraid process will continue the workflow only after those commands update node state.',
        ].join('\n')
      : null,
  ].join('\n');
}

function tryReadPromptContextSync(filePath: string, maxChars = 4000): string | null {
  try {
    const content = readFileSync(filePath, 'utf8').trim();
    if (!content) {
      return null;
    }
    return content.length > maxChars ? `${content.slice(0, maxChars)}\n[truncated]` : content;
  } catch {
    return null;
  }
}

function tryReadLastHumanFeedbackSync(filePath: string, maxChars = 2000): string | null {
  try {
    const raw = readFileSync(filePath, 'utf8').trim();
    if (!raw) {
      return null;
    }
    const lastLine = raw
      .split(/\r?\n/gu)
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1);
    if (!lastLine) {
      return null;
    }
    const parsed = JSON.parse(lastLine) as { decision?: string; comment?: string; at?: string; nodeId?: string };
    const summary = [
      `decision: ${parsed.decision ?? 'unknown'}`,
      `comment: ${parsed.comment?.trim() || '(empty)'}`,
      parsed.at ? `at: ${parsed.at}` : null,
      parsed.nodeId ? `nodeId: ${parsed.nodeId}` : null,
    ]
      .filter((value): value is string => !!value)
      .join('\n');
    return summary.length > maxChars ? `${summary.slice(0, maxChars)}\n[truncated]` : summary;
  } catch {
    return null;
  }
}
