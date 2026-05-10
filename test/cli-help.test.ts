import { afterEach, describe, expect, it, vi } from 'vitest';
import { main } from '../src/cli.js';

describe('cli help output', () => {
  const stdoutSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  afterEach(() => {
    stdoutSpy.mockClear();
    stderrSpy.mockClear();
  });

  it('prints enriched usage text for --help', async () => {
    const exitCode = await main(['--help']);

    expect(exitCode).toBe(0);
    const output = stdoutSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('FlowBraid CLI');
    expect(output).toContain('TTY 下默认自动进入交互模式，并优先使用 native split');
    expect(output).toContain('--pty                强制使用单终端 PTY 交互模式');
    expect(output).toContain('--no-interactive     强制关闭交互模式，适合脚本和 CI');
    expect(output).toContain('flowbraid workflow-help');
  });

  it('prints enriched usage text when no command is provided', async () => {
    const exitCode = await main([]);

    expect(exitCode).toBe(1);
    const output = stdoutSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('FlowBraid CLI');
    expect(output).toContain('用 flowbraid workflow-help 查看简化版工作流编写说明');
  });

  it('prints a compact workflow authoring guide', async () => {
    const exitCode = await main(['workflow-help']);

    expect(exitCode).toBe(0);
    const output = stdoutSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('FlowBraid Workflow Quick Reference');
    expect(output).toContain('顶层字段');
    expect(output).toContain('节点类型');
    expect(output).toContain('reentry.mode');
    expect(output).toContain('flowbraid resume <run-dir>');
    expect(output).toContain('flowbraid send <run-dir> <message>');
  });
});
