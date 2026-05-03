import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { runCodexTask } from '../src/executors/codex.js';

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
});
