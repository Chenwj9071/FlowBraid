import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { buildInteractivePtyCommand, runCodexTask } from '../src/executors/codex.js';

describe('codex 字符串命令兼容性', () => {
  it('支持通过字符串命令启动本地 node 脚本', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-codex-string-'));
    const workdir = path.join(tempRoot, 'workspace');
    await mkdir(workdir, { recursive: true });

    const scriptPath = path.join(workdir, 'fake-codex.js');
    const outputPath = path.join(workdir, 'last-message.md');
    const logPath = path.join(workdir, 'codex.log');

    const fakeScript = [
      "const fs = require('node:fs');",
      "const args = process.argv.slice(2);",
      "const outputIndex = args.indexOf('--output-last-message');",
      "const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : '';",
      "const prompt = fs.readFileSync(0, 'utf8');",
      "if (outputPath) fs.writeFileSync(outputPath, '# ok\\n' + prompt, 'utf8');",
      "console.log('fake codex ok');",
    ].join('\n');
    await writeFile(scriptPath, fakeScript, 'utf8');

    const result = await runCodexTask({
      command: `node "${scriptPath}"`,
      cwd: workdir,
      logPath,
      outputPath,
      prompt: 'hello demo',
    });

    expect(result.exitCode).toBe(0);
  }, 20000);

  it('Windows PTY 交互模式会通过 UTF-8 PowerShell 包装 codex 命令', () => {
    const built = buildInteractivePtyCommand(
      'codex',
      ['exec', '--cd', 'D:\\demo-workdir'],
      '请读取当前目录 AGENTS.md 并在 workdir 中继续工作',
      'win32',
    );

    expect(built.command).toBe('powershell.exe');
    expect(built.args).toContain('-Command');
    const commandText = built.args[built.args.indexOf('-Command') + 1];
    expect(commandText).toContain('UTF8Encoding');
    expect(commandText).toContain('chcp 65001');
    expect(commandText).toContain("& 'codex.cmd'");
    expect(commandText).toContain("'exec'");
    expect(commandText).toContain("'--cd'");
    expect(commandText).toContain("'D:\\demo-workdir'");
    expect(commandText).toContain('请读取当前目录 AGENTS.md 并在 workdir 中继续工作');
  });
});
