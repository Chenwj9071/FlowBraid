import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { loadWorkflowFile } from '../src/workflow.js';
import { loadManifest, loadRunState } from '../src/workspace.js';
import { resumeWorkflow, sendWorkflow, startWorkflow } from '../src/engine.js';

function normalizeDecision(text) {
  const value = text.trim().toLowerCase();
  if (value === 'approve' || value === 'reject') {
    return value;
  }
  return null;
}

async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

async function promptApproval() {
  while (true) {
    const decision = normalizeDecision(await ask('审批结果 [approve/reject]: '));
    if (!decision) {
      console.log('请输入 approve 或 reject');
      continue;
    }
    if (decision === 'approve') {
      return { decision };
    }
    while (true) {
      const comment = (await ask('请输入打回意见: ')).trim();
      if (comment) {
        return { decision, comment };
      }
      console.log('reject 时必须提供打回意见');
    }
  }
}

async function promptGate(promptText) {
  if (promptText) {
    console.log(promptText);
  }
  const answer = await ask('按回车继续，输入 q 退出: ');
  if (answer.trim().toLowerCase() === 'q') {
    throw new Error('用户取消继续执行');
  }
}

async function promptAgentMessage() {
  return await ask('agent> ');
}

async function main() {
  if (process.platform === 'win32') {
    try {
      process.stdin.setEncoding('utf8');
      process.stdout.setDefaultEncoding?.('utf8');
    } catch {
      // ignore best-effort encoding setup failures
    }
  }

  const workflowFile = path.resolve('examples/codex-pty-demo.workflow.yaml');
  const workflow = await loadWorkflowFile(workflowFile);
  let result = await startWorkflow(workflow, {
    interactiveTerminal: { input: process.stdin, output: process.stdout },
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
      const approval = await promptApproval();
      result = await resumeWorkflow(result.runDir, {
        approvalDecision: approval.decision,
        approvalComment: approval.comment,
        interactiveTerminal: { input: process.stdin, output: process.stdout },
        logger: (line) => console.log(line),
      });
      continue;
    }

    if (currentNode.type === 'gate') {
      await promptGate(currentNode.prompt ?? '');
      result = await resumeWorkflow(result.runDir, {
        interactiveTerminal: { input: process.stdin, output: process.stdout },
        logger: (line) => console.log(line),
      });
      continue;
    }

    if (currentNode.type === 'agent_session') {
      console.log('agent_session 等待继续输入，输入 /exit 可暂时退出当前会话。');
      const message = (await promptAgentMessage()).trim();
      if (!message || message === '/exit') {
        break;
      }
      result = await sendWorkflow(result.runDir, message, {
        interactiveTerminal: { input: process.stdin, output: process.stdout },
        logger: (line) => console.log(line),
      });
      continue;
    }

    throw new Error(`当前暂停节点不支持交互式继续: ${currentNode.type}`);
  }

  console.log(`run ${result.runId} => ${result.status}`);
  console.log(`workspace: ${result.runDir}`);
  process.exit(result.status === 'failed' ? 1 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
