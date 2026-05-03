#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { loadWorkflowFile, WorkflowError } from './workflow.js';
import { loadManifest, loadRunState, persistRunState } from './workspace.js';
import { resumeWorkflow, sendWorkflow, startWorkflow } from './engine.js';
import { RunInterruptedError } from './errors.js';
import { appendText, nowIso } from './utils.js';
import { resetTerminalForPrompt } from './terminal.js';

function printUsage(): void {
  console.log(`FlowBraid CLI

用法:
  flowbraid run <workflow-file> [--workspace <dir>] [--workdir <dir>] [--codex-command <cmd>] [--interactive]
  flowbraid resume <run-dir> [--decision approve|reject] [--message <text>] [--codex-command <cmd>]
  flowbraid send <run-dir> <message> [--codex-command <cmd>]
  flowbraid validate <workflow-file>`);
}

function parseArgs(argv: string[]): { command?: string; rest: string[]; flags: Record<string, string | boolean> } {
  const [command, ...rest] = argv;
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i += 1) {
    const item = rest[i];
    if (item.startsWith('--')) {
      const key = item.slice(2);
      const value = rest[i + 1];
      if (!value || value.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = value;
        i += 1;
      }
    } else {
      positional.push(item);
    }
  }
  return { command, rest: positional, flags };
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
    throw new Error('当前 run 不是暂停状态，无法发起审批选择');
  }

  const currentNode = manifest.workflow.nodes[currentNodeId];
  if (currentNode?.type !== 'approval') {
    throw new Error('当前暂停节点不是 approval，不能使用交互式审批选择');
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
    return await Promise.race([
      rl.question('agent> '),
      createAbortPromise(abortSignal, () => rl.close()),
    ]);
  } finally {
    rl.close();
  }
}

async function promptSendMessage(abortSignal?: AbortSignal): Promise<string> {
  resetTerminalForPrompt({ input: process.stdin, output: process.stdout });
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await Promise.race([
      rl.question('message> '),
      createAbortPromise(abortSignal, () => rl.close()),
    ]);
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
    abortSignal?: AbortSignal;
    onRunDir?: (runDir: string) => void;
  },
): Promise<Awaited<ReturnType<typeof startWorkflow>>> {
  let result = await startWorkflow(workflow, {
    workspaceRoot: options.workspaceRoot,
    defaultWorkdir: options.defaultWorkdir,
    codexCommand: options.codexCommand,
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

async function main(): Promise<number> {
  const { command, rest, flags } = parseArgs(process.argv.slice(2));
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
        flags.interactive === true ||
        (flags['no-interactive'] !== true && process.stdin.isTTY && process.stdout.isTTY);
      const interruptContext = createInterruptContext();

      try {
        const codexCommand = resolveCodexCommand(flags);
        if (shouldInteractive) {
          const result = await runInteractiveWorkflow(workflow, {
            workspaceRoot: flags.workspace ? path.resolve(String(flags.workspace)) : undefined,
            defaultWorkdir: flags.workdir ? path.resolve(String(flags.workdir)) : undefined,
            codexCommand,
            abortSignal: interruptContext.controller.signal,
            onRunDir: (runDir) => {
              interruptContext.lastRunDir = runDir;
            },
          });
          return result.status === 'failed' ? 1 : 0;
        }

        const result = await startWorkflow(workflow, {
          workspaceRoot: flags.workspace ? path.resolve(String(flags.workspace)) : undefined,
          defaultWorkdir: flags.workdir ? path.resolve(String(flags.workdir)) : undefined,
          codexCommand,
          abortSignal: interruptContext.controller.signal,
          logger: (line) => console.log(line),
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
          approvalDecision: decision,
          approvalComment: comment,
          codexCommand,
          abortSignal: interruptContext.controller.signal,
          logger: (line) => console.log(line),
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
          codexCommand,
          abortSignal: interruptContext.controller.signal,
          interactiveTerminal: { input: process.stdin, output: process.stdout },
          logger: (line) => console.log(line),
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

main().then((code) => {
  process.exit(code);
});
