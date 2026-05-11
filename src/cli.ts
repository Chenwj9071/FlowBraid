#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { loadWorkflowFile, WorkflowError } from './workflow.js';
import { loadManifest, loadRunState, loadRunTimeline, persistRunState } from './workspace.js';
import { resumeWorkflow, sendWorkflow, startWorkflow } from './engine.js';
import { diagnoseRecovery, recoverWorkflow } from './recovery.js';
import { RunInterruptedError } from './errors.js';
import { appendText, nowIso, readJson } from './utils.js';
import { stabilizeTerminalForPrompt } from './terminal.js';
import { parseArgs } from './cli-args.js';
import { buildRunnerOptionsFromFlags } from './runtime-options.js';
import {
  appendNativeNodeEvent,
  getNativeSessionPath,
  readNativeSessionState,
  updateNativeSessionState,
  writeNativeSessionState,
} from './native-session.js';
import { appendNodeRuntimeEvent, getNodeRuntimeStatePath, readNodeRuntimeState, writeNodeRuntimeState } from './node-runtime.js';
import { deriveRuntimeStateFromControlLog, getControlLogPath, writeDerivedRuntimeState } from './control-log.js';
import { acceptControlEvent } from './control-events.js';
import type {
  ControlEventKind,
  NativeSessionResult,
  NativeSessionState,
  NodeRuntimeState,
  NodeState,
  RunTimelineEntry,
} from './types.js';

function printUsage(): void {
  console.log(`FlowBraid CLI

Usage:
  flowbraid run <workflow-file> [--workspace <dir>] [--workdir <dir>] [--codex-command <cmd>] [--interactive] [--pty] [--no-interactive]
  flowbraid resume <run-dir> [--decision approve|reject|retry-current|continue-next] [--message <text>] [--codex-command <cmd>]
  flowbraid recover <run-dir> [--decision retry-current|continue-next|fail-run] [--message <text>] [--codex-command <cmd>]
  flowbraid send <run-dir> <message> [--codex-command <cmd>]
  flowbraid status <run-dir> [--json]
  flowbraid node <start|complete|fail|pause|artifact|heartbeat> --run-dir <dir> --node-id <id> [...]
  flowbraid validate <workflow-file>
  flowbraid workflow-help
  flowbraid --help

Run Modes:
  TTY 下默认自动进入交互模式，并优先使用 native split。
  --pty                强制使用单终端 PTY 交互模式
  --interactive        显式开启交互模式
  --no-interactive     强制关闭交互模式，适合脚本和 CI

Common Commands:
  flowbraid run demo.workflow.yaml
  flowbraid run demo.workflow.yaml --pty
  flowbraid run demo.workflow.yaml --no-interactive
  flowbraid resume .flowbraid-runs/<run-id>
  flowbraid recover .flowbraid-runs/<run-id> --decision retry-current
  flowbraid send .flowbraid-runs/<run-id> "more context"

Recover:
  flowbraid recover 用于主调度器异常退出、终端误关或 run 进入不一致状态后的恢复
  如果当前节点可明确继续，会自动恢复；否则进入人工恢复确认
  可手动指定 --decision retry-current|continue-next|fail-run

More Help:
  用 flowbraid workflow-help 查看简化版工作流编写说明`);
}

function printWorkflowHelp(): void {
  console.log(`FlowBraid Workflow Quick Reference

最小示例:
  id: hello-demo
  start: hello
  nodes:
    hello:
      type: shell
      command: echo hello
      next: done
    done:
      type: end
      message: finished

顶层字段:
  id            工作流唯一标识
  start         起始节点 id
  workdir       默认业务目录，供节点实际修改和验证文件
  contextDir    默认上下文目录，供节点读取 AGENTS.md 和角色约束
  nodes         节点字典，key 就是节点 id

通用节点字段:
  type          节点类型，当前支持 shell / codex / agent_session / gate / approval / end
  title         可选描述，不参与调度
  next          默认后继节点
  transitions   显式分支，常见键有 success / failure / default / approve / reject
  workdir       节点级业务目录，优先级高于 workflow 级 workdir
  contextDir    节点级上下文目录，优先级高于 workflow 级 contextDir

目录模型:
  contextDir 负责“身份和约束”
  workdir    负责“真实业务修改”
  run workspace 保存状态、日志、消息和节点产物

节点类型:
  shell
    必填: command
    适合一次性准备脚本、命令执行、环境检查

  codex
    必填: prompt
    可选: outputFile / model / reentry.mode
    推荐通过 flowbraid node complete --outcome ... 或 flowbraid node fail 显式上报结果
    reentry.mode 支持 resume / new_with_history / new

  agent_session
    必填: provider / prompt
    当前 provider 只支持 codex
    等待输入时通过 flowbraid send <run-dir> <message> 继续

  gate
    进入后暂停，适合人工检查或等待外部条件
    通过 flowbraid resume <run-dir> 继续

  approval
    人工审批节点
    必须声明 transitions.approve 和 transitions.reject
    reject 时应提供 --message 记录反馈

  end
    结束工作流，可选 message

分支规则:
  普通节点优先走 transitions.success / transitions.failure
  其次走 transitions.default
  再其次走 next
  approval 节点使用 transitions.approve / transitions.reject

运行与续跑:
  flowbraid run <workflow-file>
  flowbraid resume <run-dir>
  flowbraid recover <run-dir>
  flowbraid resume <run-dir> --decision approve
  flowbraid resume <run-dir> --decision reject --message "请补测试"
  flowbraid send <run-dir> <message>

完整说明请查看 doc/workflow-authoring.md`);
}

export function resolveNativeSplitPreference(
  flags: Record<string, string | boolean>,
  shouldInteractive: boolean,
): boolean {
  if (!shouldInteractive) {
    return false;
  }
  return flags.pty !== true;
}

function resolveCodexCommand(flags: Record<string, string | boolean>): string | undefined {
  if (flags['codex-command']) {
    return String(flags['codex-command']);
  }
  if (process.env.FLOWBRAID_CODEX_COMMAND?.trim()) {
    return process.env.FLOWBRAID_CODEX_COMMAND.trim();
  }
  return undefined;
}

function prepareConsoleForPromptOutput(): void {
  try {
    if (process.stdout.isTTY) {
      process.stdout.write('\r\n');
    }
  } catch {
    // best-effort only
  }
}

function writeStdoutLine(text: string): void {
  try {
    process.stdout.write(`${text}\r\n`);
  } catch {
    console.log(text);
  }
}

async function promptApprovalDecision(runDir: string, abortSignal?: AbortSignal): Promise<{ decision: 'approve' | 'reject'; comment?: string }> {
  prepareConsoleForPromptOutput();
  const { workspace, manifest } = await loadManifest(runDir);
  const state = await loadRunState(workspace);
  const currentNodeId = state.currentNodeId;
  if (state.status !== 'paused' || !currentNodeId) {
    throw new Error('run is not paused; approval prompt is unavailable');
  }

  const currentNode = manifest.workflow.nodes[currentNodeId];
  if (currentNode?.type !== 'approval') {
    throw new Error('current paused node is not approval');
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      const answer = await Promise.race([
        rl.question('审批结果 [approve/reject]: '),
        createAbortPromise(abortSignal, () => rl.close()),
      ]);
      const normalized = answer.trim().toLowerCase();
      if (normalized === 'approve' || normalized === 'reject') {
        if (normalized === 'reject') {
          while (true) {
            const feedback = await Promise.race([
              rl.question('请输入打回意见: '),
              createAbortPromise(abortSignal, () => rl.close()),
            ]);
            const trimmed = feedback.trim();
            if (trimmed) {
              finishPromptLine();
              return { decision: normalized, comment: trimmed };
            }
            process.stdout.write('reject requires a comment\r\n');
          }
        }
        finishPromptLine();
        return { decision: normalized };
      }
      process.stdout.write('please enter approve or reject\r\n');
    }
  } finally {
    rl.close();
  }
}

async function promptCodexInterventionDecision(
  runDir: string,
  abortSignal?: AbortSignal,
): Promise<{ decision: 'retry-current' | 'continue-next' }> {
  prepareConsoleForPromptOutput();
  const { workspace } = await loadManifest(runDir);
  const state = await loadRunState(workspace);
  if (state.status !== 'paused' || state.manualDecisionState !== 'awaiting_codex_intervention') {
    throw new Error('run is not waiting for codex intervention decision');
  }

  if (state.manualDecisionReason) {
    process.stdout.write(`${state.manualDecisionReason}\r\n`);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      const answer = await Promise.race([
        rl.question('处理动作 [retry-current/continue-next]: '),
        createAbortPromise(abortSignal, () => rl.close()),
      ]);
      const normalized = answer.trim().toLowerCase();
      if (normalized === 'retry-current' || normalized === 'continue-next') {
        finishPromptLine();
        return { decision: normalized };
      }
      process.stdout.write('please enter retry-current or continue-next\r\n');
    }
  } finally {
    rl.close();
  }
}

async function promptGateContinue(promptText: string, abortSignal?: AbortSignal): Promise<void> {
  prepareConsoleForPromptOutput();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (promptText) {
      process.stdout.write(`${promptText}\r\n`);
    }
    const answer = await Promise.race([
      rl.question('press Enter to continue, or q to quit: '),
      createAbortPromise(abortSignal, () => rl.close()),
    ]);
    if (answer.trim().toLowerCase() === 'q') {
      throw new Error('user canceled continuation');
    }
  } finally {
    rl.close();
  }
}

async function promptAgentSessionMessage(abortSignal?: AbortSignal): Promise<string> {
  prepareConsoleForPromptOutput();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await Promise.race([rl.question('agent> '), createAbortPromise(abortSignal, () => rl.close())]);
  } finally {
    rl.close();
  }
}

async function promptSendMessage(abortSignal?: AbortSignal): Promise<string> {
  prepareConsoleForPromptOutput();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await Promise.race([rl.question('message> '), createAbortPromise(abortSignal, () => rl.close())]);
  } finally {
    rl.close();
  }
}

async function runInteractiveWorkflow(
  workflow: Awaited<ReturnType<typeof loadWorkflowFile>>,
  options: {
    workspaceRoot?: string;
    defaultWorkdir?: string;
    codexCommand?: string;
    nativeSplitTerminals?: boolean;
    abortSignal?: AbortSignal;
    onRunDir?: (runDir: string) => void;
  },
): Promise<Awaited<ReturnType<typeof startWorkflow>>> {
  let result = await startWorkflow(workflow, {
    workspaceRoot: options.workspaceRoot,
    defaultWorkdir: options.defaultWorkdir,
    codexCommand: options.codexCommand,
    nativeSplitTerminals: options.nativeSplitTerminals,
    abortSignal: options.abortSignal,
    interactiveTerminal: { input: process.stdin, output: process.stdout },
    logger: writeStdoutLine,
  });
  options.onRunDir?.(result.runDir);

  while (result.status === 'paused') {
    const { workspace, manifest } = await loadManifest(result.runDir);
    const state = await loadRunState(workspace);
    const currentNodeId = state.currentNodeId;
    const currentNode = currentNodeId ? manifest.workflow.nodes[currentNodeId] : null;

    if (!currentNode) {
      throw new Error(`cannot identify current paused node: ${String(currentNodeId)}`);
    }

    if (currentNode.type === 'approval') {
      const approval = await promptApprovalDecision(result.runDir, options.abortSignal);
      await settleTerminalAfterPrompt();
      result = await resumeWorkflow(result.runDir, {
        approvalDecision: approval.decision,
        approvalComment: approval.comment,
        codexCommand: options.codexCommand,
        nativeSplitTerminals: options.nativeSplitTerminals,
        abortSignal: options.abortSignal,
        interactiveTerminal: { input: process.stdin, output: process.stdout },
        logger: writeStdoutLine,
      });
      options.onRunDir?.(result.runDir);
      continue;
    }

    if (currentNode.type === 'codex' && state.manualDecisionState === 'awaiting_codex_intervention') {
      const manualDecision = await promptCodexInterventionDecision(result.runDir, options.abortSignal);
      await settleTerminalAfterPrompt();
      result = await resumeWorkflow(result.runDir, {
        manualDecision: manualDecision.decision,
        codexCommand: options.codexCommand,
        nativeSplitTerminals: options.nativeSplitTerminals,
        abortSignal: options.abortSignal,
        interactiveTerminal: { input: process.stdin, output: process.stdout },
        logger: writeStdoutLine,
      });
      options.onRunDir?.(result.runDir);
      continue;
    }

    if (currentNode.type === 'gate') {
      await promptGateContinue(currentNode.prompt ?? '', options.abortSignal);
      await settleTerminalAfterPrompt();
      result = await resumeWorkflow(result.runDir, {
        codexCommand: options.codexCommand,
        nativeSplitTerminals: options.nativeSplitTerminals,
        abortSignal: options.abortSignal,
        interactiveTerminal: { input: process.stdin, output: process.stdout },
        logger: writeStdoutLine,
      });
      options.onRunDir?.(result.runDir);
      continue;
    }

    if (currentNode.type === 'agent_session') {
      console.log('agent_session is waiting for more input; use /exit to leave the conversation for now');
      const message = (await promptAgentSessionMessage(options.abortSignal)).trim();
      if (!message || message === '/exit') {
        console.log(`run ${result.runId} => ${result.status}`);
        console.log(`workspace: ${result.runDir}`);
        return result;
      }
      await settleTerminalAfterPrompt();
      result = await sendWorkflow(result.runDir, message, {
        codexCommand: options.codexCommand,
        nativeSplitTerminals: options.nativeSplitTerminals,
        abortSignal: options.abortSignal,
        interactiveTerminal: { input: process.stdin, output: process.stdout },
        logger: writeStdoutLine,
      });
      options.onRunDir?.(result.runDir);
      continue;
    }

    throw new Error(`interactive continuation is not supported for node type: ${currentNode.type}`);
  }

  console.log(`run ${result.runId} => ${result.status}`);
  console.log(`workspace: ${result.runDir}`);
  return result;
}

async function runRecoveredWorkflowInteractively(
  runDir: string,
  options: {
    codexCommand?: string;
    nativeSplitTerminals?: boolean;
    abortSignal?: AbortSignal;
  },
): Promise<Awaited<ReturnType<typeof recoverWorkflow>>> {
  let result = await recoverWorkflow(runDir, {
    codexCommand: options.codexCommand,
    nativeSplitTerminals: options.nativeSplitTerminals,
    abortSignal: options.abortSignal,
    logger: writeStdoutLine,
  });

  while (result.status === 'paused') {
    const { workspace, manifest } = await loadManifest(result.runDir);
    const state = await loadRunState(workspace);
    const currentNodeId = state.currentNodeId;
    const currentNode = currentNodeId ? manifest.workflow.nodes[currentNodeId] : null;

    if (!currentNode) {
      throw new Error(`cannot identify current paused node: ${String(currentNodeId)}`);
    }

    if (currentNode.type === 'approval') {
      const approval = await promptApprovalDecision(result.runDir, options.abortSignal);
      await settleTerminalAfterPrompt();
      result = await recoverWorkflow(result.runDir, {
        approvalDecision: approval.decision,
        approvalComment: approval.comment,
        codexCommand: options.codexCommand,
        nativeSplitTerminals: options.nativeSplitTerminals,
        abortSignal: options.abortSignal,
        logger: writeStdoutLine,
      });
      continue;
    }

    if (currentNode.type === 'codex' && state.manualDecisionState === 'awaiting_codex_intervention') {
      const manualDecision = await promptCodexInterventionDecision(result.runDir, options.abortSignal);
      await settleTerminalAfterPrompt();
      result = await recoverWorkflow(result.runDir, {
        manualDecision: manualDecision.decision,
        codexCommand: options.codexCommand,
        nativeSplitTerminals: options.nativeSplitTerminals,
        abortSignal: options.abortSignal,
        logger: writeStdoutLine,
      });
      continue;
    }

    if (currentNode.type === 'gate') {
      await promptGateContinue(currentNode.prompt ?? '', options.abortSignal);
      await settleTerminalAfterPrompt();
      result = await recoverWorkflow(result.runDir, {
        codexCommand: options.codexCommand,
        nativeSplitTerminals: options.nativeSplitTerminals,
        abortSignal: options.abortSignal,
        logger: writeStdoutLine,
      });
      continue;
    }

    break;
  }

  return result;
}

async function handleNodeCommand(subcommand: string | undefined, flags: Record<string, string | boolean>): Promise<number> {
  const runDir = flags['run-dir'] ? path.resolve(String(flags['run-dir'])) : undefined;
  const nodeId = flags['node-id'] ? String(flags['node-id']) : undefined;
  if (!runDir || !nodeId) {
    throw new Error('node command requires --run-dir and --node-id');
  }

  const { workspace } = await loadManifest(runDir);
  const nodeDir = path.join(workspace.nodesDir, nodeId);
  const sessionPath = getNativeSessionPath(nodeDir);
  const runtimeStatePath = getNodeRuntimeStatePath(nodeDir);
  const controlLogPath = getControlLogPath(nodeDir);
  const existingState = await readNativeSessionSafely(sessionPath);
  const existingRuntimeState = await readNodeRuntimeStateSafely(runtimeStatePath);
  const attemptId = requireNodeCommandFlag(flags, 'attempt-id', subcommand);
  const baseState = existingState ?? {
    mode: 'native_split_terminal',
    status: 'launching',
    startedAt: nowIso(),
    updatedAt: nowIso(),
  };
  const baseRuntimeState: NodeRuntimeState = existingRuntimeState ?? {
    nodeId,
    attemptId,
    status: 'launching',
    startedAt: nowIso(),
    updatedAt: nowIso(),
  };
  const resolveOperationId = (): string | undefined => (flags['operation-id'] ? String(flags['operation-id']) : undefined);

  switch (subcommand) {
    case 'start': {
      const terminalPid = flags['terminal-pid'] ? Number(String(flags['terminal-pid'])) : undefined;
      const sessionId = flags['session-id'] ? String(flags['session-id']) : baseState.sessionId;
      const nextState: NativeSessionState = {
        ...baseState,
        mode: 'native_split_terminal',
        attemptId,
        sessionId,
        status: 'running',
        terminalPid,
        startedAt: baseState.startedAt,
        updatedAt: nowIso(),
      };
      await writeNativeSessionState(sessionPath, nextState);
      await writeNodeRuntimeState(runtimeStatePath, {
        ...baseRuntimeState,
        attemptId,
        status: 'running',
        sessionId,
        terminalPid,
        updatedAt: nowIso(),
      });
      await appendNativeNodeEvent(workspace.messagesDir, {
        type: 'node.native.started',
        nodeId,
        attemptId,
        at: nowIso(),
        terminalPid,
      });
      await appendAcceptedControlEvent(controlLogPath, workspace.runId, nodeId, attemptId, 'attempt.started', 'compat-cli', {
        terminalPid,
        sessionId,
      }, resolveOperationId());
      await refreshDerivedRuntimeState(controlLogPath, runtimeStatePath, nodeId);
      await appendNodeRuntimeEvent(workspace.messagesDir, {
        type: 'node.state',
        nodeId,
        attemptId,
        status: 'running',
        sessionId,
        terminalPid,
        at: nowIso(),
      });
      return 0;
    }

    case 'complete': {
      const summary = flags.summary ? String(flags.summary) : undefined;
      const outcome = requireNodeCompleteOutcome(flags, subcommand);
      const sessionId = flags['session-id'] ? String(flags['session-id']) : baseState.sessionId;
      await updateNativeSessionState(sessionPath, (current) => ({
        ...buildNativeTerminalState(current ?? baseState, 'completed', {
          kind: 'complete',
          summary,
        }),
        attemptId,
        sessionId,
      }));
      await writeNodeRuntimeState(runtimeStatePath, {
        ...baseRuntimeState,
        attemptId,
        status: 'completed',
        outcome,
        sessionId,
        updatedAt: nowIso(),
        completedAt: nowIso(),
        summary,
      });
      await appendNativeNodeEvent(workspace.messagesDir, {
        type: 'node.native.completed',
        nodeId,
        attemptId,
        at: nowIso(),
        summary,
      });
      await appendAcceptedControlEvent(controlLogPath, workspace.runId, nodeId, attemptId, 'complete', 'compat-cli', {
        outcome,
        summary,
        sessionId,
      }, resolveOperationId());
      await refreshDerivedRuntimeState(controlLogPath, runtimeStatePath, nodeId);
      await appendNodeRuntimeEvent(workspace.messagesDir, {
        type: 'node.state',
        nodeId,
        attemptId,
        status: 'completed',
        outcome,
        sessionId,
        summary,
        at: nowIso(),
      });
      return 0;
    }

    case 'fail': {
      const message = flags.message ? String(flags.message) : undefined;
      const sessionId = flags['session-id'] ? String(flags['session-id']) : baseState.sessionId;
      if (!message) {
        throw new Error('node fail requires --message');
      }
      await updateNativeSessionState(sessionPath, (current) => ({
        ...buildNativeTerminalState(current ?? baseState, 'failed', {
          kind: 'fail',
          message,
        }),
        attemptId,
        sessionId,
      }));
      await writeNodeRuntimeState(runtimeStatePath, {
        ...baseRuntimeState,
        attemptId,
        status: 'failed',
        sessionId,
        updatedAt: nowIso(),
        completedAt: nowIso(),
        error: message,
        reason: message,
      });
      await appendNativeNodeEvent(workspace.messagesDir, {
        type: 'node.native.failed',
        nodeId,
        attemptId,
        at: nowIso(),
        message,
      });
      await appendAcceptedControlEvent(controlLogPath, workspace.runId, nodeId, attemptId, 'fail', 'compat-cli', {
        message,
        sessionId,
      }, resolveOperationId());
      await refreshDerivedRuntimeState(controlLogPath, runtimeStatePath, nodeId);
      await appendNodeRuntimeEvent(workspace.messagesDir, {
        type: 'node.state',
        nodeId,
        attemptId,
        status: 'failed',
        sessionId,
        reason: message,
        at: nowIso(),
      });
      return 0;
    }

    case 'pause': {
      const reason = flags.reason ? String(flags.reason) : undefined;
      const sessionId = flags['session-id'] ? String(flags['session-id']) : baseState.sessionId;
      if (!reason) {
        throw new Error('node pause requires --reason');
      }
      await updateNativeSessionState(sessionPath, (current) => ({
        ...buildNativeTerminalState(current ?? baseState, 'paused', {
          kind: 'pause',
          reason,
        }),
        attemptId,
        sessionId,
      }));
      await writeNodeRuntimeState(runtimeStatePath, {
        ...baseRuntimeState,
        attemptId,
        status: 'paused',
        sessionId,
        updatedAt: nowIso(),
        completedAt: nowIso(),
        reason,
      });
      await appendNativeNodeEvent(workspace.messagesDir, {
        type: 'node.native.paused',
        nodeId,
        attemptId,
        at: nowIso(),
        reason,
      });
      await appendAcceptedControlEvent(controlLogPath, workspace.runId, nodeId, attemptId, 'pause', 'compat-cli', {
        reason,
        sessionId,
      }, resolveOperationId());
      await refreshDerivedRuntimeState(controlLogPath, runtimeStatePath, nodeId);
      await appendNodeRuntimeEvent(workspace.messagesDir, {
        type: 'node.state',
        nodeId,
        attemptId,
        status: 'paused',
        sessionId,
        reason,
        at: nowIso(),
      });
      return 0;
    }

    case 'artifact': {
      const file = flags.file ? String(flags.file) : undefined;
      const sessionId = flags['session-id'] ? String(flags['session-id']) : baseState.sessionId;
      if (!file) {
        throw new Error('node artifact requires --file');
      }
      await updateNativeSessionState(sessionPath, (current) => ({
        ...(current ?? baseState),
        mode: 'native_split_terminal',
        attemptId,
        sessionId,
        updatedAt: nowIso(),
        lastArtifactPath: file,
      }));
      await writeNodeRuntimeState(runtimeStatePath, {
        ...baseRuntimeState,
        attemptId,
        status: baseRuntimeState.status,
        sessionId,
        updatedAt: nowIso(),
        lastArtifactPath: file,
      });
      await appendNativeNodeEvent(workspace.messagesDir, {
        type: 'node.native.artifact',
        nodeId,
        attemptId,
        at: nowIso(),
        file,
      });
      await appendAcceptedControlEvent(controlLogPath, workspace.runId, nodeId, attemptId, 'artifact', 'compat-cli', {
        file,
        sessionId,
      }, resolveOperationId());
      await refreshDerivedRuntimeState(controlLogPath, runtimeStatePath, nodeId);
      return 0;
    }

    case 'heartbeat': {
      const sessionId = flags['session-id'] ? String(flags['session-id']) : baseState.sessionId;
      await updateNativeSessionState(sessionPath, (current) => {
        const effectiveState = current ?? baseState;
        return {
          ...effectiveState,
          mode: 'native_split_terminal',
          attemptId,
          sessionId,
          status: effectiveState.status === 'launching' ? 'running' : effectiveState.status,
          updatedAt: nowIso(),
          lastHeartbeatAt: nowIso(),
        };
      });
      await writeNodeRuntimeState(runtimeStatePath, {
        ...baseRuntimeState,
        attemptId,
        status: baseRuntimeState.status === 'launching' ? 'running' : baseRuntimeState.status,
        sessionId,
        updatedAt: nowIso(),
      });
      await appendNativeNodeEvent(workspace.messagesDir, {
        type: 'node.native.heartbeat',
        nodeId,
        attemptId,
        at: nowIso(),
      });
      await appendAcceptedControlEvent(controlLogPath, workspace.runId, nodeId, attemptId, 'heartbeat', 'compat-cli', {
        sessionId,
      }, resolveOperationId());
      await refreshDerivedRuntimeState(controlLogPath, runtimeStatePath, nodeId);
      return 0;
    }

    default:
      throw new Error(`unsupported node subcommand: ${String(subcommand)}`);
  }
}

async function promptRecoveryDecision(
  abortSignal?: AbortSignal,
): Promise<{ decision: 'retry-current' | 'continue-next' | 'fail-run'; comment?: string }> {
  prepareConsoleForPromptOutput();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      const answer = await Promise.race([
        rl.question('恢复动作 [retry-current/continue-next/fail-run]: '),
        createAbortPromise(abortSignal, () => rl.close()),
      ]);
      const normalized = answer.trim().toLowerCase();
      if (normalized === 'retry-current') {
        finishPromptLine();
        return { decision: normalized };
      }
      if (normalized === 'continue-next' || normalized === 'fail-run') {
        while (true) {
          const comment = await Promise.race([
            rl.question('请输入恢复说明: '),
            createAbortPromise(abortSignal, () => rl.close()),
          ]);
          const trimmed = comment.trim();
          if (trimmed) {
            finishPromptLine();
            return { decision: normalized, comment: trimmed };
          }
          process.stdout.write('message is required\r\n');
        }
      }
      process.stdout.write('please enter retry-current, continue-next, or fail-run\r\n');
    }
  } finally {
    rl.close();
  }
}

function requireNodeCommandFlag(flags: Record<string, string | boolean>, name: string, subcommand?: string): string {
  const value = flags[name];
  if (value === undefined || value === null || value === '') {
    throw new Error(`node ${subcommand ?? 'command'} requires --${name}`);
  }
  return String(value);
}

function requireNodeCompleteOutcome(flags: Record<string, string | boolean>, subcommand?: string): 'success' | 'approve' | 'reject' {
  const rawOutcome = requireNodeCommandFlag(flags, 'outcome', subcommand);
  if (rawOutcome === 'success' || rawOutcome === 'approve' || rawOutcome === 'reject') {
    return rawOutcome;
  }
  throw new Error(`node ${subcommand ?? 'complete'} --outcome must be success, approve, or reject`);
}

function buildNativeTerminalState(
  baseState: NativeSessionState,
  status: NativeSessionState['status'],
  result: NativeSessionResult,
): NativeSessionState {
  const completedAt = status === 'completed' || status === 'failed' || status === 'paused' ? nowIso() : undefined;
  return {
    ...baseState,
    mode: 'native_split_terminal',
    status,
    updatedAt: nowIso(),
    completedAt,
    result,
  };
}

async function readNativeSessionSafely(sessionPath: string): Promise<NativeSessionState | null> {
  try {
    return await readNativeSessionState(sessionPath);
  } catch {
    return null;
  }
}

async function readNodeRuntimeStateSafely(filePath: string): Promise<NodeRuntimeState | null> {
  try {
    return await readNodeRuntimeState(filePath);
  } catch {
    return null;
  }
}

interface StatusSnapshot {
  runDir: string;
  runId: string;
  workflowId: string;
  runStatus: string;
  currentNodeId: string | null;
  pendingNodeId: string | null;
  currentAttemptId?: string | null;
  manualDecisionState?: string;
  manualDecisionReason?: string | null;
  reentryMode?: string;
  nodeState?: NodeState | null;
  nativeSession?: NativeSessionState | null;
  latestTimeline?: RunTimelineEntry | null;
}

async function buildStatusSnapshot(runDir: string): Promise<StatusSnapshot> {
  const resolvedRunDir = path.resolve(runDir);
  const { workspace, manifest } = await loadManifest(resolvedRunDir);
  const runState = await loadRunState(workspace);
  const timeline = await loadRunTimeline(workspace);
  const currentNodeId = runState.currentNodeId;
  const currentNode = currentNodeId ? manifest.workflow.nodes[currentNodeId] : null;
  const nodeDir = currentNodeId ? path.join(workspace.nodesDir, currentNodeId) : null;
  let nodeState: NodeState | null = null;
  let nativeSession: NativeSessionState | null = null;

  if (nodeDir) {
    try {
      nodeState = await readJson<NodeState>(path.join(nodeDir, 'status.json'));
    } catch {
      nodeState = null;
    }
    nativeSession = await readNativeSessionSafely(getNativeSessionPath(nodeDir));
  }

  return {
    runDir: resolvedRunDir,
    runId: runState.runId,
    workflowId: runState.workflowId,
    runStatus: runState.status,
    currentNodeId,
    pendingNodeId: runState.pendingNodeId,
    currentAttemptId: runState.currentAttemptId,
    manualDecisionState: runState.manualDecisionState,
    manualDecisionReason: runState.manualDecisionReason,
    reentryMode: currentNode?.type === 'codex' ? currentNode.reentry?.mode ?? 'resume' : undefined,
    nodeState,
    nativeSession,
    latestTimeline: timeline.at(-1) ?? null,
  };
}

function printStatusSnapshot(snapshot: StatusSnapshot): void {
  console.log(`runId: ${snapshot.runId}`);
  console.log(`workflowId: ${snapshot.workflowId}`);
  console.log(`status: ${snapshot.runStatus}`);
  console.log(`runDir: ${snapshot.runDir}`);
  console.log(`currentNodeId: ${snapshot.currentNodeId ?? 'null'}`);
  console.log(`pendingNodeId: ${snapshot.pendingNodeId ?? 'null'}`);
  console.log(`currentAttemptId: ${snapshot.currentAttemptId ?? 'null'}`);
  if (snapshot.manualDecisionState && snapshot.manualDecisionState !== 'idle') {
    console.log(`manualDecisionState: ${snapshot.manualDecisionState}`);
    console.log(`manualDecisionReason: ${snapshot.manualDecisionReason ?? 'null'}`);
  }
  if (snapshot.reentryMode) {
    console.log(`reentry.mode: ${snapshot.reentryMode}`);
  }
  if (snapshot.nodeState) {
    console.log(`node.status: ${snapshot.nodeState.status}`);
    console.log(`node.sessionId: ${snapshot.nodeState.sessionId ?? 'null'}`);
    if (snapshot.nodeState.detail) {
      console.log(`node.detail: ${snapshot.nodeState.detail}`);
    }
  }
  if (snapshot.nativeSession) {
    console.log(`native.status: ${snapshot.nativeSession.status}`);
    console.log(`native.sessionId: ${snapshot.nativeSession.sessionId ?? 'null'}`);
    console.log(`native.terminalPid: ${snapshot.nativeSession.terminalPid ?? 'null'}`);
  }
  if (snapshot.latestTimeline) {
    console.log(
      `timeline.latest: step=${snapshot.latestTimeline.stepIndex} node=${snapshot.latestTimeline.nodeId} attempt=${snapshot.latestTimeline.attemptId} status=${snapshot.latestTimeline.status}`,
    );
  }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h') || argv[0] === 'help') {
    printUsage();
    return 0;
  }

  const { command, rest, flags } = parseArgs(argv);
  if (!command) {
    printUsage();
    return 1;
  }

  if (command === '--help' || command === 'help') {
    printUsage();
    return 0;
  }

  try {
    if (command === 'workflow-help') {
      printWorkflowHelp();
      return 0;
    }

    if (command === 'validate') {
      const filePath = rest[0];
      if (!filePath) {
        throw new Error('validate requires a workflow file path');
      }
      await loadWorkflowFile(path.resolve(filePath));
      console.log('workflow validation passed');
      return 0;
    }

    if (command === 'status') {
      const runDir = rest[0];
      if (!runDir) {
        throw new Error('status requires a run directory path');
      }
      const snapshot = await buildStatusSnapshot(runDir);
      if (flags.json === true) {
        console.log(JSON.stringify(snapshot, null, 2));
      } else {
        printStatusSnapshot(snapshot);
      }
      return 0;
    }

    if (command === 'run') {
      const filePath = rest[0];
      if (!filePath) {
        throw new Error('run requires a workflow file path');
      }

      const workflow = await loadWorkflowFile(path.resolve(filePath));
      const shouldInteractive =
        flags.interactive === true || (flags['no-interactive'] !== true && process.stdin.isTTY && process.stdout.isTTY);
      const nativeSplitTerminals = resolveNativeSplitPreference(flags, shouldInteractive);
      const interruptContext = createInterruptContext();

      try {
        const codexCommand = resolveCodexCommand(flags);
        if (shouldInteractive) {
          const result = await runInteractiveWorkflow(workflow, {
            workspaceRoot: flags.workspace ? path.resolve(String(flags.workspace)) : undefined,
            defaultWorkdir: flags.workdir ? path.resolve(String(flags.workdir)) : undefined,
            codexCommand,
            nativeSplitTerminals,
            abortSignal: interruptContext.controller.signal,
            onRunDir: (resolvedRunDir) => {
              interruptContext.lastRunDir = resolvedRunDir;
            },
          });
          stabilizeTerminalForPrompt({ input: process.stdin, output: process.stdout });
          return result.status === 'failed' ? 1 : 0;
        }

        const result = await startWorkflow(workflow, {
          ...buildRunnerOptionsFromFlags(flags, {
            workspaceRoot: flags.workspace ? path.resolve(String(flags.workspace)) : undefined,
            defaultWorkdir: flags.workdir ? path.resolve(String(flags.workdir)) : undefined,
            codexCommand,
            nativeSplitTerminals,
            abortSignal: interruptContext.controller.signal,
            logger: writeStdoutLine,
          }),
        });
        interruptContext.lastRunDir = result.runDir;
        writeStdoutLine(`run ${result.runId} => ${result.status}`);
        writeStdoutLine(`workspace: ${result.runDir}`);
        if (result.status === 'paused') {
          writeStdoutLine(`current paused node: ${result.currentNodeId}`);
          writeStdoutLine('use flowbraid resume <run-dir> or flowbraid send <run-dir> <message> to continue');
        }
        stabilizeTerminalForPrompt({ input: process.stdin, output: process.stdout });
        return result.status === 'failed' ? 1 : 0;
      } catch (error) {
        if (error instanceof RunInterruptedError && interruptContext.lastRunDir) {
          await failRun(interruptContext.lastRunDir, 'user interrupted run');
        }
        throw error;
      } finally {
        interruptContext.dispose();
      }
    }

    if (command === 'resume') {
      const runDir = rest[0];
      if (!runDir) {
        throw new Error('resume requires a run directory path');
      }

      const resolvedRunDir = path.resolve(runDir);
      const decisionFromFlag =
        flags.decision === 'approve' || flags.decision === 'reject' ? (flags.decision as 'approve' | 'reject') : undefined;
      const manualDecisionFromFlag =
        flags.decision === 'retry-current' || flags.decision === 'continue-next'
          ? (flags.decision as 'retry-current' | 'continue-next')
          : undefined;
      const commentFromFlag = flags.message ? String(flags.message) : undefined;
      const interruptContext = createInterruptContext();
      interruptContext.lastRunDir = resolvedRunDir;

      try {
        const codexCommand = resolveCodexCommand(flags);
        let decision = decisionFromFlag;
        let manualDecision = manualDecisionFromFlag;
        let comment = commentFromFlag;
        if (!decision && !manualDecision) {
          const { workspace, manifest } = await loadManifest(resolvedRunDir);
          const state = await loadRunState(workspace);
          const currentNode = state.currentNodeId ? manifest.workflow.nodes[state.currentNodeId] : null;
          if (currentNode?.type === 'agent_session') {
            throw new Error('agent_session nodes must continue via send, not resume');
          }
          if (state.status === 'paused' && currentNode?.type === 'approval') {
            const approval = await promptApprovalDecision(resolvedRunDir, interruptContext.controller.signal);
            decision = approval.decision;
            comment = approval.comment;
          } else if (state.status === 'paused' && currentNode?.type === 'codex' && state.manualDecisionState === 'awaiting_codex_intervention') {
            const prompted = await promptCodexInterventionDecision(resolvedRunDir, interruptContext.controller.signal);
            manualDecision = prompted.decision;
          }
        }
        if (decision === 'reject' && !comment) {
          throw new Error('approval reject requires --message');
        }
        if (flags.decision && !decision && !manualDecision) {
          throw new Error('resume --decision must be approve, reject, retry-current, or continue-next');
        }

        const result = await resumeWorkflow(resolvedRunDir, {
          ...buildRunnerOptionsFromFlags(flags, {
            approvalDecision: decision,
            approvalComment: comment,
            manualDecision,
            codexCommand,
            nativeSplitTerminals: resolveNativeSplitPreference(flags, true),
            abortSignal: interruptContext.controller.signal,
            logger: writeStdoutLine,
          }),
        });
        writeStdoutLine(`run ${result.runId} => ${result.status}`);
        writeStdoutLine(`workspace: ${result.runDir}`);
        stabilizeTerminalForPrompt({ input: process.stdin, output: process.stdout });
        return result.status === 'failed' ? 1 : 0;
      } catch (error) {
        if (error instanceof RunInterruptedError) {
          await failRun(resolvedRunDir, 'user interrupted run');
        }
        throw error;
      } finally {
        interruptContext.dispose();
      }
    }

    if (command === 'recover') {
      const runDir = rest[0];
      if (!runDir) {
        throw new Error('recover requires a run directory path');
      }

      const resolvedRunDir = path.resolve(runDir);
      const interruptContext = createInterruptContext();
      interruptContext.lastRunDir = resolvedRunDir;
      let decision =
        flags.decision === 'retry-current' || flags.decision === 'continue-next' || flags.decision === 'fail-run'
          ? (flags.decision as 'retry-current' | 'continue-next' | 'fail-run')
          : undefined;
      let comment = flags.message ? String(flags.message) : undefined;
      let approvalDecision =
        flags.decision === 'approve' || flags.decision === 'reject' ? (flags.decision as 'approve' | 'reject') : undefined;

      try {
        const codexCommand = resolveCodexCommand(flags);
        const nativeSplitTerminals = resolveNativeSplitPreference(flags, true);
        const diagnosis = await diagnoseRecovery(resolvedRunDir);

        if (
          !decision &&
          !approvalDecision &&
          diagnosis.kind === 'resume_paused' &&
          process.stdin.isTTY &&
          process.stdout.isTTY
        ) {
          const result = await runRecoveredWorkflowInteractively(resolvedRunDir, {
            codexCommand,
            nativeSplitTerminals,
            abortSignal: interruptContext.controller.signal,
          });
          writeStdoutLine(`run ${result.runId} => ${result.status}`);
          writeStdoutLine(`workspace: ${result.runDir}`);
          if (result.status === 'paused') {
            writeStdoutLine(`current paused node: ${result.currentNodeId}`);
          }
          stabilizeTerminalForPrompt({ input: process.stdin, output: process.stdout });
          return result.status === 'failed' ? 1 : 0;
        }

        if ((decision === 'continue-next' || decision === 'fail-run') && !comment) {
          throw new Error(`${decision} requires --message`);
        }

        if (!decision && !approvalDecision && process.stdin.isTTY && process.stdout.isTTY) {
          if (!decision && !approvalDecision) {
            const prompted = await promptRecoveryDecision(interruptContext.controller.signal);
            decision = prompted.decision;
            comment = prompted.comment;
          }
        }

        const result = await recoverWorkflow(resolvedRunDir, {
          ...buildRunnerOptionsFromFlags(flags, {
            approvalDecision,
            approvalComment: comment,
            codexCommand,
            nativeSplitTerminals,
            abortSignal: interruptContext.controller.signal,
            logger: writeStdoutLine,
          }),
          decision,
          comment,
        });
        writeStdoutLine(`run ${result.runId} => ${result.status}`);
        writeStdoutLine(`workspace: ${result.runDir}`);
        if (result.status === 'paused') {
          writeStdoutLine(`current paused node: ${result.currentNodeId}`);
        }
        stabilizeTerminalForPrompt({ input: process.stdin, output: process.stdout });
        return result.status === 'failed' ? 1 : 0;
      } finally {
        interruptContext.dispose();
      }
    }

    if (command === 'send') {
      const runDir = rest[0];
      if (!runDir) {
        throw new Error('send requires a run directory path');
      }
      const resolvedRunDir = path.resolve(runDir);
      const interruptContext = createInterruptContext();
      interruptContext.lastRunDir = resolvedRunDir;

      try {
        const codexCommand = resolveCodexCommand(flags);
        let message = rest.slice(1).join(' ').trim();
        if (!message) {
          if (!process.stdin.isTTY || !process.stdout.isTTY) {
            throw new Error('send requires a message argument');
          }
          message = (await promptSendMessage(interruptContext.controller.signal)).trim();
        }
        if (!message) {
          throw new Error('send message cannot be empty');
        }

        const result = await sendWorkflow(resolvedRunDir, message, {
          ...buildRunnerOptionsFromFlags(flags, {
            codexCommand,
            nativeSplitTerminals: resolveNativeSplitPreference(flags, true),
            abortSignal: interruptContext.controller.signal,
            interactiveTerminal: { input: process.stdin, output: process.stdout },
            logger: writeStdoutLine,
          }),
        });
        writeStdoutLine(`run ${result.runId} => ${result.status}`);
        writeStdoutLine(`workspace: ${result.runDir}`);
        if (result.status === 'paused') {
          writeStdoutLine(`current paused node: ${result.currentNodeId}`);
        }
        stabilizeTerminalForPrompt({ input: process.stdin, output: process.stdout });
        return result.status === 'failed' ? 1 : 0;
      } catch (error) {
        if (error instanceof RunInterruptedError) {
          await failRun(resolvedRunDir, 'user interrupted run');
        }
        throw error;
      } finally {
        interruptContext.dispose();
      }
    }

    if (command === 'node') {
      return handleNodeCommand(rest[0], flags);
    }

    printUsage();
    return 1;
  } catch (error) {
    if (error instanceof WorkflowError || error instanceof Error) {
      console.error(error.message);
      return 1;
    }
    console.error(String(error));
    return 1;
  }
}

export function isCliDirectExecution(options: {
  entryScript?: string;
  moduleUrl: string;
  realPathResolver?: (candidate: string) => string;
}): boolean {
  const { entryScript, moduleUrl, realPathResolver = defaultRealPathResolver } = options;
  if (!entryScript) {
    return false;
  }

  try {
    const resolvedEntry = realPathResolver(path.resolve(entryScript));
    return pathToFileURL(resolvedEntry).href === moduleUrl;
  } catch {
    return false;
  }
}

function createInterruptContext(): {
  controller: AbortController;
  dispose: () => void;
  lastRunDir?: string;
} {
  const controller = new AbortController();
  let count = 0;
  const handleSigint = (): void => {
    count += 1;
    if (count === 1) {
      console.error('received Ctrl+C, stopping current run...');
      controller.abort(new RunInterruptedError());
      return;
    }
    process.exit(130);
  };
  process.on('SIGINT', handleSigint);
  return {
    controller,
    dispose: () => process.removeListener('SIGINT', handleSigint),
  };
}

function createAbortPromise(abortSignal: AbortSignal | undefined, cleanup?: () => void): Promise<never> {
  return new Promise<never>((_, reject) => {
    if (!abortSignal) {
      return;
    }

    const handleAbort = (): void => {
      cleanup?.();
      reject(new RunInterruptedError());
    };

    if (abortSignal.aborted) {
      handleAbort();
      return;
    }

    abortSignal.addEventListener('abort', handleAbort, { once: true });
  });
}

async function settleTerminalAfterPrompt(): Promise<void> {
  try {
    if (process.stdout.isTTY) {
      process.stdout.write('\r\n');
    }
  } catch {
    // Ignore best-effort line separation failures.
  }
  await new Promise((resolve) => setImmediate(resolve));
}

function finishPromptLine(): void {
  try {
    process.stdout.write('\r\n');
  } catch {
    // Ignore best-effort line separation failures.
  }
}

async function failRun(runDir: string, reason: string): Promise<void> {
  const { workspace } = await loadManifest(runDir);
  const state = await loadRunState(workspace);
  if (state.status === 'completed' || state.status === 'failed') {
    return;
  }
  state.status = 'failed';
  state.failedReason = reason;
  state.finishedAt = nowIso();
  await persistRunState(workspace, state);
  await appendText(
    path.join(workspace.messagesDir, 'events.jsonl'),
    `${JSON.stringify({ type: 'run.failed', at: nowIso(), runId: state.runId, reason })}\n`,
  );
}

function defaultRealPathResolver(candidate: string): string {
  try {
    return realpathSync(candidate);
  } catch {
    return candidate;
  }
}

const entryScript = process.argv[1];
const isDirectExecution = isCliDirectExecution({
  entryScript,
  moduleUrl: import.meta.url,
});

if (isDirectExecution) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}

async function appendAcceptedControlEvent(
  controlLogPath: string,
  runId: string,
  nodeId: string,
  attemptId: string,
  kind: ControlEventKind,
  source: 'compat-cli' | 'ipc' | 'fallback-outbox' | 'scheduler' | 'recovery-synthesized',
  payload?: Record<string, unknown>,
  operationId?: string,
): Promise<void> {
  await acceptControlEvent({
    controlLogPath,
    runId,
    nodeId,
    attemptId,
    kind,
    source,
    payload,
    operationId,
  });
}

async function refreshDerivedRuntimeState(controlLogPath: string, runtimeStatePath: string, nodeId: string): Promise<void> {
  const derived = await deriveRuntimeStateFromControlLog(controlLogPath, nodeId);
  await writeDerivedRuntimeState(runtimeStatePath, derived);
}
