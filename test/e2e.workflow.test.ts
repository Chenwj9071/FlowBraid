import path from 'node:path';
import os from 'node:os';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { loadWorkflowFile } from '../src/workflow.js';
import { startWorkflow, resumeWorkflow } from '../src/engine.js';
import { readJson } from '../src/utils.js';

describe('FlowBraid 最小端到端闭环', () => {
  it('默认把 workflow 文件所在目录当作工作目录，并在该目录下落盘运行时数据', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-e2e-'));
    const workspaceRoot = path.join(tempRoot, 'runs');
    const workflowDir = path.join(tempRoot, 'examples');
    await import('node:fs/promises').then((fs) => fs.mkdir(workflowDir, { recursive: true }));

    const workflowFile = path.join(workflowDir, 'workflow.yaml');
    const workflow = `
id: demo-flow
start: prepare
nodes:
  prepare:
    type: shell
    command: node -e "require('fs').writeFileSync('prepare.txt', process.env.FLOWBRAID_RUN_ID + '\\n' + process.env.FLOWBRAID_NODE_ID)"
    next: wait
  wait:
    type: gate
    prompt: 需要人工确认
    next: finish
  finish:
    type: shell
    command: node -e "require('fs').writeFileSync('finish.txt', process.env.FLOWBRAID_RESUME_COUNT + '\\n' + process.env.FLOWBRAID_NODE_ID)"
    next: done
  done:
    type: end
    message: 完成
`;
    await writeFile(workflowFile, workflow, 'utf8');

    const loaded = await loadWorkflowFile(workflowFile);
    const firstResult = await startWorkflow(loaded, {
      workspaceRoot,
    });

    expect(firstResult.status).toBe('paused');
    expect(firstResult.currentNodeId).toBe('wait');
    expect(firstResult.runDir.startsWith(workspaceRoot)).toBe(true);

    const runDir = firstResult.runDir;
    const runState = await readJson<{ status: string; pendingNodeId: string | null }>(path.join(runDir, 'state', 'run.json'));
    expect(runState.status).toBe('paused');
    expect(runState.pendingNodeId).toBe('finish');

    const prepareText = await readFile(path.join(workflowDir, 'prepare.txt'), 'utf8');
    expect(prepareText).toContain('prepare');

    const secondResult = await resumeWorkflow(runDir, {
    });

    expect(secondResult.status).toBe('completed');

    const finishText = await readFile(path.join(workflowDir, 'finish.txt'), 'utf8');
    expect(finishText).toContain('1');
    expect(finishText).toContain('finish');

    const finalState = await readJson<{ status: string; currentNodeId: string | null }>(path.join(runDir, 'state', 'run.json'));
    expect(finalState.status).toBe('completed');
    expect(finalState.currentNodeId).toBeNull();

    const nodeStatus = await readJson<{ status: string }>(path.join(runDir, 'nodes', 'prepare', 'status.json'));
    expect(nodeStatus.status).toBe('succeeded');
    const gateStatus = await readJson<{ status: string }>(path.join(runDir, 'nodes', 'wait', 'status.json'));
    expect(gateStatus.status).toBe('paused');
    const finishStatus = await readJson<{ status: string }>(path.join(runDir, 'nodes', 'finish', 'status.json'));
    expect(finishStatus.status).toBe('succeeded');
  }, 20000);
});
