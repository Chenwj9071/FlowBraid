export interface ExternalTerminalLaunchRequest {
  title: string;
  workingDirectory: string;
  command: string;
  args: string[];
  bootstrapCommand?: string;
  keepOpenOnExit?: boolean;
}

export interface ExternalTerminalLaunchResult {
  terminalPid: number;
}

export interface ExternalTerminalLauncher {
  launch(request: ExternalTerminalLaunchRequest): Promise<ExternalTerminalLaunchResult>;
  close(
    terminalPid: number,
    options?: { timeoutMs?: number; title?: string },
  ): Promise<void>;
}

export interface ExternalTerminalController {
  launcher: ExternalTerminalLauncher;
}
