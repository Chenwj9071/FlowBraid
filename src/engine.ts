import path from 'node:path';
import { mkdir, readFile, stat } from 'node:fs/promises';
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
  NodeRuntimeState,
  RunTimelineEntry,
} from './types.js';
import { resolveApprovalNext, resolveNodeNext, resolveNodeTransition } from './workflow.js';
import { RunInterruptedError, isAbortSignalTriggered } from './errors.js';
import { appendAgentSessionMessage, getAgentSessionPaths, readAgentSessionMessages, readAgentSessionState, writeAgentSessionState } from './agent-session.js';
import { runCodexSessionTurn } from './session-providers/codex.js';
import { createExternalTerminalLauncher } from './terminal-launchers/index.js';
import { buildCodexPrompt } from './codex-prompt.js';
import {
  appendNativeNodeEvent,
  getNativeSessionPath,
  readLatestCodexSessionIdAfter,
  readLatestNativeTerminalEvent,
  readNativeSessionState,
  writeNativeSessionState,
} from './native-session.js';
import { getNodeRuntimeStatePath, readNodeRuntimeState } from './node-runtime.js';

type NodeOutcome = 'success' | 'failure' | 'paused';
type RuntimeWorkflow = WorkflowDefinition & WorkflowSourceMeta;
type CodexReentryMode = 'resume' | 'new_with_history' | 'new';

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
      throw new Error('杩愯鐘舵€佷负 paused锛屼絾 pendingNodeId 涓虹┖锛屾棤娉?resume');
    }
    if (currentNode?.type === 'approval' && !this.options.approvalDecision) {
      throw new Error('approval 鑺傜偣闇€瑕侀€氳繃 --decision approve|reject 鎸囧畾浜哄伐纭缁撴灉');
    }
    if (currentNode?.type === 'approval' && this.options.approvalDecision === 'reject' && !this.options.approvalComment) {
      throw new Error('approval 节点 reject 时必须提供打回意见');
    }
    if (currentNode?.type === 'agent_session') {
      throw new Error('agent_session 鑺傜偣璇蜂娇鐢?send 缁х画瀵硅瘽锛岃€屼笉鏄?resume');
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
      throw new Error('褰撳墠 run 涓嶆槸绛夊緟杈撳叆鐘舵€侊紝鏃犳硶 send');
    }

    const currentNode = manifest.workflow.nodes[state.currentNodeId];
    if (currentNode?.type !== 'agent_session') {
      throw new Error(`褰撳墠鏆傚仠鑺傜偣涓嶆槸 agent_session锛岃€屾槸 ${currentNode?.type ?? 'unknown'}`);
    }

    const nodeDir = path.join(workspace.nodesDir, state.currentNodeId);
    const { inboxPath, sessionStatePath } = getAgentSessionPaths(nodeDir);
    const sessionState = await readAgentSessionState(sessionStatePath);
    if (sessionState.status !== 'waiting_input') {
      throw new Error(`agent_session 褰撳墠鐘舵€佷笉鏄?waiting_input锛岃€屾槸 ${sessionState.status}`);
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
        state.failedReason = `瓒呰繃鏈€澶ф楠ゆ暟 ${maxSteps}`;
        await persistRunState(workspace, state);
        return this.finalize(workspace, state);
      }

      const node = this.workflow.nodes[currentNodeId];
      if (!node) {
        state.status = 'failed';
        state.failedReason = `鎵句笉鍒拌妭鐐?${currentNodeId}`;
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
        sessionId: undefined,
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
            detail = `shell 閫€鍑虹爜 ${exitCode ?? 'null'}`;
          }
          nextNodeId = resolveNodeNext(node, outcome === 'failure' ? 'failure' : 'success');
        } else if (node.type === 'codex') {
          if (this.options.nativeSplitTerminals) {
            const execution = await this.runNativeSplitCodexNode(node, currentNodeId, attemptId, workspace, nodeDir, nodeArtifactsDir);
            exitCode = execution.exitCode;
            signal = execution.signal;
            outcome = execution.outcome;
            detail = execution.detail;
            nextNodeId = execution.nextNodeId ?? resolveNodeNext(node, outcome === 'failure' ? 'failure' : 'success');
          } else {
            const execution = await this.runCodexNode(node, currentNodeId, workspace, nodeDir, nodeArtifactsDir, nodeLogPath, state);
            exitCode = execution.exitCode;
            signal = execution.signal;
            if ((exitCode ?? 1) !== 0) {
              outcome = 'failure';
              detail = `codex 閫€鍑虹爜 ${exitCode ?? 'null'}`;
            } else {
              const runtimeState = await this.readCurrentNodeRuntimeState(nodeDir, attemptId);
              if (runtimeState && (runtimeState.outcome || runtimeState.status !== 'running')) {
                this.options.logger?.(
                  `[runtime] node ${currentNodeId} status=${runtimeState.status} outcome=${runtimeState.outcome ?? 'null'} attempt=${attemptId}`,
                );
                if (runtimeState.status === 'completed') {
                  outcome = runtimeState.outcome === 'reject' || runtimeState.outcome === 'failure' ? 'failure' : 'success';
                  detail = runtimeState.summary ?? `node completed with outcome ${runtimeState.outcome ?? 'success'}`;
                  nextNodeId = this.resolveNodeNextFromRuntime(node, runtimeState);
                } else if (runtimeState.status === 'paused' || runtimeState.status === 'waiting_input') {
                  outcome = 'paused';
                  detail = runtimeState.reason ?? 'node paused';
                  nextNodeId = this.resolveNodeNextFromRuntime(node, runtimeState);
                } else if (runtimeState.status === 'failed' || runtimeState.status === 'timed_out' || runtimeState.status === 'canceled') {
                  outcome = 'failure';
                  detail = runtimeState.reason ?? runtimeState.error ?? `node ended with status ${runtimeState.status}`;
                  nextNodeId = this.resolveNodeNextFromRuntime(node, runtimeState);
                }
              } else if (node.mode === 'review') {
                const reviewResult = await readReviewVerdict(
                  path.join(nodeArtifactsDir, node.outputFile ?? 'codex-last-message.md'),
                  nodeState.startedAt,
                );
                this.options.logger?.(
                  `[review] node ${currentNodeId} report=${reviewResult.filePath} updatedAt=${reviewResult.updatedAt ?? 'missing'} verdict=${reviewResult.verdict ?? 'null'} stale=${reviewResult.stale}`,
                );
                if (reviewResult.verdict === 'reject') {
                  outcome = 'failure';
                  detail = 'review verdict=reject';
                } else if (reviewResult.verdict === 'approve') {
                  detail = 'review verdict=approve';
                } else if (reviewResult.stale) {
                  outcome = 'failure';
                  detail = 'codex review completed, but the review report was not updated in this attempt';
                } else {
                  outcome = 'failure';
                  detail = 'codex review 完成，但未声明 verdict';
                }
              } else {
                detail = `codex ${node.mode ?? 'task'} 瀹屾垚`;
              }
            }
            nextNodeId ??= resolveNodeNext(node, outcome === 'failure' ? 'failure' : 'success');
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
          detail = node.prompt ?? '绛夊緟浜哄伐纭';
          nextNodeId = resolveNodeNext(node, 'default');
        } else if (node.type === 'approval') {
          if (!approvalDecision) {
            outcome = 'paused';
            detail = node.prompt ?? '绛夊緟浜哄伐纭';
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
          detail = node.message ?? 'workflow 缁撴潫';
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
      if (node.type === 'codex' && this.options.nativeSplitTerminals) {
        try {
          const nativeState = await readNativeSessionState(getNativeSessionPath(nodeDir));
          nodeState.sessionId = nativeState.sessionId;
        } catch {
          // keep node status without session id if unavailable
        }
      }
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
  ): Promise<{ exitCode: number | null; signal: string | null; outcome: 'success' | 'failure' | 'paused'; detail: string; nextNodeId?: string | null }> {
    const dirs = this.resolveNodeDirectories(node);
    const launcher = this.options.externalTerminalLauncher ?? createExternalTerminalLauncher();
    const sessionPath = getNativeSessionPath(nodeDir);
    const previousSession = await this.readResumableNativeSession(nodeDir);
    const reentryMode = this.resolveCodexReentryMode(node, previousSession);
    const prompt = buildCodexPrompt(this.workflow, nodeId, attemptId, node, nodeDir, nodeArtifactsDir, workspace, dirs, {
      protocolMode: 'native-split',
      resumeSession: reentryMode === 'resume',
      reentryMode,
      includeReentryHistory: reentryMode !== 'new',
    });
    const invocation = reentryMode === 'resume'
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
      sessionId: previousSession?.sessionId,
    });
    this.options.logger?.(
      reentryMode === 'resume'
        ? `[native] launch ${nodeId} via resume session ${previousSession?.sessionId}`
        : reentryMode === 'new_with_history'
          ? `[native] launch ${nodeId} via new codex session with history`
          : `[native] launch ${nodeId} via new codex session`,
    );

    const launched = await launcher.launch({
      title: `FlowBraid native ${nodeId} [${attemptId}]`,
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
    const activeSessionIdPromise = this.waitForCodexSessionId(dirs.workdir, startedAt, previousSession?.sessionId);
    void activeSessionIdPromise.then(async (sessionId) => {
      if (!sessionId) {
        return;
      }
      try {
        await writeNativeSessionState(sessionPath, {
          ...(await readNativeSessionState(sessionPath)),
          sessionId,
          terminalPid: launched.terminalPid,
          updatedAt: nowIso(),
        });
        const nodeStatusPath = path.join(nodeDir, 'status.json');
        const currentNodeState = JSON.parse(await readFile(nodeStatusPath, 'utf8')) as NodeState;
        await writeJson(nodeStatusPath, {
          ...currentNodeState,
          sessionId,
        });
      } catch {
        // best-effort background sync
      }
    });
    const terminalState = await this.waitForNativeSession(sessionPath, workspace.messagesDir, nodeId, attemptId, launched.terminalPid, startedAt);
    const activeSessionId = await this.waitForOptionalSessionId(activeSessionIdPromise);
    const finalState: NativeSessionState = {
      ...terminalState,
      attemptId,
      sessionId: terminalState.sessionId ?? activeSessionId ?? previousSession?.sessionId,
      terminalPid: terminalState.terminalPid ?? launched.terminalPid,
      updatedAt: nowIso(),
    };
    await writeNativeSessionState(sessionPath, finalState);
    try {
      const nodeStatusPath = path.join(nodeDir, 'status.json');
      const currentNodeState = JSON.parse(await readFile(nodeStatusPath, 'utf8')) as NodeState;
      await writeJson(nodeStatusPath, {
        ...currentNodeState,
        sessionId: finalState.sessionId,
      });
    } catch {
      // best-effort sync for status snapshot
    }
    await appendNativeNodeEvent(workspace.messagesDir, {
      type: 'terminal.close_requested',
      nodeId,
      attemptId,
      terminalPid: launched.terminalPid,
      at: nowIso(),
    });
    const closeGraceMs = this.options.terminalCloseGraceMs ?? 750;
    const closeTimeoutMs = this.options.terminalCloseTimeoutMs ?? 5000;
    this.options.logger?.(`[native] ${nodeId} reported ${finalState.status}, waiting ${closeGraceMs}ms before terminal close`);
    await delay(closeGraceMs);

    try {
      this.options.logger?.(
        `[native] ${nodeId} terminal close requested for pid ${launched.terminalPid} timeout=${closeTimeoutMs}ms`,
      );
      const closeAbort = new AbortController();
      const closePromise = launcher.close(launched.terminalPid, {
        timeoutMs: closeTimeoutMs,
        title: `FlowBraid native ${nodeId} [${attemptId}]`,
        signal: closeAbort.signal,
      } as unknown as { timeoutMs?: number; title?: string });
      await Promise.race([
        closePromise,
        delay(closeTimeoutMs).then(() => {
          closeAbort.abort();
          throw new Error(`terminal close timed out after ${closeTimeoutMs}ms`);
        }),
      ]);
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
    this.options.logger?.(`[native] ${nodeId} terminal close settled ${launched.terminalPid}`);

    if (finalState.status === 'paused') {
      const runtimeState = await this.readCurrentNodeRuntimeState(nodeDir, attemptId);
      return {
        exitCode: 0,
        signal: null,
        outcome: 'paused',
        detail: finalState.result?.reason ?? 'native codex paused',
        nextNodeId: runtimeState ? this.resolveNodeNextFromRuntime(node, runtimeState) : undefined,
      };
    }

    if (finalState.status !== 'completed') {
      const runtimeState = await this.readCurrentNodeRuntimeState(nodeDir, attemptId);
      return {
        exitCode: 1,
        signal: null,
        outcome: 'failure',
        detail: finalState.result?.message ?? finalState.result?.reason ?? 'native codex failed',
        nextNodeId: runtimeState ? this.resolveNodeNextFromRuntime(node, runtimeState) : undefined,
      };
    }

    const runtimeState = await this.readCurrentNodeRuntimeState(nodeDir, attemptId);
    if (runtimeState && (runtimeState.outcome || runtimeState.status !== 'running')) {
      this.options.logger?.(
        `[runtime] node ${nodeId} status=${runtimeState.status} outcome=${runtimeState.outcome ?? 'null'} attempt=${attemptId}`,
      );
      if (runtimeState.status === 'completed') {
        return {
          exitCode: 0,
          signal: null,
          outcome: runtimeState.outcome === 'reject' || runtimeState.outcome === 'failure' ? 'failure' : 'success',
          detail: runtimeState.summary ?? `node completed with outcome ${runtimeState.outcome ?? 'success'}`,
          nextNodeId: this.resolveNodeNextFromRuntime(node, runtimeState),
        };
      }
      if (runtimeState.status === 'paused' || runtimeState.status === 'waiting_input') {
        return {
          exitCode: 0,
          signal: null,
          outcome: 'paused',
          detail: runtimeState.reason ?? 'node paused',
          nextNodeId: this.resolveNodeNextFromRuntime(node, runtimeState),
        };
      }
      if (runtimeState.status === 'failed' || runtimeState.status === 'timed_out' || runtimeState.status === 'canceled') {
        return {
          exitCode: 1,
          signal: null,
          outcome: 'failure',
          detail: runtimeState.reason ?? runtimeState.error ?? `node ended with status ${runtimeState.status}`,
          nextNodeId: this.resolveNodeNextFromRuntime(node, runtimeState),
        };
      }
    }

    if (node.mode === 'review') {
      const reviewResult = await readReviewVerdict(
        path.join(nodeArtifactsDir, node.outputFile ?? 'codex-last-message.md'),
        startedAt,
      );
      this.options.logger?.(
        `[review] node ${nodeId} report=${reviewResult.filePath} updatedAt=${reviewResult.updatedAt ?? 'missing'} verdict=${reviewResult.verdict ?? 'null'} stale=${reviewResult.stale}`,
      );
      if (reviewResult.verdict === 'reject') {
        return {
          exitCode: 0,
          signal: null,
          outcome: 'failure',
          detail: 'review verdict=reject',
        };
      }
      if (reviewResult.verdict === 'approve') {
        return {
          exitCode: 0,
          signal: null,
          outcome: 'success',
          detail: 'review verdict=approve',
        };
      }
      if (reviewResult.stale) {
        return {
          exitCode: 1,
          signal: null,
          outcome: 'failure',
          detail: 'native codex review completed, but the review report was not updated in this attempt',
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
      detail: reentryMode === 'resume' ? 'codex resumed and completed via native split terminal' : 'codex exec completed via native split terminal',
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

  private resolveCodexReentryMode(node: CodexNodeDefinition, previousSession: NativeSessionState | null): CodexReentryMode {
    const configured = node.reentry?.mode ?? 'resume';
    if (configured === 'resume') {
      return previousSession?.sessionId ? 'resume' : 'new';
    }
    return configured;
  }

  private async readCurrentNodeRuntimeState(nodeDir: string, attemptId: string): Promise<NodeRuntimeState | null> {
    try {
      const state = await readNodeRuntimeState(getNodeRuntimeStatePath(nodeDir));
      if (state.attemptId === attemptId) {
        return state;
      }
      if (!state.attemptId && state.status === 'completed' && state.outcome) {
        return { ...state, attemptId };
      }
      return null;
    } catch {
      return null;
    }
  }

  private resolveNodeNextFromRuntime(node: CodexNodeDefinition, runtimeState: NodeRuntimeState): string | null {
    const keys: string[] = [];
    if (runtimeState.outcome) {
      keys.push(`${runtimeState.status}.${runtimeState.outcome}`, runtimeState.outcome);
    }
    keys.push(runtimeState.status);
    if (runtimeState.status === 'completed') {
      if (runtimeState.outcome === 'reject' || runtimeState.outcome === 'failure') {
        keys.push('failure');
      } else {
        keys.push('success');
      }
    } else if (runtimeState.status === 'failed') {
      keys.push('failure');
    }
    return resolveNodeTransition(node, keys);
  }

  private async waitForCodexSessionId(workdir: string, notBefore: string, previousSessionId?: string): Promise<string | null> {
    const timeoutAt = Date.now() + 15_000;
    while (Date.now() < timeoutAt) {
      const sessionId = await readLatestCodexSessionIdAfter(workdir, notBefore, previousSessionId);
      if (sessionId) {
        return sessionId;
      }
      await delay(200);
    }
    return previousSessionId ?? null;
  }

  private async waitForOptionalSessionId(sessionIdPromise: Promise<string | null>): Promise<string | null> {
    return Promise.race([
      sessionIdPromise,
      delay(50).then(() => null),
    ]);
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

export async function readReviewVerdict(
  filePath: string,
  notBefore?: string,
): Promise<{ filePath: string; verdict: 'approve' | 'reject' | null; updatedAt?: string; stale: boolean }> {
  try {
    const fileStat = await stat(filePath);
    const updatedAt = new Date(fileStat.mtimeMs).toISOString();
    if (notBefore && fileStat.mtimeMs < Date.parse(notBefore)) {
      return {
        filePath,
        verdict: null,
        updatedAt,
        stale: true,
      };
    }

    const content = await readFile(filePath, 'utf8');
    const matches = [...content.matchAll(/verdict\s*[:=]\s*(approve|reject)/giu)];
    const matched = matches.at(-1);
    if (!matched) {
      return {
        filePath,
        verdict: null,
        updatedAt,
        stale: false,
      };
    }
    return {
      filePath,
      verdict: matched[1].toLowerCase() as 'approve' | 'reject',
      updatedAt,
      stale: false,
    };
  } catch {
    return {
      filePath,
      verdict: null,
      stale: false,
    };
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
