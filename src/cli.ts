#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { loadWorkflowFile, WorkflowError } from './workflow.js';
import { loadManifest, loadRunState, loadRunTimeline, persistRunState } from './workspace.js';
import { resumeWorkflow, sendWorkflow, startWorkflow } from './engine.js';
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
import type { NativeSessionResult, NativeSessionState, NodeRuntimeState, NodeState, RunTimelineEntry } from './types.js';

function printUsage(): void {
  console.log(`FlowBraid CLI

Usage:
  flowbraid run <workflow-file> [--workspace <dir>] [--workdir <dir>] [--codex-command <cmd>] [--interactive] [--pty]
  flowbraid resume <run-dir> [--decision approve|reject] [--message <text>] [--codex-command <cmd>]
  flowbraid send <run-dir> <message> [--codex-command <cmd>]
  flowbraid status <run-dir> [--json]
  flowbraid node <start|complete|fail|pause|artifact|heartbeat> --run-dir <dir> --node-id <id> [...]
  flowbraid validate <workflow-file>`);
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

async function promptApprovalDecision(runDir: string, abortSignal?: AbortSignal): Promise<{ decision: 'approve' | 'reject'; comment?: string }> {
  stabilizeTerminalForPrompt({ input: process.stdin, output: process.stdout });
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
            console.log('reject 时必须提供打回意见');
          }
        }
        finishPromptLine();
        return { decision: normalized };
      }
      console.log('请输入 approve 或 reject');
    }
  } finally {
    rl.close();
  }
}

async function promptGateContinue(promptText: string, abortSignal?: AbortSignal): Promise<void> {
  stabilizeTerminalForPrompt({ input: process.stdin, output: process.stdout });
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (promptText) {
      console.log(promptText);
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
  stabilizeTerminalForPrompt({ input: process.stdin, output: process.stdout });
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await Promise.race([rl.question('agent> '), createAbortPromise(abortSignal, () => rl.close())]);
  } finally {
    rl.close();
  }
}

async function promptSendMessage(abortSignal?: AbortSignal): Promise<string> {
  stabilizeTerminalForPrompt({ input: process.stdin, output: process.stdout });
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
    logger: (line) => console.log(line),
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
        logger: (line) => console.log(line),
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
        logger: (line) => console.log(line),
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
        logger: (line) => console.log(line),
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
  const existingState = await readNativeSessionSafely(sessionPath);
  const existingRuntimeState = await readNodeRuntimeStateSafely(runtimeStatePath);
  const baseState = existingState ?? {
    mode: 'native_split_terminal',
    status: 'launching',
    attemptId: flags['attempt-id'] ? String(flags['attempt-id']) : undefined,
    startedAt: nowIso(),
    updatedAt: nowIso(),
  };
  const baseRuntimeState: NodeRuntimeState = existingRuntimeState ?? {
    nodeId,
    attemptId: flags['attempt-id'] ? String(flags['attempt-id']) : undefined,
    status: 'launching',
    startedAt: nowIso(),
    updatedAt: nowIso(),
  };

  switch (subcommand) {
    case 'start': {
      const terminalPid = flags['terminal-pid'] ? Number(String(flags['terminal-pid'])) : undefined;
      const attemptId = flags['attempt-id'] ? String(flags['attempt-id']) : baseState.attemptId;
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
      const outcome = flags.outcome ? String(flags.outcome) : undefined;
      const attemptId = flags['attempt-id'] ? String(flags['attempt-id']) : baseState.attemptId;
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
      const attemptId = flags['attempt-id'] ? String(flags['attempt-id']) : baseState.attemptId;
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
      const attemptId = flags['attempt-id'] ? String(flags['attempt-id']) : baseState.attemptId;
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
      const attemptId = flags['attempt-id'] ? String(flags['attempt-id']) : baseState.attemptId;
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
      return 0;
    }

    case 'heartbeat': {
      const attemptId = flags['attempt-id'] ? String(flags['attempt-id']) : baseState.attemptId;
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
      return 0;
    }

    default:
      throw new Error(`unsupported node subcommand: ${String(subcommand)}`);
  }
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
  const { command, rest, flags } = parseArgs(argv);
  if (!command) {
    printUsage();
    return 1;
  }

  try {
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
            logger: (line) => console.log(line),
          }),
        });
        interruptContext.lastRunDir = result.runDir;
        console.log(`run ${result.runId} => ${result.status}`);
        console.log(`workspace: ${result.runDir}`);
        if (result.status === 'paused') {
          console.log(`current paused node: ${result.currentNodeId}`);
          console.log('use flowbraid resume <run-dir> or flowbraid send <run-dir> <message> to continue');
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
      const commentFromFlag = flags.message ? String(flags.message) : undefined;
      const interruptContext = createInterruptContext();
      interruptContext.lastRunDir = resolvedRunDir;

      try {
        const codexCommand = resolveCodexCommand(flags);
        let decision = decisionFromFlag;
        let comment = commentFromFlag;
        if (!decision) {
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
          }
        }
        if (decision === 'reject' && !comment) {
          throw new Error('approval reject requires --message');
        }

        const result = await resumeWorkflow(resolvedRunDir, {
          ...buildRunnerOptionsFromFlags(flags, {
            approvalDecision: decision,
            approvalComment: comment,
            codexCommand,
            nativeSplitTerminals: resolveNativeSplitPreference(flags, true),
            abortSignal: interruptContext.controller.signal,
            logger: (line) => console.log(line),
          }),
        });
        console.log(`run ${result.runId} => ${result.status}`);
        console.log(`workspace: ${result.runDir}`);
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
            logger: (line) => console.log(line),
          }),
        });
        console.log(`run ${result.runId} => ${result.status}`);
        console.log(`workspace: ${result.runDir}`);
        if (result.status === 'paused') {
          console.log(`current paused node: ${result.currentNodeId}`);
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
    process.stdout.write('\r\n');
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

const entryScript = process.argv[1];
const isDirectExecution = !!entryScript && import.meta.url === pathToFileURL(path.resolve(entryScript)).href;

if (isDirectExecution) {
  main().then((code) => {
    process.exit(code);
  });
}
