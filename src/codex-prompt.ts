import path from 'node:path';
import { readFileSync } from 'node:fs';
import type {
  CodexNodeDefinition,
  CodexReentryMode,
  RunWorkspace,
  WorkflowDefinition,
  WorkflowSourceMeta,
} from './types.js';
import { buildFlowBraidNodeCommandPrefix } from './executors/codex.js';

export interface CodexPromptDirectories {
  contextDir: string;
  workdir: string;
}

export interface CodexPromptOptions {
  protocolMode?: 'standard' | 'native-split';
  resumeSession?: boolean;
  includeReentryHistory?: boolean;
  reentryMode?: CodexReentryMode;
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
  const roleText = inferCodexRole(nodeId, node.prompt);
  const modeText =
    roleText === 'verification'
      ? 'You are a verification agent node. Start from context.dir for your role instructions, but actually run and inspect the deliverable inside workdir. Report the final workflow outcome through FlowBraid node commands.'
      : 'You are a development agent node. Start from context.dir for your role instructions, but modify the shared business files inside workdir and deliver a runnable result. Report the final workflow outcome through FlowBraid node commands.';
  const protocolMode = options.protocolMode ?? 'standard';
  const reentryMode = options.reentryMode ?? (options.resumeSession ? 'resume' : 'new');
  const includeReentryHistory = options.includeReentryHistory !== false;
  const flowbraidNodePrefix = buildFlowBraidNodeCommandPrefix();
  const completeSuccessCommand = `${flowbraidNodePrefix} node complete --run-dir "${workspace.runDir}" --node-id "${nodeId}" --attempt-id "${attemptId}" --outcome "success" --summary "done"`;
  const completeApproveCommand = `${flowbraidNodePrefix} node complete --run-dir "${workspace.runDir}" --node-id "${nodeId}" --attempt-id "${attemptId}" --outcome "approve" --summary "approved"`;
  const completeRejectCommand = `${flowbraidNodePrefix} node complete --run-dir "${workspace.runDir}" --node-id "${nodeId}" --attempt-id "${attemptId}" --outcome "reject" --summary "rejected"`;
  const failCommand = `${flowbraidNodePrefix} node fail --run-dir "${workspace.runDir}" --node-id "${nodeId}" --attempt-id "${attemptId}" --message "explain the failure"`;
  const artifactCommand = `${flowbraidNodePrefix} node artifact --run-dir "${workspace.runDir}" --node-id "${nodeId}" --attempt-id "${attemptId}" --file "${path.join(
    'artifacts',
    node.outputFile ?? 'codex-last-message.md',
  )}"`;

  if (reentryMode !== 'new') {
    return [
      reentryMode === 'resume'
        ? roleText === 'verification'
          ? 'Continue the existing verification session. Do not restart the whole task. Use the existing session history and only process the latest re-entry context below.'
          : 'Continue the existing development session. Do not restart the whole task. Use the existing session history and only process the latest re-entry context below.'
        : roleText === 'verification'
          ? 'Start a new verification session with the existing history. Do not restart the task from scratch. Use the latest re-entry context below as the current working state.'
          : 'Start a new development session with the existing history. Do not restart the task from scratch. Use the latest re-entry context below as the current working state.',
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
      '- Focus only on the latest re-entry reason and the latest workflow context below.',
      '',
      `legacy.node.mode: ${node.mode ?? roleText}`,
      '',
      includeReentryHistory
        ? ['latest.verify.report:', latestVerifyReport, 'latest.human.feedback:', latestHumanFeedback].join('\n')
        : 'Re-entry context is intentionally minimal for this round.',
      '',
      roleText === 'verification'
        ? 'Re-entry task: rerun verification against the latest deliverable, then report the final outcome for this attempt using FlowBraid node commands.'
        : 'Re-entry task: apply the latest verification or human feedback to the existing deliverable and finish this round with the smallest required change.',
      '',
      protocolMode === 'native-split'
        ? [
            'Native split terminal protocol:',
            '- You are running in a native codex terminal managed by FlowBraid.',
            '- Do not silently exit the terminal without reporting status.',
            `- When you produce the key node artifact, run: ${artifactCommand}`,
            `- When the node task is completed, report a final outcome using one of these commands:`,
            `  - ${completeSuccessCommand}`,
            `  - ${completeApproveCommand}`,
            `  - ${completeRejectCommand}`,
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
    `legacy.node.mode: ${node.mode ?? roleText}`,
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
    roleText === 'verification'
      ? '1. You must execute the verification commands and checks from the task. Do not verify by reading code only.'
      : '1. Only modify business files in the current workdir. Do not create extra test scripts, design docs, or unrelated files unless explicitly required.',
    roleText === 'verification'
      ? '2. Your conclusion must cover every acceptance criterion in the task, including comments, output format, and human feedback handling requirements.'
      : '2. Respect the current module system and runtime environment. The delivered script must run directly in this repository configuration.',
    roleText === 'verification'
      ? '3. When verification is complete, report the final outcome with FlowBraid node commands. Use approve or reject when the task asks for an acceptance decision.'
      : '3. Your final output must state which files you changed and how you verified the result.',
    protocolMode === 'native-split'
      ? [
          '',
          'Native split terminal protocol:',
          '- You are running in a native codex terminal managed by FlowBraid.',
          '- Do not silently exit the terminal without reporting status.',
          `- When you produce the key node artifact, run: ${artifactCommand}`,
          `- When the node task is completed, report a final outcome using one of these commands:`,
          `  - ${completeSuccessCommand}`,
          `  - ${completeApproveCommand}`,
          `  - ${completeRejectCommand}`,
          `- If the node cannot continue, run: ${failCommand}`,
          '- After reporting a final state, exit the current codex session immediately so FlowBraid can close the terminal cleanly.',
          '- The main FlowBraid process will continue the workflow only after those commands update node state.',
        ].join('\n')
      : null,
  ].join('\n');
}

function inferCodexRole(nodeId: string, prompt: string): 'development' | 'verification' {
  const lowerNodeId = nodeId.toLowerCase();
  const lowerPrompt = prompt.toLowerCase();
  if (lowerNodeId.includes('develop') || lowerNodeId.includes('build') || lowerNodeId.includes('implement')) {
    return 'development';
  }
  if (
    lowerNodeId.includes('verify') ||
    lowerNodeId.includes('review') ||
    lowerPrompt.includes('verification') ||
    lowerPrompt.includes('verify ') ||
    lowerPrompt.includes('code review') ||
    lowerPrompt.includes('acceptance')
  ) {
    return 'verification';
  }
  return 'development';
}

export function buildNewSessionReentryPrompt(
  workflow: RuntimeWorkflow,
  nodeId: string,
  attemptId: string,
  node: CodexNodeDefinition,
  workspace: RunWorkspace,
  dirs: CodexPromptDirectories,
  options: Pick<CodexPromptOptions, 'protocolMode'> & { includeHistory?: boolean } = {},
): string {
  return buildCodexPrompt(
    workflow,
    nodeId,
    attemptId,
    node,
    '',
    '',
    workspace,
    dirs,
    {
      protocolMode: options.protocolMode,
      reentryMode: options.includeHistory === false ? 'new' : 'new_with_history',
      includeReentryHistory: options.includeHistory !== false,
    },
  );
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
