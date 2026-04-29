import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { runCodexTask } from './executors/codex.js';
import { runShellCommand } from './executors/shell.js';
import { createInitialState, createRunWorkspace, loadManifest, loadRunState, persistRunState } from './workspace.js';
import { appendText, ensureDir, nowIso, resolveRelative, writeJson } from './utils.js';
import {
  ApprovalNodeDefinition,
  CodexNodeDefinition,
  EndNodeDefinition,
  ExecutionResult,
  GateNodeDefinition,
  NodeState,
  RunState,
  RunWorkspace,
  RunnerOptions,
  ShellNodeDefinition,
  WorkflowDefinition,
  WorkflowNodeDefinition,
  WorkflowSourceMeta,
} from './types.js';
import { resolveApprovalNext, resolveNodeNext } from './workflow.js';

type NodeOutcome = 'success' | 'failure' | 'paused';
type RuntimeWorkflow = WorkflowDefinition & WorkflowSourceMeta;

export class FlowBraidEngine {
  constructor(
    private readonly workflow: RuntimeWorkflow,
    private readonly options: RunnerOptions = {},
    private readonly sourceDir: string = process.cwd(),
  ) {}

  async start(): Promise<ExecutionResult> {
    const workspaceRoot = this.options.workspaceRoot ?? path.resolve(this.sourceDir, '.flowbraid-runs');
    await ensureDir(workspaceRoot);
    const workspace = await createRunWorkspace(workspaceRoot, this.workflow);
    const state = await createInitialState(workspace, this.workflow);
    return this.runLoop(workspace, state);
  }

  async resume(runDir: string): Promise<ExecutionResult> {
    const { workspace, manifest } = await loadManifest(runDir);
    const state = await loadRunState(workspace);

    if (state.status !== 'paused') {
      return {
        status: state.status,
        runId: state.runId,
        runDir: workspace.runDir,
        currentNodeId: state.currentNodeId,
        pendingNodeId: state.pendingNodeId,
      };
    }

    const currentNode = state.currentNodeId ? this.workflow.nodes[state.currentNodeId] : null;
    if (!state.pendingNodeId && currentNode?.type !== 'approval') {
      throw new Error('运行状态为 paused，但 pendingNodeId 为空，无法 resume');
    }
    if (currentNode?.type === 'approval' && !this.options.approvalDecision) {
      throw new Error('approval 节点需要通过 --decision approve|reject 指定人工确认结果');
    }

    state.status = 'running';
    if (currentNode?.type === 'approval') {
      state.pendingNodeId = null;
    } else {
      state.currentNodeId = state.pendingNodeId;
      state.pendingNodeId = null;
    }
    state.resumeCount += 1;
    await persistRunState(workspace, state);

    const resumedWorkflow = manifest.workflow as RuntimeWorkflow;
    const resumedEngine = new FlowBraidEngine(resumedWorkflow, this.options, resumedWorkflow.directory);
    return resumedEngine.runLoop(workspace, state, this.options.approvalDecision);
  }

  private async runLoop(
    workspace: RunWorkspace,
    state: RunState,
    approvalDecision?: 'approve' | 'reject',
  ): Promise<ExecutionResult> {
    const maxSteps = this.options.maxSteps ?? 200;
    let currentNodeId = state.currentNodeId;

    while (currentNodeId) {
      if (state.stepCount >= maxSteps) {
        state.status = 'failed';
        state.failedReason = `超过最大步骤数 ${maxSteps}`;
        await persistRunState(workspace, state);
        return this.finalize(workspace, state);
      }

      const node = this.workflow.nodes[currentNodeId];
      if (!node) {
        state.status = 'failed';
        state.failedReason = `找不到节点 ${currentNodeId}`;
        await persistRunState(workspace, state);
        return this.finalize(workspace, state);
      }

      state.stepCount += 1;
      await persistRunState(workspace, state);

      const nodeDir = path.join(workspace.nodesDir, currentNodeId);
      const nodeArtifactsDir = path.join(nodeDir, 'artifacts');
      const nodeLogPath = path.join(nodeDir, 'log.txt');
      await mkdir(nodeArtifactsDir, { recursive: true });

      const nodeState: NodeState = {
        nodeId: currentNodeId,
        status: 'running',
        startedAt: nowIso(),
      };
      await writeJson(path.join(nodeDir, 'status.json'), nodeState);
      await appendText(
        path.join(workspace.messagesDir, 'events.jsonl'),
        `${JSON.stringify({ type: 'node.started', nodeId: currentNodeId, at: nowIso() })}\n`,
      );

      let outcome: NodeOutcome = 'success';
      let exitCode: number | null = null;
      let signal: string | null = null;
      let detail: string | undefined;
      let nextNodeId: string | null = null;

      if (node.type === 'shell') {
        const shellNode = node as ShellNodeDefinition;
        const cwd =
          resolveRelative(this.workflow.directory, shellNode.cwd ?? this.workflow.workdir ?? this.options.defaultWorkdir) ??
          this.workflow.directory;
        const execution = await runShellCommand({
          command: shellNode.command,
          cwd,
          logPath: nodeLogPath,
          env: {
            ...process.env,
            FLOWBRAID_RUN_DIR: workspace.runDir,
            FLOWBRAID_RUN_ID: workspace.runId,
            FLOWBRAID_WORKFLOW_ID: this.workflow.id,
            FLOWBRAID_NODE_ID: currentNodeId,
            FLOWBRAID_NODE_DIR: nodeDir,
            FLOWBRAID_NODE_ARTIFACTS_DIR: nodeArtifactsDir,
            FLOWBRAID_RESUME_COUNT: String(state.resumeCount),
            FLOWBRAID_STEP_COUNT: String(state.stepCount),
          },
          onLine: (line) => this.options.logger?.(`[${currentNodeId}] ${line}`),
        });
        exitCode = execution.exitCode;
        signal = execution.signal;
        if ((exitCode ?? 1) !== 0) {
          outcome = 'failure';
          detail = `shell 退出码 ${exitCode ?? 'null'}`;
        }
        nextNodeId = resolveNodeNext(node, outcome === 'failure' ? 'failure' : 'success');
      } else if (node.type === 'codex') {
        const codexNode = node as CodexNodeDefinition;
        const cwd =
          resolveRelative(this.workflow.directory, codexNode.cwd ?? this.workflow.workdir ?? this.options.defaultWorkdir) ??
          this.workflow.directory;
        const outputFile = path.join(nodeArtifactsDir, codexNode.outputFile ?? 'codex-last-message.md');
        const prompt = buildCodexPrompt(this.workflow, currentNodeId, codexNode, nodeDir, nodeArtifactsDir, workspace);
        const execution = await runCodexTask({
          command: this.options.codexCommand,
          cwd,
          logPath: nodeLogPath,
          outputPath: outputFile,
          prompt,
          model: codexNode.model,
          env: {
            ...process.env,
            FLOWBRAID_RUN_DIR: workspace.runDir,
            FLOWBRAID_RUN_ID: workspace.runId,
            FLOWBRAID_WORKFLOW_ID: this.workflow.id,
            FLOWBRAID_NODE_ID: currentNodeId,
            FLOWBRAID_NODE_DIR: nodeDir,
            FLOWBRAID_NODE_ARTIFACTS_DIR: nodeArtifactsDir,
            FLOWBRAID_RESUME_COUNT: String(state.resumeCount),
            FLOWBRAID_STEP_COUNT: String(state.stepCount),
            FLOWBRAID_CODEX_MODE: codexNode.mode,
          },
          onLine: (line) => this.options.logger?.(`[${currentNodeId}] ${line}`),
        });
        exitCode = execution.exitCode;
        signal = execution.signal;
        if ((exitCode ?? 1) !== 0) {
          outcome = 'failure';
          detail = `codex 退出码 ${exitCode ?? 'null'}`;
        } else {
          detail = `codex ${codexNode.mode} 完成`;
        }
        nextNodeId = resolveNodeNext(node, outcome === 'failure' ? 'failure' : 'success');
      } else if (node.type === 'gate') {
        const gateNode = node as GateNodeDefinition;
        outcome = 'paused';
        detail = gateNode.prompt ?? '等待人工确认';
        nextNodeId = resolveNodeNext(node, 'default');
      } else if (node.type === 'approval') {
        const approvalNode = node as ApprovalNodeDefinition;
        const decision = approvalDecision;
        if (!decision) {
          outcome = 'paused';
          detail = approvalNode.prompt ?? '等待人工确认';
          nextNodeId = null;
        } else {
          outcome = 'success';
          detail = `decision=${decision}`;
          nextNodeId = resolveApprovalNext(node, decision);
          approvalDecision = undefined;
        }
      } else if (node.type === 'end') {
        const endNode = node as EndNodeDefinition;
        outcome = 'success';
        detail = endNode.message ?? 'workflow 结束';
        nextNodeId = null;
      }

      nodeState.status = outcome === 'paused' ? 'paused' : outcome === 'failure' ? 'failed' : 'succeeded';
      nodeState.finishedAt = nowIso();
      nodeState.exitCode = exitCode;
      nodeState.signal = signal;
      nodeState.detail = detail;
      await writeJson(path.join(nodeDir, 'status.json'), nodeState);
      await appendText(
        path.join(workspace.messagesDir, 'events.jsonl'),
        `${JSON.stringify({ type: `node.${outcome}`, nodeId: currentNodeId, at: nowIso(), detail })}\n`,
      );

      if (outcome === 'paused') {
        state.status = 'paused';
        state.currentNodeId = currentNodeId;
        state.pendingNodeId = nextNodeId;
        await persistRunState(workspace, state);
        return this.finalize(workspace, state);
      }

      if (outcome === 'failure') {
        state.status = 'failed';
        state.currentNodeId = currentNodeId;
        state.pendingNodeId = nextNodeId;
        state.failedReason = detail;
        await persistRunState(workspace, state);
        return this.finalize(workspace, state);
      }

      currentNodeId = nextNodeId;
      state.currentNodeId = currentNodeId;
      state.pendingNodeId = null;
      await persistRunState(workspace, state);
    }

    state.status = 'completed';
    state.currentNodeId = null;
    state.pendingNodeId = null;
    await persistRunState(workspace, state);
    return this.finalize(workspace, state);
  }

  private async finalize(workspace: RunWorkspace, state: RunState): Promise<ExecutionResult> {
    if (state.status === 'completed') {
      state.finishedAt = nowIso();
      await persistRunState(workspace, state);
      await appendText(
        path.join(workspace.messagesDir, 'events.jsonl'),
        `${JSON.stringify({ type: 'run.completed', at: nowIso(), runId: state.runId })}\n`,
      );
    } else if (state.status === 'paused') {
      await appendText(
        path.join(workspace.messagesDir, 'events.jsonl'),
        `${JSON.stringify({ type: 'run.paused', at: nowIso(), runId: state.runId })}\n`,
      );
    } else if (state.status === 'failed') {
      state.finishedAt = nowIso();
      await persistRunState(workspace, state);
      await appendText(
        path.join(workspace.messagesDir, 'events.jsonl'),
        `${JSON.stringify({ type: 'run.failed', at: nowIso(), runId: state.runId, reason: state.failedReason })}\n`,
      );
    }

    return {
      status: state.status,
      runId: state.runId,
      runDir: workspace.runDir,
      currentNodeId: state.currentNodeId,
      pendingNodeId: state.pendingNodeId,
    };
  }
}

function buildCodexPrompt(
  workflow: RuntimeWorkflow,
  nodeId: string,
  node: CodexNodeDefinition,
  nodeDir: string,
  nodeArtifactsDir: string,
  workspace: RunWorkspace,
): string {
  const modeText =
    node.mode === 'review'
      ? '你是代码审核节点。请对当前工作区内的修改进行 code review，明确给出 verdict=approve 或 verdict=reject，并说明原因。'
      : '你是开发节点。请根据任务说明修改当前工作区内的文件，直接输出可运行结果。';

  return [
    modeText,
    '',
    `workflow.id: ${workflow.id}`,
    `node.id: ${nodeId}`,
    `run.dir: ${workspace.runDir}`,
    `node.dir: ${nodeDir}`,
    `artifacts.dir: ${nodeArtifactsDir}`,
    '',
    '任务说明：',
    node.prompt,
    '',
    '要求：',
    '1. 直接在工作目录中修改文件。',
    '2. 最终消息要可供人工审阅。',
    '3. 需要时请在输出里说明你修改了哪些文件。',
  ].join('\n');
}

export async function startWorkflow(
  workflow: RuntimeWorkflow,
  options: RunnerOptions = {},
  sourceDir = process.cwd(),
): Promise<ExecutionResult> {
  const engine = new FlowBraidEngine(workflow, options, workflow.directory ?? sourceDir);
  return engine.start();
}

export async function resumeWorkflow(runDir: string, options: RunnerOptions = {}): Promise<ExecutionResult> {
  const { manifest } = await loadManifest(runDir);
  const workflow = manifest.workflow as RuntimeWorkflow;
  const engine = new FlowBraidEngine(workflow, options, workflow.directory);
  return engine.resume(runDir);
}
