import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { readJson } from '../src/utils.js';

async function runInteractiveRun(workflowFile: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const command = process.platform === 'win32' ? 'cmd.exe' : 'npx';
  const cliArgs =
    process.platform === 'win32'
      ? ['/c', 'npx', 'tsx', 'src/cli.ts', 'run', workflowFile, '--interactive']
      : ['tsx', 'src/cli.ts', 'run', workflowFile, '--interactive'];
  const child = spawn(command, cliArgs, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
  });

  let stdout = '';
  let stderr = '';
  let answered = false;

  child.stdout.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    stdout += text;
    if (!answered && text.includes('审批结果')) {
      answered = true;
      child.stdin.write('approve\n');
      child.stdin.end();
    }
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });

  if (!answered) {
    setTimeout(() => {
      if (!answered) {
        answered = true;
        child.stdin.write('approve\n');
        child.stdin.end();
      }
    }, 200);
  }

  const [code] = (await Promise.race([
    once(child, 'exit'),
    once(child, 'error').then(([error]) => {
      throw error;
    }),
  ])) as [number | null, NodeJS.Signals | null];

  return { code, stdout, stderr };
}

describe('CLI 交互式审批', () => {
  it('run 时可以在同一个终端选择 approve 并继续结束', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-cli-approval-'));
    const workflowDir = path.join(tempRoot, 'workspace');
    await mkdir(workflowDir, { recursive: true });

    const workflowFile = path.join(workflowDir, 'workflow.yaml');
    const workflow = `
id: interactive-approval-demo
start: prepare
nodes:
  prepare:
    type: shell
    command: node -e "require('fs').writeFileSync('prepare.txt', 'ok')"
    next: approve
  approve:
    type: approval
    prompt: 请确认是否通过
    transitions:
      approve: done
      reject: done
  done:
    type: end
    message: 完成
`;
    await writeFile(workflowFile, workflow, 'utf8');

    const resumeResult = await runInteractiveRun(workflowFile);
    expect(resumeResult.code).toBe(0);
    expect(resumeResult.stdout).toContain('审批结果');
    expect(resumeResult.stdout).toContain('completed');
    expect(resumeResult.stderr).toBe('');

    const runDirMatch = resumeResult.stdout.match(/workspace:\s*(.+)/);
    expect(runDirMatch).not.toBeNull();
    const runDir = runDirMatch?.[1]?.trim();
    expect(runDir).toBeTruthy();

    const finalState = await readJson<{ status: string; currentNodeId: string | null }>(path.join(runDir!, 'state', 'run.json'));
    expect(finalState.status).toBe('completed');
    expect(finalState.currentNodeId).toBeNull();

    const prepareText = await readFile(path.join(workflowDir, 'prepare.txt'), 'utf8');
    expect(prepareText).toBe('ok');
  }, 20000);
});
