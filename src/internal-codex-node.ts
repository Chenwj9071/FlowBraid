import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { loadManifest, loadRunState } from './workspace.js';
import { runCodexTask } from './executors/codex.js';
import { getExternalSessionPath, writeExternalSessionState } from './external-session.js';
import { nowIso, resolveRelative } from './utils.js';
import { buildCodexPrompt } from './codex-prompt.js';
import type { CodexNodeDefinition, ExternalSessionState, WorkflowSourceMeta } from './types.js';

export interface InternalCodexNodeOptions {
  runDir: string;
  nodeId: string;
  codexCommand?: string;
}

export interface InternalCodexNodeResult {
  status: 'completed' | 'failed';
  exitCode: number | null;
}

export async function runInternalCodexNode(options: InternalCodexNodeOptions): Promise<InternalCodexNodeResult> {
  const { workspace, manifest } = await loadManifest(options.runDir);
  const state = await loadRunState(workspace);
  const node = manifest.workflow.nodes[options.nodeId];
  if (!node || node.type !== 'codex') {
    throw new Error(`Node ${options.nodeId} is not a codex node`);
  }

  const codexNode = node as CodexNodeDefinition;
  const nodeDir = path.join(workspace.nodesDir, options.nodeId);
  const nodeArtifactsDir = path.join(nodeDir, 'artifacts');
  const nodeLogPath = path.join(nodeDir, 'log.txt');
  await mkdir(nodeArtifactsDir, { recursive: true });

  const runtimeWorkflow = manifest.workflow as typeof manifest.workflow & Partial<WorkflowSourceMeta>;
  const workflowDirectory = runtimeWorkflow.directory ?? process.cwd();

  const workdir =
    resolveRelative(workflowDirectory, codexNode.workdir ?? manifest.workflow.workdir) ??
    workflowDirectory ??
    process.cwd();
  const contextDir =
    resolveRelative(workflowDirectory, codexNode.contextDir ?? manifest.workflow.contextDir) ?? workdir;
  const outputPath = path.join(nodeArtifactsDir, codexNode.outputFile ?? 'codex-last-message.md');
  const sessionPath = getExternalSessionPath(nodeDir);
  const prompt = buildCodexPrompt(manifest.workflow, options.nodeId, state.currentAttemptId ?? 'internal-codex-node', codexNode, nodeDir, nodeArtifactsDir, workspace, {
    contextDir,
    workdir,
  });

  await writeExternalSessionState(
    sessionPath,
    buildExternalState({
      status: 'launching',
      startedAt: nowIso(),
      updatedAt: nowIso(),
      resultFile: path.relative(nodeDir, outputPath),
      workerPid: process.pid,
    }),
  );

  await writeExternalSessionState(
    sessionPath,
    buildExternalState({
      status: 'running',
      startedAt: nowIso(),
      updatedAt: nowIso(),
      resultFile: path.relative(nodeDir, outputPath),
      workerPid: process.pid,
    }),
  );

  const execution = await runCodexTask({
    command: options.codexCommand,
    cwd: contextDir,
    workdir,
    logPath: nodeLogPath,
    outputPath,
    prompt,
    model: codexNode.model,
    interactiveTerminal:
      process.stdin.isTTY && process.stdout.isTTY ? { input: process.stdin, output: process.stdout } : undefined,
    preferNativeInteractive: process.stdin.isTTY && process.stdout.isTTY,
    env: {
      ...process.env,
      FLOWBRAID_RUN_DIR: workspace.runDir,
      FLOWBRAID_RUN_ID: workspace.runId,
      FLOWBRAID_WORKFLOW_ID: manifest.workflow.id,
      FLOWBRAID_NODE_ID: options.nodeId,
      FLOWBRAID_NODE_DIR: nodeDir,
      FLOWBRAID_NODE_ARTIFACTS_DIR: nodeArtifactsDir,
      FLOWBRAID_CONTEXT_DIR: contextDir,
      FLOWBRAID_WORKDIR: workdir,
      FLOWBRAID_RESUME_COUNT: String(state.resumeCount),
      FLOWBRAID_STEP_COUNT: String(state.stepCount),
      FLOWBRAID_CODEX_MODE: codexNode.mode,
    },
  });

  let finalStatus: 'completed' | 'failed' = (execution.exitCode ?? 1) === 0 ? 'completed' : 'failed';
  if (finalStatus === 'completed' && codexNode.mode === 'review') {
    const verdict = await readReviewVerdict(outputPath);
    finalStatus = verdict === 'approve' ? 'completed' : 'failed';
  }

  await writeExternalSessionState(
    sessionPath,
    buildExternalState({
      status: finalStatus,
      startedAt: nowIso(),
      updatedAt: nowIso(),
      completedAt: nowIso(),
      resultFile: path.relative(nodeDir, outputPath),
      workerPid: process.pid,
      exitCode: execution.exitCode,
      signal: execution.signal,
      error: finalStatus === 'failed' ? `codex node ${options.nodeId} failed` : undefined,
    }),
  );

  return {
    status: finalStatus,
    exitCode: execution.exitCode,
  };
}

function buildExternalState(state: Partial<ExternalSessionState> & Pick<ExternalSessionState, 'status' | 'startedAt' | 'updatedAt'>): ExternalSessionState {
  return {
    mode: 'detached_terminal',
    status: state.status,
    startedAt: state.startedAt,
    updatedAt: state.updatedAt,
    completedAt: state.completedAt,
    terminalPid: state.terminalPid,
    workerPid: state.workerPid,
    codexPid: state.codexPid,
    exitCode: state.exitCode,
    signal: state.signal,
    resultFile: state.resultFile,
    closeRequestedAt: state.closeRequestedAt,
    closeObservedAt: state.closeObservedAt,
    error: state.error,
  };
}

async function readReviewVerdict(filePath: string): Promise<'approve' | 'reject' | null> {
  try {
    const content = await readFile(filePath, 'utf8');
    const matched = content.match(/verdict\s*[:=]\s*(approve|reject)/iu);
    if (!matched) {
      return null;
    }
    return matched[1].toLowerCase() as 'approve' | 'reject';
  } catch {
    return null;
  }
}
