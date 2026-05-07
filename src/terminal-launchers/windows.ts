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
    `cmd.exe /d /c title ${request.title}`,
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
  return buildWindowsTerminalCloseCommandWithTitle(terminalPid);
}

export function buildWindowsTerminalCloseCommandWithTitle(
  terminalPid: number,
  title?: string,
): { file: string; args: string[] } {
  const titleClose = title ? quotePowerShell(title) : null;
  const commandText = [
    '$ErrorActionPreference = "Stop"',
    titleClose
      ? [
          `$targetTitle = ${titleClose}`,
          '$matches = @(Get-Process | Where-Object { $_.MainWindowTitle -eq $targetTitle })',
          // Windows 控制台窗口经常对 CloseMainWindow() 不响应（返回 false / 无效果），
          // 这里先做一次温和关闭，然后无论如何都继续走 PID 兜底的 taskkill。
          'foreach ($match in $matches) { try { [void]$match.CloseMainWindow() } catch { } }',
          'Start-Sleep -Milliseconds 250',
        ].join('; ')
      : '$matches = @()',
    `$p = Get-Process -Id ${terminalPid} -ErrorAction SilentlyContinue`,
    titleClose
      ? [
          // 如果我们找到了标题匹配的窗口，说明 terminalPid 很可能就是外部终端。
          // 此时直接 taskkill /T /F 更可靠，避免终端残留导致 native-split 节点结束后窗口不关闭。
          'if ($p -and $p.MainWindowTitle -eq $targetTitle) {',
          `  try { taskkill /PID ${terminalPid} /T /F | Out-Null } catch { }`,
          '} else {',
          // PID 不匹配标题时，也可能是进程树或宿主进程差异导致（ConHost/Windows Terminal）。
          // 在我们已经按标题尝试关闭过后，再对 pid 做一次兜底关闭，避免遗漏。
          `  if ($p) { try { taskkill /PID ${terminalPid} /T /F | Out-Null } catch { } }`,
          '}',
        ].join(' ')
      : `if ($p) { try { taskkill /PID ${terminalPid} /T /F | Out-Null } catch { } }`,
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
    async close(terminalPid: number, options?: { timeoutMs?: number; title?: string; signal?: AbortSignal }): Promise<void> {
      const built = buildWindowsTerminalCloseCommandWithTitle(terminalPid, options?.title);
      await spawnAndCapture(built.file, built.args, options?.timeoutMs ?? 5000, options?.signal);
    },
  };
}

async function spawnAndCapture(file: string, args: string[], timeoutMs = 15000, signal?: AbortSignal): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('terminal launcher aborted'));
      return;
    }
    const child = spawn(file, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`terminal launcher timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const abortHandler = (): void => {
      try {
        child.kill();
      } catch {
        // ignore abort kill errors
      }
      reject(new Error('terminal launcher aborted'));
    };
    if (signal) {
      signal.addEventListener('abort', abortHandler, { once: true });
    }
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      if (signal) {
        signal.removeEventListener('abort', abortHandler);
      }
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      if (signal) {
        signal.removeEventListener('abort', abortHandler);
      }
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
