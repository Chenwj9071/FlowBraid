#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { loadWorkflowFile, WorkflowError } from './workflow.js';
import { loadManifest, loadRunState, persistRunState } from './workspace.js';
import { resumeWorkflow, sendWorkflow, startWorkflow } from './engine.js';
import { RunInterruptedError } from './errors.js';
import { appendText, nowIso } from './utils.js';
import { resetTerminalForPrompt } from './terminal.js';
import { runInternalCodexNode } from './internal-codex-node.js';
import { parseArgs } from './cli-args.js';
import { buildRunnerOptionsFromFlags } from './runtime-options.js';
import {
  appendNativeNodeEvent,
  getNativeSessionPath,
  readNativeSessionState,
  updateNativeSessionState,
  writeNativeSessionState,
} from './native-session.js';
import type { NativeSessionResult, NativeSessionState } from './types.js';

function printUsage(): void {
  console.log(`FlowBraid CLI

Usage:
  flowbraid run <workflow-file> [--workspace <dir>] [--workdir <dir>] [--codex-command <cmd>] [--interactive]
  flowbraid resume <run-dir> [--decision approve|reject] [--message <text>] [--codex-command <cmd>]
  flowbraid send <run-dir> <message> [--codex-command <cmd>]
  flowbraid node <start|complete|fail|pause|artifact|heartbeat> --run-dir <dir> --node-id <id> [...]
  flowbraid validate <workflow-file>`);
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

async function promptApprovalDecision(
  runDir: string,
  abortSignal?: AbortSignal,
): Promise<{ decision: 'approve' | 'reject'; comment?: string }> {
  resetTerminalForPrompt({ input: process.stdin, output: process.stdout });
  const { workspace, manifest } = await loadManifest(runDir);
  const state = await loadRunState(workspace);
  const currentNodeId = state.currentNodeId;
  if (state.status !== 'paused' || !currentNodeId) {
    throw new Error('当前 run 不是 paused 状态，无法发起审批');
  }

  const currentNode = manifest.workflow.nodes[currentNodeId];
  if (currentNode?.type !== 'approval') {
    throw new Error('当前暂停节点不是 approval，不能使用交互式审批');
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
              return { decision: normalized, comment: trimmed };
            }
            console.log('reject 时必须提供打回意见');
          }
        }
        return { decision: normalized };
      }
      console.log('请输入 approve 或 reject');
    }
  } finally {
    rl.close();
  }
}

async function promptGateContinue(promptText: string, abortSignal?: AbortSignal): Promise<void> {
  resetTerminalForPrompt({ input: process.stdin, output: process.stdout });
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (promptText) {
      console.log(promptText);
    }
    const answer = await Promise.race([
      rl.question('按回车继续，输入 q 退出: '),
      createAbortPromise(abortSignal, () => rl.close()),
    ]);
    if (answer.trim().toLowerCase() === 'q') {
      throw new Error('用户取消继续执行');
    }
  } finally {
    rl.close();
  }
}

async function promptAgentSessionMessage(abortSignal?: AbortSignal): Promise<string> {
  resetTerminalForPrompt({ input: process.stdin, output: process.stdout });
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await Promise.race([rl.question('agent> '), createAbortPromise(abortSignal, () => rl.close())]);
  } finally {
    rl.close();
  }
}

async function promptSendMessage(abortSignal?: AbortSignal): Promise<string> {
  resetTerminalForPrompt({ input: process.stdin, output: process.stdout });
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
    splitTerminals?: boolean;
    nativeSplitTerminals?: boolean;
    abortSignal?: AbortSignal;
    onRunDir?: (runDir: string) => void;
  },
): Promise<Awaited<ReturnType<typeof startWorkflow>>> {
  let result = await startWorkflow(workflow, {
    workspaceRoot: options.workspaceRoot,
    defaultWorkdir: options.defaultWorkdir,
    codexCommand: options.codexCommand,
    splitTerminals: options.splitTerminals,
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
      throw new Error(`无法识别当前暂停节点: ${String(currentNodeId)}`);
    }

    if (currentNode.type === 'approval') {
      const approval = await promptApprovalDecision(result.runDir, options.abortSignal);
      result = await resumeWorkflow(result.runDir, {
        approvalDecision: approval.decision,
        approvalComment: approval.comment,
        codexCommand: options.codexCommand,
        splitTerminals: options.splitTerminals,
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
      result = await resumeWorkflow(result.runDir, {
        codexCommand: options.codexCommand,
        splitTerminals: options.splitTerminals,
        nativeSplitTerminals: options.nativeSplitTerminals,
        abortSignal: options.abortSignal,
        interactiveTerminal: { input: process.stdin, output: process.stdout },
        logger: (line) => console.log(line),
      });
      options.onRunDir?.(result.runDir);
      continue;
    }

    if (currentNode.type === 'agent_session') {
      console.log('agent_session 等待继续输入，输入 /exit 可暂时退出当前会话。');
      const message = (await promptAgentSessionMessage(options.abortSignal)).trim();
      if (!message || message === '/exit') {
        console.log(`run ${result.runId} => ${result.status}`);
        console.log(`workspace: ${result.runDir}`);
        return result;
      }
      result = await sendWorkflow(result.runDir, message, {
        codexCommand: options.codexCommand,
        splitTerminals: options.splitTerminals,
        nativeSplitTerminals: options.nativeSplitTerminals,
        abortSignal: options.abortSignal,
        interactiveTerminal: { input: process.stdin, output: process.stdout },
        logger: (line) => console.log(line),
      });
      options.onRunDir?.(result.runDir);
      continue;
    }

    throw new Error(`当前暂停节点不支持交互式继续: ${currentNode.type}`);
  }

  console.log(`run ${result.runId} => ${result.status}`);
  console.log(`workspace: ${result.runDir}`);
  return result;
}

async function handleNodeCommand(subcommand: string | undefined, flags: Record<string, string | boolean>): Promise<number> {
  const runDir = flags['run-dir'] ? path.resolve(String(flags['run-dir'])) : undefined;
  const nodeId = flags['node-id'] ? String(flags['node-id']) : undefined;
  if (!runDir || !nodeId) {
    throw new Error('node 命令需要 --run-dir 和 --node-id');
  }

  const { workspace } = await loadManifest(runDir);
  const nodeDir = path.join(workspace.nodesDir, nodeId);
  const sessionPath = getNativeSessionPath(nodeDir);
  const existingState = await readNativeSessionSafely(sessionPath);
  const baseState = existingState ?? {
    mode: 'native_split_terminal',
    status: 'launching',
    startedAt: nowIso(),
    updatedAt: nowIso(),
  };

  switch (subcommand) {
    case 'start': {
      const terminalPid = flags['terminal-pid'] ? Number(String(flags['terminal-pid'])) : undefined;
      const nextState: NativeSessionState = {
        ...baseState,
        mode: 'native_split_terminal',
        status: 'running',
        terminalPid,
        startedAt: baseState.startedAt,
        updatedAt: nowIso(),
      };
      await writeNativeSessionState(sessionPath, nextState);
      await appendNativeNodeEvent(workspace.messagesDir, {
        type: 'node.native.started',
        nodeId,
        at: nowIso(),
        terminalPid,
      });
      return 0;
    }

    case 'complete': {
      const summary = flags.summary ? String(flags.summary) : undefined;
      await updateNativeSessionState(sessionPath, (current) =>
        buildNativeTerminalState(current ?? baseState, 'completed', {
          kind: 'complete',
          summary,
        }),
      );
      await appendNativeNodeEvent(workspace.messagesDir, {
        type: 'node.native.completed',
        nodeId,
        at: nowIso(),
        summary,
      });
      return 0;
    }

    case 'fail': {
      const message = flags.message ? String(flags.message) : undefined;
      if (!message) {
        throw new Error('node fail 需要 --message');
      }
      await updateNativeSessionState(sessionPath, (current) =>
        buildNativeTerminalState(current ?? baseState, 'failed', {
          kind: 'fail',
          message,
        }),
      );
      await appendNativeNodeEvent(workspace.messagesDir, {
        type: 'node.native.failed',
        nodeId,
        at: nowIso(),
        message,
      });
      return 0;
    }

    case 'pause': {
      const reason = flags.reason ? String(flags.reason) : undefined;
      if (!reason) {
        throw new Error('node pause 需要 --reason');
      }
      await updateNativeSessionState(sessionPath, (current) =>
        buildNativeTerminalState(current ?? baseState, 'paused', {
          kind: 'pause',
          reason,
        }),
      );
      await appendNativeNodeEvent(workspace.messagesDir, {
        type: 'node.native.paused',
        nodeId,
        at: nowIso(),
        reason,
      });
      return 0;
    }

    case 'artifact': {
      const file = flags.file ? String(flags.file) : undefined;
      if (!file) {
        throw new Error('node artifact 需要 --file');
      }
      await updateNativeSessionState(sessionPath, (current) => ({
        ...(current ?? baseState),
        mode: 'native_split_terminal',
        updatedAt: nowIso(),
        lastArtifactPath: file,
      }));
      await appendNativeNodeEvent(workspace.messagesDir, {
        type: 'node.native.artifact',
        nodeId,
        at: nowIso(),
        file,
      });
      return 0;
    }

    case 'heartbeat': {
      await updateNativeSessionState(sessionPath, (current) => {
        const effectiveState = current ?? baseState;
        return {
          ...effectiveState,
          mode: 'native_split_terminal',
          status: effectiveState.status === 'launching' ? 'running' : effectiveState.status,
          updatedAt: nowIso(),
          lastHeartbeatAt: nowIso(),
        };
      });
      await appendNativeNodeEvent(workspace.messagesDir, {
        type: 'node.native.heartbeat',
        nodeId,
        at: nowIso(),
      });
      return 0;
    }

    default:
      throw new Error(`不支持的 node 子命令: ${String(subcommand)}`);
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
        throw new Error('validate 需要 workflow 文件路径');
      }
      await loadWorkflowFile(path.resolve(filePath));
      console.log('workflow 校验通过');
      return 0;
    }

    if (command === 'run') {
      const filePath = rest[0];
      if (!filePath) {
        throw new Error('run 需要 workflow 文件路径');
      }

      const workflow = await loadWorkflowFile(path.resolve(filePath));
      const shouldInteractive =
        flags.interactive === true || (flags['no-interactive'] !== true && process.stdin.isTTY && process.stdout.isTTY);
      const interruptContext = createInterruptContext();

      try {
        const codexCommand = resolveCodexCommand(flags);
        if (shouldInteractive) {
          const result = await runInteractiveWorkflow(workflow, {
            workspaceRoot: flags.workspace ? path.resolve(String(flags.workspace)) : undefined,
            defaultWorkdir: flags.workdir ? path.resolve(String(flags.workdir)) : undefined,
            codexCommand,
            splitTerminals: flags['split-terminals'] === true,
            nativeSplitTerminals: flags['native-split-terminals'] === true,
            abortSignal: interruptContext.controller.signal,
            onRunDir: (runDir) => {
              interruptContext.lastRunDir = runDir;
            },
          });
          return result.status === 'failed' ? 1 : 0;
        }

        const result = await startWorkflow(workflow, {
          ...buildRunnerOptionsFromFlags(flags, {
            workspaceRoot: flags.workspace ? path.resolve(String(flags.workspace)) : undefined,
            defaultWorkdir: flags.workdir ? path.resolve(String(flags.workdir)) : undefined,
            codexCommand,
            abortSignal: interruptContext.controller.signal,
            logger: (line) => console.log(line),
          }),
        });
        interruptContext.lastRunDir = result.runDir;
        console.log(`run ${result.runId} => ${result.status}`);
        console.log(`workspace: ${result.runDir}`);
        if (result.status === 'paused') {
          console.log(`当前停在节点: ${result.currentNodeId}`);
          console.log('执行 flowbraid resume <run-dir> 或 flowbraid send <run-dir> <message> 继续');
        }
        return result.status === 'failed' ? 1 : 0;
      } catch (error) {
        if (error instanceof RunInterruptedError && interruptContext.lastRunDir) {
          await failRun(interruptContext.lastRunDir, '用户中断运行');
        }
        throw error;
      } finally {
        interruptContext.dispose();
      }
    }

    if (command === 'resume') {
      const runDir = rest[0];
      if (!runDir) {
        throw new Error('resume 需要 run 目录路径');
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
            throw new Error('agent_session 节点请使用 send 继续对话，而不是 resume');
          }
          if (state.status === 'paused' && currentNode?.type === 'approval') {
            const approval = await promptApprovalDecision(resolvedRunDir, interruptContext.controller.signal);
            decision = approval.decision;
            comment = approval.comment;
          }
        }
        if (decision === 'reject' && !comment) {
          throw new Error('approval reject 时必须通过 --message 提供打回意见');
        }

        const result = await resumeWorkflow(resolvedRunDir, {
          ...buildRunnerOptionsFromFlags(flags, {
            approvalDecision: decision,
            approvalComment: comment,
            codexCommand,
            abortSignal: interruptContext.controller.signal,
            logger: (line) => console.log(line),
          }),
        });
        console.log(`run ${result.runId} => ${result.status}`);
        console.log(`workspace: ${result.runDir}`);
        return result.status === 'failed' ? 1 : 0;
      } catch (error) {
        if (error instanceof RunInterruptedError) {
          await failRun(resolvedRunDir, '用户中断运行');
        }
        throw error;
      } finally {
        interruptContext.dispose();
      }
    }

    if (command === 'send') {
      const runDir = rest[0];
      if (!runDir) {
        throw new Error('send 需要 run 目录路径');
      }
      const resolvedRunDir = path.resolve(runDir);
      const interruptContext = createInterruptContext();
      interruptContext.lastRunDir = resolvedRunDir;

      try {
        const codexCommand = resolveCodexCommand(flags);
        let message = rest.slice(1).join(' ').trim();
        if (!message) {
          if (!process.stdin.isTTY || !process.stdout.isTTY) {
            throw new Error('send 需要 message 参数');
          }
          message = (await promptSendMessage(interruptContext.controller.signal)).trim();
        }
        if (!message) {
          throw new Error('send 的 message 不能为空');
        }

        const result = await sendWorkflow(resolvedRunDir, message, {
          ...buildRunnerOptionsFromFlags(flags, {
            codexCommand,
            abortSignal: interruptContext.controller.signal,
            interactiveTerminal: { input: process.stdin, output: process.stdout },
            logger: (line) => console.log(line),
          }),
        });
        console.log(`run ${result.runId} => ${result.status}`);
        console.log(`workspace: ${result.runDir}`);
        if (result.status === 'paused') {
          console.log(`当前停在节点: ${result.currentNodeId}`);
        }
        return result.status === 'failed' ? 1 : 0;
      } catch (error) {
        if (error instanceof RunInterruptedError) {
          await failRun(resolvedRunDir, '用户中断运行');
        }
        throw error;
      } finally {
        interruptContext.dispose();
      }
    }

    if (command === 'node') {
      return handleNodeCommand(rest[0], flags);
    }

    if (command === 'internal') {
      const subcommand = rest[0];
      if (subcommand === 'run-codex-node') {
        const runDir = flags['run-dir'] ? path.resolve(String(flags['run-dir'])) : undefined;
        const nodeId = flags['node-id'] ? String(flags['node-id']) : undefined;
        if (!runDir || !nodeId) {
          throw new Error('internal run-codex-node 需要 --run-dir 和 --node-id');
        }
        const codexCommand = resolveCodexCommand(flags);
        const result = await runInternalCodexNode({
          runDir,
          nodeId,
          codexCommand,
        });
        return result.status === 'failed' ? 1 : 0;
      }
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
      console.error('收到 Ctrl+C，正在终止当前运行...');
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
