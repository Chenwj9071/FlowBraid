#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { loadWorkflowFile, WorkflowError } from './workflow.js';
import { startWorkflow, resumeWorkflow } from './engine.js';

function printUsage(): void {
  console.log(`FlowBraid CLI

用法:
  flowbraid run <workflow-file> [--workspace <dir>] [--workdir <dir>]
  flowbraid resume <run-dir>
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
      const result = await startWorkflow(workflow, {
        workspaceRoot: flags.workspace ? path.resolve(String(flags.workspace)) : undefined,
        defaultWorkdir: flags.workdir ? path.resolve(String(flags.workdir)) : undefined,
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
      const result = await resumeWorkflow(path.resolve(runDir), {
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

