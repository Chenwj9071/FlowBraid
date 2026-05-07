import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { readJson } from '../src/utils.js';

type RunResult = { code: number | null; stdout: string; stderr: string };

function hasApprovalPrompt(stdout: string): boolean {
  return stdout.includes('approve/reject');
}

function hasRejectCommentPrompt(stdout: string): boolean {
  return stdout.includes('打回意见') || stdout.includes('璇疯緭鍏ユ墦鍥炴剰瑙?') || stdout.includes('鐠囩柉绶崗銉﹀ⅵ閸ョ偞鍓扮憴?');
}

async function waitForExit(child: ReturnType<typeof spawn>, stdout: () => string, stderr: () => string, timeoutMs = 30000) {
  return (await Promise.race([
    once(child, 'exit'),
    once(child, 'error').then(([error]) => {
      throw error;
    }),
    new Promise<[number | null, NodeJS.Signals | null]>((_, reject) => {
      setTimeout(() => {
        child.kill();
        reject(new Error(`interactive workflow timeout\nstdout:\n${stdout()}\nstderr:\n${stderr()}`));
      }, timeoutMs);
    }),
  ])) as [number | null, NodeJS.Signals | null];
}

async function runInteractiveRun(workflowFile: string): Promise<RunResult> {
  const command = process.platform === 'win32' ? 'cmd.exe' : 'npx';
  const cliArgs =
    process.platform === 'win32'
      ? ['/c', 'npx', 'tsx', 'src/cli.ts', 'run', workflowFile, '--interactive', '--pty']
      : ['tsx', 'src/cli.ts', 'run', workflowFile, '--interactive', '--pty'];
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
    if (!answered && stdout.includes('审批结果 [approve/reject]:')) {
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

  const [code] = await waitForExit(child, () => stdout, () => stderr);
  return { code, stdout, stderr };
}

async function runInteractiveReject(workflowFile: string, comment: string): Promise<RunResult> {
  const command = process.platform === 'win32' ? 'cmd.exe' : 'npx';
  const cliArgs =
    process.platform === 'win32'
      ? ['/c', 'npx', 'tsx', 'src/cli.ts', 'run', workflowFile, '--interactive', '--pty']
      : ['tsx', 'src/cli.ts', 'run', workflowFile, '--interactive', '--pty'];
  const child = spawn(command, cliArgs, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
  });

  let stdout = '';
  let stderr = '';
  let sentDecision = false;
  let sentComment = false;

  child.stdout.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    stdout += text;
    if (!sentDecision && stdout.includes('审批结果 [approve/reject]:')) {
      sentDecision = true;
      child.stdin.write('reject\n');
    }
    if (sentDecision && !sentComment && stdout.includes('请输入打回意见:')) {
      sentComment = true;
      child.stdin.write(`${comment}\n`);
      child.stdin.end();
    }
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });

  const [code] = await waitForExit(child, () => stdout, () => stderr);
  return { code, stdout, stderr };
}

async function runInteractiveRejectWithPowerShellUtf8(workflowFile: string, comment: string): Promise<RunResult> {
  if (process.platform !== 'win32') {
    return runInteractiveReject(workflowFile, comment);
  }

  const child = spawn(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `[Console]::InputEncoding=[System.Text.UTF8Encoding]::new($false); [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); chcp 65001 > $null; npx tsx src/cli.ts run '${workflowFile.replace(/'/g, "''")}' --interactive --pty`,
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    },
  );

  let stdout = '';
  let stderr = '';
  let sentDecision = false;
  let sentComment = false;

  child.stdout.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    stdout += text;
    if (!sentDecision && stdout.includes('审批结果 [approve/reject]:')) {
      sentDecision = true;
      child.stdin.write('reject\n', 'utf8');
    }
    if (sentDecision && !sentComment && stdout.includes('请输入打回意见:')) {
      sentComment = true;
      child.stdin.write(`${comment}\n`, 'utf8');
      child.stdin.end();
    }
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });

  const [code] = await waitForExit(child, () => stdout, () => stderr);
  return { code, stdout, stderr };
}

async function runViaDemoPtyScript(workflowFile: string, comment: string): Promise<RunResult> {
  if (process.platform !== 'win32') {
    return runInteractiveReject(workflowFile, comment);
  }

  const child = spawn(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/demo-pty.ps1', workflowFile],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    },
  );

  let stdout = '';
  let stderr = '';
  let sentDecision = false;
  let sentComment = false;

  child.stdout.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    stdout += text;
    if (!sentDecision && stdout.includes('审批结果 [approve/reject]:')) {
      sentDecision = true;
      child.stdin.write('reject\n', 'utf8');
    }
    if (sentDecision && !sentComment && stdout.includes('请输入打回意见:')) {
      sentComment = true;
      child.stdin.write(`${comment}\n`, 'utf8');
      child.stdin.end();
    }
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });

  const [code] = await waitForExit(child, () => stdout, () => stderr);
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
    expect(resumeResult.stdout).toContain('审批结果 [approve/reject]:');
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
  }, 40000);

  it('approve 后会继续输出完成状态并恢复终端', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-cli-approval-finish-'));
    const workflowDir = path.join(tempRoot, 'workspace');
    await mkdir(workflowDir, { recursive: true });

    const workflowFile = path.join(workflowDir, 'workflow.yaml');
    await writeFile(
      workflowFile,
      `
id: interactive-approval-finish-demo
start: approve
nodes:
  approve:
    type: approval
    prompt: 请确认是否通过
    transitions:
      approve: done
      reject: done
  done:
    type: end
    message: 完成
`,
      'utf8',
    );

    const result = await runInteractiveRun(workflowFile);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('run ');
    expect(result.stdout).toContain('=> completed');
    expect(result.stdout).toContain('workspace:');
    expect(result.stderr).toBe('');
  }, 40000);

  it('approve 后的后续输出会从新行开始，避免光标错位', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-cli-approval-cursor-'));
    const workflowDir = path.join(tempRoot, 'workspace');
    await mkdir(workflowDir, { recursive: true });

    const workflowFile = path.join(workflowDir, 'workflow.yaml');
    await writeFile(
      workflowFile,
      `
id: interactive-approval-cursor-demo
start: approve
nodes:
  approve:
    type: approval
    prompt: 璇风‘璁ゆ槸鍚﹂€氳繃
    transitions:
      approve: done
      reject: done
  done:
    type: end
    message: 瀹屾垚
`,
      'utf8',
    );

    const result = await runInteractiveRun(workflowFile);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('审批结果 [approve/reject]:');
    expect(result.stdout).toContain('\r\n');
    expect(result.stdout).toContain('=> completed');
    expect(result.stderr).toBe('');
  }, 40000);

  it('reject 时会继续要求输入打回意见并写入 human-feedback.jsonl', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-cli-reject-'));
    const workflowDir = path.join(tempRoot, 'workspace');
    await mkdir(workflowDir, { recursive: true });

    const workflowFile = path.join(workflowDir, 'workflow.yaml');
    const workflow = `
id: interactive-reject-demo
start: approve
nodes:
  approve:
    type: approval
    prompt: please review
    transitions:
      approve: done
      reject: done
  done:
    type: end
    message: done
`;
    await writeFile(workflowFile, workflow, 'utf8');

    const reviewComment = 'Add one extra usage comment line.';
    const result = await runInteractiveReject(workflowFile, reviewComment);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('审批结果 [approve/reject]:');
    expect(result.stdout).toContain('请输入打回意见:');
    expect(result.stdout).toContain('completed');
    expect(result.stderr).toBe('');

    const runDirMatch = result.stdout.match(/workspace:\s*(.+)/);
    expect(runDirMatch).not.toBeNull();
    const runDir = runDirMatch?.[1]?.trim();
    expect(runDir).toBeTruthy();

    const finalState = await readJson<{ status: string; currentNodeId: string | null }>(path.join(runDir!, 'state', 'run.json'));
    expect(finalState.status).toBe('completed');
    expect(finalState.currentNodeId).toBeNull();

    const feedback = await readFile(path.join(runDir!, 'messages', 'human-feedback.jsonl'), 'utf8');
    expect(feedback).toContain('"decision":"reject"');
    expect(feedback).toContain(reviewComment);
  }, 40000);

  it('Windows UTF-8 终端下支持中文 reject 意见写入 human-feedback.jsonl', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-cli-reject-cn-'));
    const workflowDir = path.join(tempRoot, 'workspace');
    await mkdir(workflowDir, { recursive: true });

    const workflowFile = path.join(workflowDir, 'workflow.yaml');
    const workflow = `
id: interactive-reject-cn-demo
start: approve
nodes:
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

    const reviewComment = '请补充一条命令行使用说明，并确认注释足够清晰。';
    const result = await runInteractiveRejectWithPowerShellUtf8(workflowFile, reviewComment);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('approve/reject');
    expect(result.stdout).toContain('打回意见');
    expect(result.stdout).toContain('completed');
    expect(result.stderr).toBe('');

    const runDirMatch = result.stdout.match(/workspace:\s*(.+)/);
    expect(runDirMatch).not.toBeNull();
    const runDir = runDirMatch?.[1]?.trim();
    expect(runDir).toBeTruthy();

    const feedback = await readFile(path.join(runDir!, 'messages', 'human-feedback.jsonl'), 'utf8');
    expect(feedback).toContain('"decision":"reject"');
    expect(feedback).toContain(reviewComment);
  }, 30000);

  it('Windows 正式 demo 入口也支持中文 reject 意见写入 human-feedback.jsonl', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-demo-pty-reject-cn-'));
    const workflowDir = path.join(tempRoot, 'workspace');
    await mkdir(workflowDir, { recursive: true });

    const workflowFile = path.join(workflowDir, 'workflow.yaml');
    const workflow = `
id: interactive-demo-pty-reject-cn-demo
start: approve
nodes:
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

    const reviewComment = '请补充一条命令行使用说明，并确认注释足够清晰。';
    const result = await runViaDemoPtyScript(workflowFile, reviewComment);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('approve/reject');
    expect(result.stdout).toContain('打回意见');
    expect(result.stdout).toContain('completed');
    expect(result.stderr).toBe('');

    const runDirMatch = result.stdout.match(/workspace:\s*(.+)/);
    expect(runDirMatch).not.toBeNull();
    const runDir = runDirMatch?.[1]?.trim();
    expect(runDir).toBeTruthy();

    const feedback = await readFile(path.join(runDir!, 'messages', 'human-feedback.jsonl'), 'utf8');
    expect(feedback).toContain('"decision":"reject"');
    expect(feedback).toContain(reviewComment);
  }, 30000);


  it('approval 收尾后不会把后续 scheduler 输出粘在同一行', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-cli-approval-line-'));
    const workflowDir = path.join(tempRoot, 'workspace');
    await mkdir(workflowDir, { recursive: true });

    const workflowFile = path.join(workflowDir, 'workflow.yaml');
    await writeFile(
      workflowFile,
      `
id: interactive-approval-line-demo
start: approve
nodes:
  approve:
    type: approval
    prompt: please confirm
    transitions:
      approve: done
      reject: done
  done:
    type: end
    message: done
`,
      'utf8',
    );

    const result = await runInteractiveRun(workflowFile);
    expect(result.code).toBe(0);
    const cleaned = result.stdout.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '');
    const lines = cleaned.replace(/\r/g, '').split('\n').map((line) => line.trim()).filter(Boolean);
    expect(lines.some((line) => line.includes('approve/reject'))).toBe(true);
    expect(lines).toContain('[run] approval decision approve -> approve');
    expect(lines).toContain('[run] node approve succeeded, next done: decision=approve');
    expect(lines.some((line) => /approve\/reject\]:.*\[run\] approval decision/.test(line))).toBe(false);
    expect(result.stderr).toBe('');
  }, 40000);

});
