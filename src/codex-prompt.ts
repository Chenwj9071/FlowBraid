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
  reentryContext?: CodexPromptReentryContext;
}

export interface CodexPromptReentryContext {
  fromNodeId: string;
  fromNodeType?: string;
  reason: string;
  requiredAction: string;
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
  const protocolMode = options.protocolMode ?? 'standard';
  const reentryMode = options.reentryMode ?? (options.resumeSession ? 'resume' : 'new');
  const includeReentryHistory = options.includeReentryHistory !== false;
  const includeExternalContext = reentryMode === 'new' || includeReentryHistory;
  const flowbraidNodePrefix = buildFlowBraidNodeCommandPrefix();
  const completeSuccessCommand = `${flowbraidNodePrefix} node complete --run-dir "${workspace.runDir}" --node-id "${nodeId}" --attempt-id "${attemptId}" --outcome "success" --summary "done"`;
  const completeApproveCommand = `${flowbraidNodePrefix} node complete --run-dir "${workspace.runDir}" --node-id "${nodeId}" --attempt-id "${attemptId}" --outcome "approve" --summary "approved"`;
  const completeRejectCommand = `${flowbraidNodePrefix} node complete --run-dir "${workspace.runDir}" --node-id "${nodeId}" --attempt-id "${attemptId}" --outcome "reject" --summary "rejected"`;
  const failCommand = `${flowbraidNodePrefix} node fail --run-dir "${workspace.runDir}" --node-id "${nodeId}" --attempt-id "${attemptId}" --message "explain the failure"`;

  const commandPolicy = [
    'FlowBraid node protocol:',
    '- You are executing one node in a FlowBraid workflow.',
    '- Treat the node prompt below as the task source of truth.',
    '- Use context.dir for node-local instructions and workdir for the shared business files.',
    '- Do not invent hidden workflow state or implicit file contracts.',
    '- When the current node task is fully finished and the final outcome is known, run exactly one complete command with the matching outcome.',
    '- If the node cannot continue or fails irrecoverably, run the fail command immediately.',
    '- Exit the session immediately only after reporting a final complete or fail state.',
    '',
    'Command triggers:',
    `- complete success: when the node task finished successfully -> ${completeSuccessCommand}`,
    `- complete approve: when the node task finished with approval -> ${completeApproveCommand}`,
    `- complete reject: when the node task finished with rejection -> ${completeRejectCommand}`,
    `- fail: when the node cannot continue -> ${failCommand}`,
  ];

  const sections: Array<string | null> = [
    'You are a FlowBraid workflow node.',
    `workflow.id: ${workflow.id}`,
    `node.id: ${nodeId}`,
    `run.dir: ${workspace.runDir}`,
    `context.dir: ${dirs.contextDir}`,
    `workdir: ${dirs.workdir}`,
    `node.dir: ${nodeDir}`,
    `artifacts.dir: ${nodeArtifactsDir}`,
    `context.instructions.path: ${contextInstructionsPath}`,
    `reentry.mode: ${reentryMode}`,
    options.reentryContext
      ? [
          '',
          'Re-entry context:',
          `- from: ${options.reentryContext.fromNodeId}${options.reentryContext.fromNodeType ? ` (${options.reentryContext.fromNodeType})` : ''}`,
          `- reason: ${options.reentryContext.reason}`,
          `- required action: ${options.reentryContext.requiredAction}`,
          '- Treat the re-entry context above as the primary input for this round.',
          '- After handling the re-entry issue, report the node result with the required FlowBraid command and exit immediately.',
        ].join('\n')
      : null,
    includeExternalContext
      ? [
          '',
          'External context snapshots:',
          `verify.report.path: ${verifyReportPath}`,
          `human.feedback.path: ${humanFeedbackPath}`,
          'latest.verify.report:',
          latestVerifyReport,
          'latest.human.feedback:',
          latestHumanFeedback,
        ].join('\n')
      : null,
    '',
    'Task:',
    node.prompt,
    '',
    ...commandPolicy,
    protocolMode === 'native-split'
      ? [
          '',
          'Native split terminal protocol:',
          '- You are running in a native codex terminal managed by FlowBraid.',
          '- Do not silently exit the terminal without reporting status.',
          '- The command triggers above are mandatory, not advisory.',
          '- After reporting a final state, exit the current codex session immediately so FlowBraid can close the terminal cleanly.',
          '- The main FlowBraid process continues only after those commands update node state.',
        ].join('\n')
      : null,
  ];

  return sections.filter((value): value is string => value !== null).join('\n');
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
