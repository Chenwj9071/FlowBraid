#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { loadWorkflowFile, WorkflowError } from './workflow.js';
import { loadManifest, loadRunState } from './workspace.js';
import { startWorkflow, resumeWorkflow } from './engine.js';

function printUsage(): void {
  console.log(`FlowBraid CLI

用法:
  flowbraid run <workflow-file> [--workspace <dir>] [--workdir <dir>] [--codex-command <cmd>] [--interactive]
  flowbraid resume <run-dir> [--decision approve|reject] [--codex-command <cmd>]
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

async function promptApprovalDecision(runDir: string): Promise<'approve' | 'reject'> {
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
      const answer = await rl.question('审批结果 [approve/reject]: ');
      const normalized = answer.trim().toLowerCase();
      if (normalized === 'approve' || normalized === 'reject') {
        return normalized;
      }
      console.log('请输入 approve 或 reject');
    }
  } finally {
    rl.close();
  }
}

async function promptGateContinue(promptText: string): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (promptText) {
      console.log(promptText);
    }
    const answer = await rl.question('按回车继续，输入 q 退出: ');
    if (answer.trim().toLowerCase() === 'q') {
      throw new Error('用户取消继续执行');
    }
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
  },
): Promise<Awaited<ReturnType<typeof startWorkflow>>> {
  let result = await startWorkflow(workflow, {
    workspaceRoot: options.workspaceRoot,
    defaultWorkdir: options.defaultWorkdir,
    codexCommand: options.codexCommand,
    logger: (line) => console.log(line),
  });

  while (result.status === 'paused') {
    const { workspace, manifest } = await loadManifest(result.runDir);
    const state = await loadRunState(workspace);
    const currentNodeId = state.currentNodeId;
    const currentNode = currentNodeId ? manifest.workflow.nodes[currentNodeId] : null;

    if (!currentNode) {
      throw new Error(`无法识别当前暂停节点: ${String(currentNodeId)}`);
    }

    if (currentNode.type === 'approval') {
      const decision = await promptApprovalDecision(result.runDir);
      result = await resumeWorkflow(result.runDir, {
        approvalDecision: decision,
        codexCommand: options.codexCommand,
        logger: (line) => console.log(line),
      });
      continue;
    }

    if (currentNode.type === 'gate') {
      await promptGateContinue(currentNode.prompt ?? '');
      result = await resumeWorkflow(result.runDir, {
        codexCommand: options.codexCommand,
        logger: (line) => console.log(line),
      });
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

      if (shouldInteractive) {
        const result = await runInteractiveWorkflow(workflow, {
          workspaceRoot: flags.workspace ? path.resolve(String(flags.workspace)) : undefined,
          defaultWorkdir: flags.workdir ? path.resolve(String(flags.workdir)) : undefined,
          codexCommand: flags['codex-command'] ? String(flags['codex-command']) : undefined,
        });
        return result.status === 'failed' ? 1 : 0;
      }

      const result = await startWorkflow(workflow, {
        workspaceRoot: flags.workspace ? path.resolve(String(flags.workspace)) : undefined,
        defaultWorkdir: flags.workdir ? path.resolve(String(flags.workdir)) : undefined,
        codexCommand: flags['codex-command'] ? String(flags['codex-command']) : undefined,
        logger: (line) => console.log(line),
      });
      console.log(`run ${result.runId} => ${result.status}`);
      console.log(`workspace: ${result.runDir}`);
      if (result.status === 'paused') {
        console.log(`当前停在节点: ${result.currentNodeId}`);
        console.log('执行 flowbraid resume <run-dir> 继续');
      }
      return result.status === 'failed' ? 1 : 0;
    }

    if (command === 'resume') {
      const runDir = rest[0];
      if (!runDir) {
        throw new Error('resume 需要 run 目录路径');
      }
      const resolvedRunDir = path.resolve(runDir);
      const decisionFromFlag = flags.decision === 'approve' || flags.decision === 'reject' ? (flags.decision as 'approve' | 'reject') : undefined;
      let decision = decisionFromFlag;
      if (!decision) {
        const { workspace, manifest } = await loadManifest(resolvedRunDir);
        const state = await loadRunState(workspace);
        const currentNode = state.currentNodeId ? manifest.workflow.nodes[state.currentNodeId] : null;
        if (state.status === 'paused' && currentNode?.type === 'approval') {
          decision = await promptApprovalDecision(resolvedRunDir);
        }
      }

      const result = await resumeWorkflow(resolvedRunDir, {
        approvalDecision: decision,
        codexCommand: flags['codex-command'] ? String(flags['codex-command']) : undefined,
        logger: (line) => console.log(line),
      });
      console.log(`run ${result.runId} => ${result.status}`);
      console.log(`workspace: ${result.runDir}`);
      return result.status === 'failed' ? 1 : 0;
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

main().then((code) => {
  process.exitCode = code;
});
