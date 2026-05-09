import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  buildFlowBraidNodeCommandPrefix,
  buildInteractivePtyCommand,
  buildNativeCodexResumeInvocation,
  buildNativeInteractiveCommand,
  runCodexTask,
} from '../src/executors/codex.js';

describe('codex command helpers', () => {
  it('supports launching a local node script via command string', async () => {
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

  it('wraps Windows PTY interactive codex through a UTF-8 PowerShell shim', () => {
    const built = buildInteractivePtyCommand(
      'codex',
      ['exec', '--cd', 'D:\\demo-workdir'],
      'please read AGENTS.md first',
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
    expect(commandText).toContain('please read AGENTS.md first');
  });

  it('builds a native Windows interactive command for codex nodes', () => {
    const built = buildNativeInteractiveCommand(
      'codex',
      ['exec', '--cd', 'D:\\demo-workdir'],
      'please finish the task',
      'win32',
    );

    expect(built.command).toBe('cmd.exe');
    expect(built.args).toEqual(['/d', '/c', 'codex', 'exec', '--cd', 'D:\\demo-workdir', 'please finish the task']);
  });

  it('wraps direct .cmd commands through cmd.exe for native Windows interactive mode', () => {
    const built = buildNativeInteractiveCommand(
      'C:\\tools\\codex.cmd',
      ['exec', '--cd', 'D:\\demo-workdir'],
      'please finish the task',
      'win32',
    );

    expect(built.command).toBe('cmd.exe');
    expect(built.args).toEqual([
      '/d',
      '/c',
      'C:\\tools\\codex.cmd',
      'exec',
      '--cd',
      'D:\\demo-workdir',
      'please finish the task',
    ]);
  });

  it('builds native resume invocations with an explicit node session id instead of resume --last', () => {
    const built = buildNativeCodexResumeInvocation({
      prompt: 'continue after review feedback',
      workdir: 'D:\\demo-workdir',
      contextDir: 'D:\\demo-dev',
      sessionId: '019df466-f6a4-7ec3-a230-9e6bbd5ebeb9',
    });

    expect(built.command).toBe('codex');
    expect(built.args[0]).toBe('resume');
    expect(built.args[1]).toBe('019df466-f6a4-7ec3-a230-9e6bbd5ebeb9');
    expect(built.args).not.toContain('--last');
  });

  it('uses the stable flowbraid command name for prompt protocol by default', () => {
    const originalCommand = process.env.FLOWBRAID_NODE_CLI_COMMAND;
    const originalEntrypointMode = process.env.FLOWBRAID_PROMPT_USE_ENTRYPOINT;
    delete process.env.FLOWBRAID_NODE_CLI_COMMAND;
    delete process.env.FLOWBRAID_PROMPT_USE_ENTRYPOINT;

    try {
      expect(buildFlowBraidNodeCommandPrefix()).toBe('flowbraid');
    } finally {
      if (originalCommand === undefined) {
        delete process.env.FLOWBRAID_NODE_CLI_COMMAND;
      } else {
        process.env.FLOWBRAID_NODE_CLI_COMMAND = originalCommand;
      }
      if (originalEntrypointMode === undefined) {
        delete process.env.FLOWBRAID_PROMPT_USE_ENTRYPOINT;
      } else {
        process.env.FLOWBRAID_PROMPT_USE_ENTRYPOINT = originalEntrypointMode;
      }
    }
  });

  it('supports an explicit prompt command override', () => {
    const originalCommand = process.env.FLOWBRAID_NODE_CLI_COMMAND;
    process.env.FLOWBRAID_NODE_CLI_COMMAND = 'fb';

    try {
      expect(buildFlowBraidNodeCommandPrefix()).toBe('fb');
    } finally {
      if (originalCommand === undefined) {
        delete process.env.FLOWBRAID_NODE_CLI_COMMAND;
      } else {
        process.env.FLOWBRAID_NODE_CLI_COMMAND = originalCommand;
      }
    }
  });

  it('can still fall back to the local entrypoint in explicit development mode', () => {
    const originalCommand = process.env.FLOWBRAID_NODE_CLI_COMMAND;
    const originalEntrypointMode = process.env.FLOWBRAID_PROMPT_USE_ENTRYPOINT;
    delete process.env.FLOWBRAID_NODE_CLI_COMMAND;
    process.env.FLOWBRAID_PROMPT_USE_ENTRYPOINT = '1';

    try {
      const built = buildFlowBraidNodeCommandPrefix('win32', ['node', 'D:\\Code\\FlowBraid\\dist\\cli.js']);
      expect(built).toContain('cli.js');
    } finally {
      if (originalCommand === undefined) {
        delete process.env.FLOWBRAID_NODE_CLI_COMMAND;
      } else {
        process.env.FLOWBRAID_NODE_CLI_COMMAND = originalCommand;
      }
      if (originalEntrypointMode === undefined) {
        delete process.env.FLOWBRAID_PROMPT_USE_ENTRYPOINT;
      } else {
        process.env.FLOWBRAID_PROMPT_USE_ENTRYPOINT = originalEntrypointMode;
      }
    }
  });
});
