import { describe, expect, it } from 'vitest';
import {
  buildWindowsTerminalLaunchCommand,
  buildWindowsTerminalCloseCommand,
  createExternalTerminalLauncher,
  parseTerminalPid,
} from '../src/terminal-launchers/index.js';

describe('external terminal launcher', () => {
  it('builds the Windows external terminal command for helper-based split mode', () => {
    const built = buildWindowsTerminalLaunchCommand({
      title: 'FlowBraid develop',
      workingDirectory: 'D:\\Project\\FlowBraid\\examples\\demo-dev',
      command: 'node',
      args: ['dist/cli.js', 'internal', 'run-codex-node', '--run-dir', 'D:\\run', '--node-id', 'develop'],
    });

    expect(built.file).toBe('powershell.exe');
    expect(built.args).toContain('-Command');
    const commandText = built.args[built.args.indexOf('-Command') + 1];
    expect(commandText).toContain('Start-Process');
    expect(commandText).toContain('-WorkingDirectory');
    expect(commandText).toContain('dist/cli.js');
    expect(commandText).toContain('--node-id');
    expect(commandText).toContain('develop');
    expect(commandText).not.toContain('MainWindowTitle');
  });

  it('builds the Windows external terminal command for native codex split mode', () => {
    const built = buildWindowsTerminalLaunchCommand({
      title: 'FlowBraid native develop',
      workingDirectory: 'D:\\Project\\FlowBraid\\examples\\demo-dev',
      command: 'codex',
      keepOpenOnExit: false,
      args: [
        '--cd',
        'D:\\Project\\FlowBraid\\examples\\demo-workdir',
        '--add-dir',
        'D:\\Project\\FlowBraid\\examples\\demo-dev',
        '--no-alt-screen',
        'Please finish the task.',
      ],
    });

    const commandText = built.args[built.args.indexOf('-Command') + 1];
    expect(commandText).toContain('codex');
    expect(commandText).toContain('--cd');
    expect(commandText).toContain('demo-workdir');
    expect(commandText).not.toContain('run-codex-node');
    expect(commandText).not.toContain("'-NoExit'");
  });

  it('parses terminalPid from stdout', () => {
    expect(parseTerminalPid('12345')).toBe(12345);
    expect(parseTerminalPid(' 67890 \r\n')).toBe(67890);
  });

  it('throws on invalid PID output', () => {
    expect(() => parseTerminalPid('not-a-number')).toThrow(/terminal pid/i);
  });

  it('fails explicitly on non-Windows platforms', async () => {
    const launcher = createExternalTerminalLauncher('linux');
    await expect(
      launcher.launch({
        title: 'FlowBraid verify',
        workingDirectory: '/tmp',
        command: 'node',
        args: ['dist/cli.js'],
      }),
    ).rejects.toThrow(/split-terminal .* Windows/i);
  });

  it('keeps the window title inside a PowerShell string literal', () => {
    const built = buildWindowsTerminalLaunchCommand({
      title: 'FlowBraid develop',
      workingDirectory: 'D:\\Project\\FlowBraid\\examples\\demo-dev',
      command: 'node',
      args: ['dist/cli.js'],
    });

    const commandText = built.args[built.args.indexOf('-Command') + 1];
    expect(commandText).toContain("$host.UI.RawUI.WindowTitle = ''FlowBraid develop''");
  });

  it('builds a close command that treats an already-exited terminal as a successful no-op', () => {
    const built = buildWindowsTerminalCloseCommand(76096);

    expect(built.file).toBe('powershell.exe');
    expect(built.args).toContain('-Command');
    const commandText = built.args[built.args.indexOf('-Command') + 1];
    expect(commandText).toContain('Get-Process -Id 76096');
    expect(commandText).toContain('-ErrorAction SilentlyContinue');
    expect(commandText).toContain('if ($p)');
    expect(commandText).toContain('taskkill');
    expect(commandText).toContain('/T');
    expect(commandText).toContain('/F');
    expect(commandText).toContain('/PID 76096');
  });

  it('builds a close command that swallows taskkill failures after the close attempt', () => {
    const built = buildWindowsTerminalCloseCommand(76096);

    const commandText = built.args[built.args.indexOf('-Command') + 1];
    expect(commandText).toContain('try');
    expect(commandText).toContain('catch');
    expect(commandText).toContain('taskkill');
  });
});
