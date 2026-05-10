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
  const runtimeStatePath = path.join(nodeDir, 'state', 'runtime-state.json');
  const humanFeedbackPath = path.join(workspace.messagesDir, 'human-feedback.jsonl');
  const contextInstructionsPath = path.join(dirs.contextDir, 'AGENTS.md');
  const latestRuntimeState = tryReadPromptRuntimeStateSync(runtimeStatePath) ?? 'NONE';
  const latestHumanFeedback = tryReadLastHumanFeedbackSync(humanFeedbackPath) ?? 'NONE';
  const protocolMode = options.protocolMode ?? 'standard';
  const reentryMode = options.reentryMode ?? (options.resumeSession ? 'resume' : 'new');
  const includeReentryHistory = options.includeReentryHistory !== false;
  const includeEvidence = includeReentryHistory && (options.reentryContext !== undefined || latestRuntimeState !== 'NONE' || latestHumanFeedback !== 'NONE');
  const flowbraidNodePrefix = buildFlowBraidNodeCommandPrefix();
  const completeSuccessCommand = `${flowbraidNodePrefix} node complete --run-dir "${workspace.runDir}" --node-id "${nodeId}" --attempt-id "${attemptId}" --outcome "success"`;
  const completeApproveCommand = `${flowbraidNodePrefix} node complete --run-dir "${workspace.runDir}" --node-id "${nodeId}" --attempt-id "${attemptId}" --outcome "approve"`;
  const completeRejectCommand = `${flowbraidNodePrefix} node complete --run-dir "${workspace.runDir}" --node-id "${nodeId}" --attempt-id "${attemptId}" --outcome "reject"`;
  const failCommand = `${flowbraidNodePrefix} node fail --run-dir "${workspace.runDir}" --node-id "${nodeId}" --attempt-id "${attemptId}" --message "explain the failure"`;

  const sections: Array<string | null> = [
    buildPromptSection(
      'FlowBraid Protocol',
      [
        '- You are one generic FlowBraid node in a workflow.',
        '- Treat `runtime-state + outcome` as the source of truth for node completion.',
        '- Use `contextDir` for node-local instructions and `workdir` for shared business files.',
        '- Do not invent hidden workflow state or implicit file contracts.',
        '- When the node is fully finished and the final outcome is known, run exactly one final command and stop.',
        '- If the node cannot continue or fails irrecoverably, run the fail command immediately.',
      ].join('\n'),
    ),
    options.reentryContext
      ? buildPromptSection(
          'Re-entry Priority',
          [
            '- **Re-entry feedback is primary.** Apply it before revisiting the original task text.',
            `- from: ${options.reentryContext.fromNodeId}${options.reentryContext.fromNodeType ? ` (${options.reentryContext.fromNodeType})` : ''}`,
            `- reason: ${options.reentryContext.reason}`,
            `- required action: ${options.reentryContext.requiredAction}`,
            '- The original task below is reference material, not the highest-priority instruction.',
          ].join('\n'),
        )
      : null,
    includeEvidence
      ? buildPromptSection(
          'Re-entry Evidence',
          [
            `- runtime-state.path: ${runtimeStatePath}`,
            '- latest.runtime-state:',
            indentText(latestRuntimeState),
            `- human.feedback.path: ${humanFeedbackPath}`,
            '- Treat the human feedback comment below as high-priority re-entry guidance.',
            '- latest.human.feedback:',
            indentText(latestHumanFeedback),
          ].join('\n'),
        )
      : null,
    buildPromptSection(
      'Task Reference',
      [
        `workflow.id: ${workflow.id}`,
        `node.id: ${nodeId}`,
        `run.dir: ${workspace.runDir}`,
        `context.dir: ${dirs.contextDir}`,
        `workdir: ${dirs.workdir}`,
        `node.dir: ${nodeDir}`,
        `artifacts.dir: ${nodeArtifactsDir}`,
        `context.instructions.path: ${contextInstructionsPath}`,
        `reentry.mode: ${reentryMode}`,
        '',
        'Original task reference:',
        indentText(node.prompt),
      ].join('\n'),
    ),
    buildPromptSection(
      'Required Commands',
      [
        `- complete success: \`${completeSuccessCommand}\``,
        `- complete approve: \`${completeApproveCommand}\``,
        `- complete reject: \`${completeRejectCommand}\``,
        `- fail: \`${failCommand}\``,
        '- Keep the fail `--message` concise and specific.',
        '- Do not add extra command flags unless the CLI requires them.',
      ].join('\n'),
    ),
    protocolMode === 'native-split'
      ? buildPromptSection(
          'FlowBraid Protocol Addendum',
          [
            '- You are running in a native Codex terminal managed by FlowBraid.',
            '- Do not silently exit the terminal without reporting status.',
            '- The command triggers above are mandatory, not advisory.',
            '- After reporting a final state, exit the current Codex session immediately so FlowBraid can close the terminal cleanly.',
            '- The main FlowBraid process continues only after those commands update node state.',
          ].join('\n'),
        )
      : null,
  ];

  return sections.filter((value): value is string => value !== null).join('\n');
}

export function buildNewSessionReentryPrompt(
  workflow: RuntimeWorkflow,
  nodeId: string,
  attemptId: string,
  node: CodexNodeDefinition,
  nodeDir: string,
  nodeArtifactsDir: string,
  workspace: RunWorkspace,
  dirs: CodexPromptDirectories,
  options: Pick<CodexPromptOptions, 'protocolMode'> & { includeHistory?: boolean; reentryContext?: CodexPromptReentryContext | null } = {},
): string {
  return buildCodexPrompt(
    workflow,
    nodeId,
    attemptId,
    node,
    nodeDir,
    nodeArtifactsDir,
    workspace,
    dirs,
    {
      protocolMode: options.protocolMode,
      reentryMode: options.includeHistory === false ? 'new' : 'new_with_history',
      includeReentryHistory: options.includeHistory !== false,
      reentryContext: options.reentryContext ?? undefined,
    },
  );
}

function buildPromptSection(title: string, body: string): string {
  return `## ${title}\n${body.trimEnd()}`;
}

function indentText(text: string, prefix = '  '): string {
  return text
    .split(/\r?\n/gu)
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

function tryReadPromptRuntimeStateSync(filePath: string, maxChars = 2000): string | null {
  try {
    const raw = readFileSync(filePath, 'utf8').trim();
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as {
      attemptId?: string;
      error?: string;
      outcome?: string;
      reason?: string;
      status?: string;
      summary?: string;
    };
    const summary = [
      `status: ${parsed.status ?? 'unknown'}`,
      parsed.outcome ? `outcome: ${parsed.outcome}` : null,
      parsed.summary ? `summary: ${parsed.summary}` : null,
      parsed.attemptId ? `attemptId: ${parsed.attemptId}` : null,
      parsed.reason ? `reason: ${parsed.reason}` : null,
      parsed.error ? `error: ${parsed.error}` : null,
    ]
      .filter((value): value is string => !!value)
      .join('\n');
    return summary.length > maxChars ? `${summary.slice(0, maxChars)}\n[truncated]` : summary;
  } catch {
    return null;
  }
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
      `HIGH PRIORITY comment: ${parsed.comment?.trim() || '(empty)'}`,
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
