import { spawn } from 'node:child_process';
import type {
  ExternalTerminalLaunchRequest,
  ExternalTerminalLaunchResult,
  ExternalTerminalLauncher,
} from './types.js';

export function buildWindowsTerminalLaunchCommand(
  request: ExternalTerminalLaunchRequest,
): { file: string; args: string[] } {
  const joinedArgs = [request.command, ...request.args].map(quotePowerShell).join(', ');
  const innerInvocation =
    request.bootstrapCommand ?? `& ${[request.command, ...request.args].map(quotePowerShell).join(' ')}`;
  const innerCommand = [
    `Set-Location ${quotePowerShell(request.workingDirectory)}`,
    `$host.UI.RawUI.WindowTitle = ${quotePowerShell(request.title)}`,
    innerInvocation,
  ].join('; ');
  const commandText = [
    '$ErrorActionPreference = "Stop"',
    `$argv = @(${joinedArgs})`,
    `$p = Start-Process -FilePath ${quotePowerShell('powershell.exe')} -ArgumentList @('-NoLogo', ${
      request.keepOpenOnExit === false ? '' : "'-NoExit', "
    }'-Command', ${quotePowerShell(innerCommand)}) -WorkingDirectory ${quotePowerShell(request.workingDirectory)} -WindowStyle Normal -PassThru`,
    'Write-Output $p.Id',
  ].join('; ');

  return {
    file: 'powershell.exe',
    args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', commandText],
  };
}

export function buildWindowsTerminalCloseCommand(terminalPid: number): { file: string; args: string[] } {
  const commandText = [
    '$ErrorActionPreference = "Stop"',
    `$p = Get-Process -Id ${terminalPid} -ErrorAction SilentlyContinue`,
    `if ($p) { & ${quotePowerShell('taskkill.exe')} /PID ${terminalPid} /T /F | Out-Null }`,
  ].join('; ');

  return {
    file: 'powershell.exe',
    args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', commandText],
  };
}

export function parseTerminalPid(output: string): number {
  const parsed = Number.parseInt(output.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid terminal pid output: ${output}`);
  }
  return parsed;
}

export function createWindowsTerminalLauncher(): ExternalTerminalLauncher {
  return {
    async launch(request: ExternalTerminalLaunchRequest): Promise<ExternalTerminalLaunchResult> {
      const built = buildWindowsTerminalLaunchCommand(request);
      const stdout = await spawnAndCapture(built.file, built.args);
      return { terminalPid: parseTerminalPid(stdout) };
    },
    async close(terminalPid: number): Promise<void> {
      const built = buildWindowsTerminalCloseCommand(terminalPid);
      await spawnAndCapture(built.file, built.args);
    },
  };
}

async function spawnAndCapture(file: string, args: string[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(file, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(stderr.trim() || `terminal launcher exited with code ${code ?? 'null'}`));
    });
  });
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/gu, "''")}'`;
}
