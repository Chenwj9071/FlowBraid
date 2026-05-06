import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import {
  runCodexTask,
  buildNativeCodexCliInvocation,
  buildNativeCodexResumeInvocation,
} from './executors/codex.js';
import { runShellCommand } from './executors/shell.js';
import {
  createInitialState,
  createRunWorkspace,
  loadManifest,
  loadRunState,
  loadRunTimeline,
  persistRunState,
  persistRunTimeline,
} from './workspace.js';
import { appendText, createAttemptId, ensureDir, nowIso, resolveRelative, writeJson } from './utils.js';
import type {
  AgentSessionNodeDefinition,
  AgentSessionState,
  ApprovalNodeDefinition,
  CodexNodeDefinition,
  ExecutionResult,
  GateNodeDefinition,
  NativeSessionState,
  NodeState,
  RunState,
  RunWorkspace,
  RunnerOptions,
  ShellNodeDefinition,
  WorkflowDefinition,
  WorkflowSourceMeta,
  AgentSessionMessage,
  EndNodeDefinition,
  RunTimelineEntry,
} from './types.js';
import { resolveApprovalNext, resolveNodeNext } from './workflow.js';
import { RunInterruptedError, isAbortSignalTriggered } from './errors.js';
import { appendAgentSessionMessage, getAgentSessionPaths, readAgentSessionMessages, readAgentSessionState, writeAgentSessionState } from './agent-session.js';
import { runCodexSessionTurn } from './session-providers/codex.js';
import { createExternalTerminalLauncher } from './terminal-launchers/index.js';
import { buildCodexPrompt } from './codex-prompt.js';
import {
  appendNativeNodeEvent,
  getNativeSessionPath,
  readLatestNativeTerminalEvent,
  readNativeSessionState,
  writeNativeSessionState,
} from './native-session.js';

type NodeOutcome = 'success' | 'failure' | 'paused';
type RuntimeWorkflow = WorkflowDefinition & WorkflowSourceMeta;

const INTERRUPTED_REASON = '用户中断运行';

interface NodeDirectories {
  contextDir: string;
  workdir: string;
}

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
    this.options.logger?.(`[run] started ${workspace.runId}`);
    this.options.logger?.(`[run] workspace ${workspace.runDir}`);
    return this.runLoop(workspace, state);
  }

  async resume(runDir: string): Promise<ExecutionResult> {
    const { workspace, manifest } = await loadManifest(runDir);
    const state = await loadRunState(workspace);

    if (state.status !== 'paused') {
      return this.toExecutionResult(workspace, state);
    }

    const currentNode = state.currentNodeId ? this.workflow.nodes[state.currentNodeId] : null;
    if (!state.pendingNodeId && currentNode?.type !== 'approval') {
      throw new Error('运行状态为 paused，但 pendingNodeId 为空，无法 resume');
    }
    if (currentNode?.type === 'approval' && !this.options.approvalDecision) {
      throw new Error('approval 节点需要通过 --decision approve|reject 指定人工确认结果');
    }
    if (currentNode?.type === 'approval' && this.options.approvalDecision === 'reject' && !this.options.approvalComment) {
      throw new Error('approval 节点 reject 时必须提供打回意见');
    }
    if (currentNode?.type === 'agent_session') {
      throw new Error('agent_session 节点请使用 send 继续对话，而不是 resume');
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
    this.options.logger?.(`[run] resume #${state.resumeCount} from ${runDir}`);
    this.options.logger?.(
      currentNode?.type === 'approval'
        ? `[run] approval decision ${this.options.approvalDecision ?? 'unknown'} -> ${state.currentNodeId ?? state.pendingNodeId ?? 'end'}`
        : `[run] continue at ${state.currentNodeId ?? 'end'}`,
    );

    const resumedWorkflow = manifest.workflow as RuntimeWorkflow;
    const resumedEngine = new FlowBraidEngine(resumedWorkflow, this.options, resumedWorkflow.directory);
    return resumedEngine.runLoop(workspace, state, this.options.approvalDecision);
  }

  async send(runDir: string, message: string): Promise<ExecutionResult> {
    const { workspace, manifest } = await loadManifest(runDir);
    const state = await loadRunState(workspace);

    if (state.status !== 'paused' || !state.currentNodeId) {
      throw new Error('当前 run 不是等待输入状态，无法 send');
    }

    const currentNode = manifest.workflow.nodes[state.currentNodeId];
    if (currentNode?.type !== 'agent_session') {
      throw new Error(`当前暂停节点不是 agent_session，而是 ${currentNode?.type ?? 'unknown'}`);
    }

    const nodeDir = path.join(workspace.nodesDir, state.currentNodeId);
    const { inboxPath, sessionStatePath } = getAgentSessionPaths(nodeDir);
    const sessionState = await readAgentSessionState(sessionStatePath);
    if (sessionState.status !== 'waiting_input') {
      throw new Error(`agent_session 当前状态不是 waiting_input，而是 ${sessionState.status}`);
    }

    const nextTurn = sessionState.turnCount + 1;
    sessionState.lastUserMessage = message;
    sessionState.status = 'running';
    await writeAgentSessionState(sessionStatePath, sessionState);
    await appendAgentSessionMessage(inboxPath, {
      kind: 'message',
      role: 'user',
      content: message,
      at: nowIso(),
      turn: nextTurn,
    });

    state.status = 'running';
    state.pendingNodeId = null;
    await persistRunState(workspace, state);

    const resumedWorkflow = manifest.workflow as RuntimeWorkflow;
    const resumedEngine = new FlowBraidEngine(resumedWorkflow, this.options, resumedWorkflow.directory);
    return resumedEngine.runLoop(workspace, state);
  }

  private async runLoop(
    workspace: RunWorkspace,
    state: RunState,
    approvalDecision?: 'approve' | 'reject',
  ): Promise<ExecutionResult> {
    const maxSteps = this.options.maxSteps ?? 200;
    let currentNodeId = state.currentNodeId;

    while (currentNodeId) {
      if (isAbortSignalTriggered(this.options.abortSignal)) {
        state.status = 'failed';
        state.failedReason = INTERRUPTED_REASON;
        state.currentNodeId = currentNodeId;
        await persistRunState(workspace, state);
        return this.finalize(workspace, state);
      }

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
      this.options.logger?.(`[run] step ${state.stepCount}: enter node ${currentNodeId} (${node.type})`);
      const attemptId = createAttemptId();
      state.currentAttemptId = attemptId;
      await persistRunState(workspace, state);

      const nodeDir = path.join(workspace.nodesDir, currentNodeId);
      const nodeArtifactsDir = path.join(nodeDir, 'artifacts');
      const nodeLogPath = path.join(nodeDir, 'log.txt');
      await mkdir(nodeArtifactsDir, { recursive: true });

      const nodeState: NodeState = {
        nodeId: currentNodeId,
        attemptId,
        status: 'running',
        startedAt: nowIso(),
      };
      await writeJson(path.join(nodeDir, 'status.json'), nodeState);
      await this.appendTimelineEntry(workspace, {
        stepIndex: state.stepCount,
        nodeId: currentNodeId,
        attemptId,
        status: 'running',
        startedAt: nodeState.startedAt!,
      });
      await appendText(
        path.join(workspace.messagesDir, 'events.jsonl'),
        `${JSON.stringify({ type: 'node.started', nodeId: currentNodeId, attemptId, at: nowIso() })}\n`,
      );

      let outcome: NodeOutcome = 'success';
      let exitCode: number | null = null;
      let signal: string | null = null;
      let detail: string | undefined;
      let nextNodeId: string | null = null;

      try {
        if (node.type === 'shell') {
          const execution = await this.runShellNode(node, currentNodeId, workspace, nodeDir, nodeArtifactsDir, nodeLogPath, state);
          exitCode = execution.exitCode;
          signal = execution.signal;
          if ((exitCode ?? 1) !== 0) {
            outcome = 'failure';
            detail = `shell 退出码 ${exitCode ?? 'null'}`;
          }
          nextNodeId = resolveNodeNext(node, outcome === 'failure' ? 'failure' : 'success');
        } else if (node.type === 'codex') {
          if (this.options.nativeSplitTerminals) {
            const execution = await this.runNativeSplitCodexNode(node, currentNodeId, attemptId, workspace, nodeDir, nodeArtifactsDir);
            exitCode = execution.exitCode;
            signal = execution.signal;
            outcome = execution.outcome;
            detail = execution.detail;
            nextNodeId = resolveNodeNext(node, outcome === 'failure' ? 'failure' : 'success');
          } else {
            const execution = await this.runCodexNode(node, currentNodeId, workspace, nodeDir, nodeArtifactsDir, nodeLogPath, state);
            exitCode = execution.exitCode;
            signal = execution.signal;
            if ((exitCode ?? 1) !== 0) {
              outcome = 'failure';
              detail = `codex 退出码 ${exitCode ?? 'null'}`;
            } else if (node.mode === 'review') {
              const verdict = await readReviewVerdict(path.join(nodeArtifactsDir, node.outputFile ?? 'codex-last-message.md'));
              if (verdict === 'reject') {
                outcome = 'failure';
                detail = 'review verdict=reject';
              } else if (verdict === 'approve') {
                detail = 'review verdict=approve';
              } else {
                outcome = 'failure';
                detail = 'codex review 完成，但未声明 verdict';
              }
            } else {
              detail = `codex ${node.mode} 完成`;
            }
            nextNodeId = resolveNodeNext(node, outcome === 'failure' ? 'failure' : 'success');
          }
        } else if (node.type === 'agent_session') {
          const execution = await this.runAgentSessionNode(node, currentNodeId, workspace, nodeDir, nodeArtifactsDir, nodeLogPath, state);
          detail = execution.detail;
          if (execution.kind === 'waiting_input') {
            outcome = 'paused';
            nextNodeId = null;
          } else if (execution.kind === 'completed') {
            outcome = 'success';
            nextNodeId = resolveNodeNext(node, 'success');
          } else {
            outcome = 'failure';
            nextNodeId = resolveNodeNext(node, 'failure');
          }
        } else if (node.type === 'gate') {
          outcome = 'paused';
          detail = node.prompt ?? '等待人工确认';
          nextNodeId = resolveNodeNext(node, 'default');
        } else if (node.type === 'approval') {
          if (!approvalDecision) {
            outcome = 'paused';
            detail = node.prompt ?? '等待人工确认';
            nextNodeId = null;
          } else {
            outcome = 'success';
            detail = `decision=${approvalDecision}`;
            nextNodeId = resolveApprovalNext(node, approvalDecision);
            await this.recordApprovalDecision(workspace, currentNodeId, approvalDecision, this.options.approvalComment, nextNodeId);
            approvalDecision = undefined;
          }
        } else if (node.type === 'end') {
          outcome = 'success';
          detail = node.message ?? 'workflow 结束';
          nextNodeId = null;
        }
      } catch (error) {
        if (error instanceof RunInterruptedError) {
          outcome = 'failure';
          exitCode = 130;
          signal = 'SIGINT';
          detail = INTERRUPTED_REASON;
          nextNodeId = null;
        } else {
          outcome = 'failure';
          detail = error instanceof Error ? error.message : String(error);
          nextNodeId = resolveNodeNext(node, 'failure');
        }
      }

      nodeState.status = outcome === 'paused' ? 'paused' : outcome === 'failure' ? 'failed' : 'succeeded';
      nodeState.finishedAt = nowIso();
      nodeState.exitCode = exitCode;
      nodeState.signal = signal;
      nodeState.detail = detail;
      await writeJson(path.join(nodeDir, 'status.json'), nodeState);
      await this.updateTimelineEntry(workspace, attemptId, {
        status: nodeState.status,
        finishedAt: nodeState.finishedAt,
        detail,
        outcome,
        nextNodeId,
      });
      await appendText(
        path.join(workspace.messagesDir, 'events.jsonl'),
        `${JSON.stringify({ type: `node.${outcome}`, nodeId: currentNodeId, attemptId, at: nowIso(), detail })}\n`,
      );

      if (outcome === 'paused') {
        state.status = 'paused';
        state.currentNodeId = currentNodeId;
        state.pendingNodeId = nextNodeId;
        await persistRunState(workspace, state);
        this.options.logger?.(
          `[run] paused at ${currentNodeId}${nextNodeId ? `, next ${nextNodeId}` : ''}${detail ? `: ${detail}` : ''}`,
        );
        return this.finalize(workspace, state);
      }

      if (outcome === 'failure') {
        if (nextNodeId) {
          this.options.logger?.(`[run] node ${currentNodeId} failed, route to ${nextNodeId}${detail ? `: ${detail}` : ''}`);
          currentNodeId = nextNodeId;
          state.currentNodeId = currentNodeId;
          state.currentAttemptId = null;
          state.pendingNodeId = null;
          await persistRunState(workspace, state);
          continue;
        }
        this.options.logger?.(`[run] failed at ${currentNodeId}${detail ? `: ${detail}` : ''}`);
        state.status = 'failed';
        state.currentNodeId = currentNodeId;
        state.currentAttemptId = attemptId;
        state.pendingNodeId = nextNodeId;
        state.failedReason = detail;
        await persistRunState(workspace, state);
        return this.finalize(workspace, state);
      }

      this.options.logger?.(
        nextNodeId
          ? `[run] node ${currentNodeId} succeeded, next ${nextNodeId}${detail ? `: ${detail}` : ''}`
          : `[run] node ${currentNodeId} succeeded${detail ? `: ${detail}` : ''}`,
      );
      currentNodeId = nextNodeId;
      state.currentNodeId = currentNodeId;
      state.currentAttemptId = null;
      state.pendingNodeId = null;
      await persistRunState(workspace, state);
    }

    state.status = 'completed';
    state.currentNodeId = null;
    state.currentAttemptId = null;
    state.pendingNodeId = null;
    await persistRunState(workspace, state);
    this.options.logger?.('[run] completed');
    return this.finalize(workspace, state);
  }

  private async runShellNode(
    node: ShellNodeDefinition,
    nodeId: string,
    workspace: RunWorkspace,
    nodeDir: string,
    nodeArtifactsDir: string,
    nodeLogPath: string,
    state: RunState,
  ) {
    const dirs = this.resolveNodeDirectories(node);
    const cwd = resolveRelative(this.workflow.directory, node.cwd) ?? dirs.contextDir;
    return runShellCommand({
      command: node.command,
      cwd,
      logPath: nodeLogPath,
      abortSignal: this.options.abortSignal,
      env: {
        ...process.env,
        FLOWBRAID_RUN_DIR: workspace.runDir,
        FLOWBRAID_RUN_ID: workspace.runId,
        FLOWBRAID_WORKFLOW_ID: this.workflow.id,
        FLOWBRAID_NODE_ID: nodeId,
        FLOWBRAID_NODE_DIR: nodeDir,
        FLOWBRAID_NODE_ARTIFACTS_DIR: nodeArtifactsDir,
        FLOWBRAID_CONTEXT_DIR: dirs.contextDir,
        FLOWBRAID_WORKDIR: dirs.workdir,
        FLOWBRAID_RESUME_COUNT: String(state.resumeCount),
        FLOWBRAID_STEP_COUNT: String(state.stepCount),
      },
      onLine: (line) => this.options.logger?.(`[${nodeId}] ${line}`),
    });
  }

  private async runCodexNode(
    node: CodexNodeDefinition,
    nodeId: string,
    workspace: RunWorkspace,
    nodeDir: string,
    nodeArtifactsDir: string,
    nodeLogPath: string,
    state: RunState,
  ) {
    const dirs = this.resolveNodeDirectories(node);
    const cwd = resolveRelative(this.workflow.directory, node.cwd) ?? dirs.contextDir;
    const outputFile = path.join(nodeArtifactsDir, node.outputFile ?? 'codex-last-message.md');
    const prompt = buildCodexPrompt(this.workflow, nodeId, state.currentAttemptId ?? createAttemptId(), node, nodeDir, nodeArtifactsDir, workspace, dirs);
    return runCodexTask({
      command: this.options.codexCommand,
      cwd,
      workdir: dirs.workdir,
      logPath: nodeLogPath,
      outputPath: outputFile,
      prompt,
      model: node.model,
      interactiveTerminal: this.options.interactiveTerminal,
      abortSignal: this.options.abortSignal,
      env: {
        ...process.env,
        FLOWBRAID_RUN_DIR: workspace.runDir,
        FLOWBRAID_RUN_ID: workspace.runId,
        FLOWBRAID_WORKFLOW_ID: this.workflow.id,
        FLOWBRAID_NODE_ID: nodeId,
        FLOWBRAID_NODE_DIR: nodeDir,
        FLOWBRAID_NODE_ARTIFACTS_DIR: nodeArtifactsDir,
        FLOWBRAID_CONTEXT_DIR: dirs.contextDir,
        FLOWBRAID_WORKDIR: dirs.workdir,
        FLOWBRAID_RESUME_COUNT: String(state.resumeCount),
        FLOWBRAID_STEP_COUNT: String(state.stepCount),
        FLOWBRAID_CODEX_MODE: node.mode,
      },
      onLine: (line) => this.options.logger?.(`[${nodeId}] ${line}`),
    });
  }

  private async runNativeSplitCodexNode(
    node: CodexNodeDefinition,
    nodeId: string,
    attemptId: string,
    workspace: RunWorkspace,
    nodeDir: string,
    nodeArtifactsDir: string,
  ): Promise<{ exitCode: number | null; signal: string | null; outcome: 'success' | 'failure' | 'paused'; detail: string }> {
    const dirs = this.resolveNodeDirectories(node);
    const launcher = this.options.externalTerminalLauncher ?? createExternalTerminalLauncher();
    const sessionPath = getNativeSessionPath(nodeDir);
    const previousSession = await this.readResumableNativeSession(nodeDir);
    const shouldResume = !!previousSession?.sessionId;
    const prompt = buildCodexPrompt(this.workflow, nodeId, attemptId, node, nodeDir, nodeArtifactsDir, workspace, dirs, {
      protocolMode: 'native-split',
      resumeSession: shouldResume,
    });
    const invocation = shouldResume
      ? buildNativeCodexResumeInvocation({
          command: this.options.codexCommand,
          prompt,
          workdir: dirs.workdir,
          contextDir: dirs.contextDir,
          sessionId: previousSession!.sessionId!,
          model: node.model,
        })
      : buildNativeCodexCliInvocation({
          command: this.options.codexCommand,
          prompt,
          workdir: dirs.workdir,
          contextDir: dirs.contextDir,
          model: node.model,
        });
    const startedAt = nowIso();

    await writeNativeSessionState(sessionPath, {
      mode: 'native_split_terminal',
      attemptId,
      status: 'launching',
      startedAt,
      updatedAt: startedAt,
    });
    this.options.logger?.(
      shouldResume
        ? `[native] launch ${nodeId} via resume session ${previousSession?.sessionId}`
        : `[native] launch ${nodeId} via new codex session`,
    );

    const launched = await launcher.launch({
      title: `FlowBraid native ${nodeId}`,
      workingDirectory: dirs.contextDir,
      command: invocation.command,
      args: invocation.args,
      keepOpenOnExit: false,
    });

    await appendText(
      path.join(workspace.messagesDir, 'events.jsonl'),
      `${JSON.stringify({ type: 'terminal.launched', nodeId, terminalPid: launched.terminalPid, at: nowIso() })}\n`,
    );
    this.options.logger?.(`[native] ${nodeId} terminal pid ${launched.terminalPid}`);

    const terminalState = await this.waitForNativeSession(sessionPath, workspace.messagesDir, nodeId, attemptId, launched.terminalPid, startedAt);
    const finalState: NativeSessionState = {
      ...terminalState,
      attemptId,
      sessionId: terminalState.sessionId ?? previousSession?.sessionId,
      terminalPid: terminalState.terminalPid ?? launched.terminalPid,
      updatedAt: nowIso(),
    };
    await writeNativeSessionState(sessionPath, finalState);
    await appendNativeNodeEvent(workspace.messagesDir, {
      type: 'terminal.close_requested',
      nodeId,
      attemptId,
      terminalPid: launched.terminalPid,
      at: nowIso(),
    });
    this.options.logger?.(`[native] ${nodeId} reported ${finalState.status}, waiting briefly for session exit`);

    await delay(750);

    try {
      await launcher.close(launched.terminalPid);
      this.options.logger?.(`[native] ${nodeId} terminal close requested for pid ${launched.terminalPid}`);
    } catch (error) {
      const closeErrorMessage = error instanceof Error ? error.message : String(error);
      this.options.logger?.(`[native] ${nodeId} terminal close ignored for pid ${launched.terminalPid}: ${closeErrorMessage}`);
      await appendNativeNodeEvent(workspace.messagesDir, {
        type: 'terminal.close_ignored',
        nodeId,
        attemptId,
        terminalPid: launched.terminalPid,
        at: nowIso(),
        message: closeErrorMessage,
      });
    }

    await writeNativeSessionState(sessionPath, {
      ...finalState,
      updatedAt: nowIso(),
    });
    await appendText(
      path.join(workspace.messagesDir, 'events.jsonl'),
      `${JSON.stringify({ type: 'terminal.closed', nodeId, terminalPid: launched.terminalPid, at: nowIso() })}\n`,
    );
    this.options.logger?.(`[native] ${nodeId} terminal closed ${launched.terminalPid}`);

    if (finalState.status === 'paused') {
      return {
        exitCode: 0,
        signal: null,
        outcome: 'paused',
        detail: finalState.result?.reason ?? 'native codex paused',
      };
    }

    if (finalState.status !== 'completed') {
      return {
        exitCode: 1,
        signal: null,
        outcome: 'failure',
        detail: finalState.result?.message ?? finalState.result?.reason ?? 'native codex failed',
      };
    }

    if (node.mode === 'review') {
      const verdict = await readReviewVerdict(path.join(nodeArtifactsDir, node.outputFile ?? 'codex-last-message.md'));
      if (verdict === 'reject') {
        return {
          exitCode: 0,
          signal: null,
          outcome: 'failure',
          detail: 'review verdict=reject',
        };
      }
      if (verdict === 'approve') {
        return {
          exitCode: 0,
          signal: null,
          outcome: 'success',
          detail: 'review verdict=approve',
        };
      }
      return {
        exitCode: 1,
        signal: null,
        outcome: 'failure',
        detail: 'native codex review completed without verdict',
      };
    }

    return {
      exitCode: 0,
      signal: null,
      outcome: 'success',
      detail: shouldResume ? 'codex resumed and completed via native split terminal' : 'codex exec completed via native split terminal',
    };
  }

  private async runAgentSessionNode(
    node: AgentSessionNodeDefinition,
    nodeId: string,
    workspace: RunWorkspace,
    nodeDir: string,
    nodeArtifactsDir: string,
    nodeLogPath: string,
    state: RunState,
  ): Promise<{ kind: 'waiting_input' | 'completed' | 'failed'; detail: string }> {
    const dirs = this.resolveNodeDirectories(node);
    const cwd = resolveRelative(this.workflow.directory, node.cwd) ?? dirs.contextDir;
    const { inboxPath, outboxPath, sessionStatePath, schemaPath, turnOutputPath } = getAgentSessionPaths(nodeDir);
    let sessionState: AgentSessionState;
    try {
      sessionState = await readAgentSessionState(sessionStatePath);
    } catch {
      sessionState = {
        nodeId,
        provider: node.provider,
        status: 'running',
        turnCount: 0,
        startedAt: nowIso(),
        updatedAt: nowIso(),
        outputFile: node.outputFile,
      };
      await appendAgentSessionMessage(inboxPath, {
        kind: 'message',
        role: 'system',
        content: buildAgentSessionSystemPrompt(this.workflow, nodeId, nodeDir, nodeArtifactsDir, workspace),
        at: nowIso(),
        turn: 0,
      });
      await appendAgentSessionMessage(inboxPath, {
        kind: 'message',
        role: 'user',
        content: node.prompt,
        at: nowIso(),
        turn: 0,
      });
    }

    await writeAgentSessionState(sessionStatePath, {
      ...sessionState,
      status: 'running',
      outputFile: node.outputFile,
    });

    const messages = await readAgentSessionMessages(inboxPath, outboxPath);
    const turnResult = await runCodexSessionTurn({
      command: this.options.codexCommand,
      cwd,
      workdir: dirs.workdir,
      logPath: nodeLogPath,
      outputPath: turnOutputPath,
      schemaPath,
      model: node.model,
      abortSignal: this.options.abortSignal,
      messages,
      env: {
        ...process.env,
        FLOWBRAID_RUN_DIR: workspace.runDir,
        FLOWBRAID_RUN_ID: workspace.runId,
        FLOWBRAID_WORKFLOW_ID: this.workflow.id,
        FLOWBRAID_NODE_ID: nodeId,
        FLOWBRAID_NODE_DIR: nodeDir,
        FLOWBRAID_NODE_ARTIFACTS_DIR: nodeArtifactsDir,
        FLOWBRAID_CONTEXT_DIR: dirs.contextDir,
        FLOWBRAID_WORKDIR: dirs.workdir,
        FLOWBRAID_RESUME_COUNT: String(state.resumeCount),
        FLOWBRAID_STEP_COUNT: String(state.stepCount),
        FLOWBRAID_AGENT_PROVIDER: node.provider,
      },
      onLine: (line) => this.options.logger?.(`[${nodeId}] ${line}`),
    });

    const nextTurn = sessionState.turnCount + 1;
    await appendAgentSessionMessage(outboxPath, {
      kind: 'message',
      role: 'assistant',
      content: turnResult.message,
      at: nowIso(),
      turn: nextTurn,
    });

    if (node.outputFile) {
      await writeJson(path.join(nodeArtifactsDir, node.outputFile), turnResult);
    }

    if (turnResult.status === 'waiting_input') {
      await appendAgentSessionMessage(outboxPath, {
        kind: 'event',
        type: 'session.waiting_input',
        content: turnResult.message,
        at: nowIso(),
        turn: nextTurn,
      });
      await writeAgentSessionState(sessionStatePath, {
        ...sessionState,
        status: 'waiting_input',
        turnCount: nextTurn,
        lastAssistantMessage: turnResult.message,
        outputFile: node.outputFile,
      });
      return { kind: 'waiting_input', detail: turnResult.message };
    }

    if (turnResult.status === 'completed') {
      await appendAgentSessionMessage(outboxPath, {
        kind: 'event',
        type: 'session.completed',
        content: turnResult.summary ?? turnResult.message,
        at: nowIso(),
        turn: nextTurn,
      });
      await writeAgentSessionState(sessionStatePath, {
        ...sessionState,
        status: 'completed',
        turnCount: nextTurn,
        lastAssistantMessage: turnResult.message,
        outputFile: node.outputFile,
        completedAt: nowIso(),
      });
      return { kind: 'completed', detail: turnResult.summary ?? turnResult.message };
    }

    await appendAgentSessionMessage(outboxPath, {
      kind: 'event',
      type: 'session.failed',
      content: turnResult.message,
      at: nowIso(),
      turn: nextTurn,
    });
    await writeAgentSessionState(sessionStatePath, {
      ...sessionState,
      status: 'failed',
      turnCount: nextTurn,
      lastAssistantMessage: turnResult.message,
      outputFile: node.outputFile,
      completedAt: nowIso(),
      error: turnResult.message,
    });
    return { kind: 'failed', detail: turnResult.message };
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

    return this.toExecutionResult(workspace, state);
  }

  private async recordApprovalDecision(
    workspace: RunWorkspace,
    nodeId: string,
    decision: 'approve' | 'reject',
    comment: string | undefined,
    targetNodeId: string | null,
  ): Promise<void> {
    const payload = { type: 'approval.decision', nodeId, decision, comment, targetNodeId, at: nowIso() };
    await appendText(path.join(workspace.messagesDir, 'human-feedback.jsonl'), `${JSON.stringify(payload)}\n`);
    await appendText(path.join(workspace.messagesDir, 'events.jsonl'), `${JSON.stringify(payload)}\n`);
  }

  private toExecutionResult(workspace: RunWorkspace, state: RunState): ExecutionResult {
    return {
      status: state.status,
      runId: state.runId,
      runDir: workspace.runDir,
      currentNodeId: state.currentNodeId,
      pendingNodeId: state.pendingNodeId,
    };
  }

  private resolveNodeDirectories(node: ShellNodeDefinition | CodexNodeDefinition | AgentSessionNodeDefinition): NodeDirectories {
    const workdir =
      resolveRelative(this.workflow.directory, node.workdir ?? this.workflow.workdir ?? this.options.defaultWorkdir) ??
      this.workflow.directory;
    const contextDir = resolveRelative(this.workflow.directory, node.contextDir ?? this.workflow.contextDir) ?? workdir;
    return { contextDir, workdir };
  }

  private async waitForNativeSession(
    sessionPath: string,
    messagesDir: string,
    nodeId: string,
    attemptId: string,
    terminalPid: number,
    startedAt: string,
  ): Promise<NativeSessionState> {
    const timeoutAt = Date.now() + 15 * 60_000;
    while (Date.now() < timeoutAt) {
      try {
        const state = await readNativeSessionState(sessionPath);
        if (state.attemptId === attemptId && (state.status === 'completed' || state.status === 'failed' || state.status === 'paused')) {
          return state;
        }
      } catch {
        // keep polling
      }
      try {
        const event = await readLatestNativeTerminalEvent(messagesDir, nodeId, attemptId, startedAt);
        if (event.status === 'completed' || event.status === 'failed' || event.status === 'paused') {
          return {
            mode: 'native_split_terminal',
            attemptId,
            status: event.status,
            terminalPid,
            startedAt,
            updatedAt: nowIso(),
            completedAt: nowIso(),
            result: event.result,
          };
        }
      } catch {
        // keep polling
      }
      await delay(100);
    }

    return {
      mode: 'native_split_terminal',
      attemptId,
      status: 'failed',
      terminalPid,
      startedAt: nowIso(),
      updatedAt: nowIso(),
      completedAt: nowIso(),
      result: {
        kind: 'fail',
        message: 'native split terminal timed out without reporting final state',
      },
    };
  }

  private async readResumableNativeSession(nodeDir: string): Promise<NativeSessionState | null> {
    try {
      const state = await readNativeSessionState(getNativeSessionPath(nodeDir));
      if ((state.status === 'completed' || state.status === 'failed' || state.status === 'paused') && state.sessionId) {
        return state;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async appendTimelineEntry(workspace: RunWorkspace, entry: RunTimelineEntry): Promise<void> {
    const timeline = await loadRunTimeline(workspace);
    timeline.push(entry);
    await persistRunTimeline(workspace, timeline);
  }

  private async updateTimelineEntry(
    workspace: RunWorkspace,
    attemptId: string,
    patch: Partial<Pick<RunTimelineEntry, 'status' | 'finishedAt' | 'detail' | 'outcome' | 'nextNodeId'>>,
  ): Promise<void> {
    const timeline = await loadRunTimeline(workspace);
    const target = timeline.find((entry) => entry.attemptId === attemptId);
    if (!target) {
      return;
    }
    Object.assign(target, patch);
    await persistRunTimeline(workspace, timeline);
  }
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

function buildAgentSessionSystemPrompt(
  workflow: RuntimeWorkflow,
  nodeId: string,
  nodeDir: string,
  nodeArtifactsDir: string,
  workspace: RunWorkspace,
): string {
  return [
    '你正在 FlowBraid 的长期交互 agent_session 节点中工作。',
    `workflow.id: ${workflow.id}`,
    `node.id: ${nodeId}`,
    `run.dir: ${workspace.runDir}`,
    `node.dir: ${nodeDir}`,
    `artifacts.dir: ${nodeArtifactsDir}`,
    '当任务需要用户进一步输入时，你应返回 waiting_input。',
    '当任务已经完成并可以流转下一个节点时，你应返回 completed。',
  ].join('\n');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

export async function sendWorkflow(runDir: string, message: string, options: RunnerOptions = {}): Promise<ExecutionResult> {
  const { manifest } = await loadManifest(runDir);
  const workflow = manifest.workflow as RuntimeWorkflow;
  const engine = new FlowBraidEngine(workflow, options, workflow.directory);
  return engine.send(runDir, message);
}
