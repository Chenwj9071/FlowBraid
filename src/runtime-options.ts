import type { RunnerOptions, TerminalSession } from './types.js';

export function buildRunnerOptionsFromFlags(
  flags: Record<string, string | boolean>,
  extras: {
    workspaceRoot?: string;
    defaultWorkdir?: string;
    codexCommand?: string;
    approvalDecision?: 'approve' | 'reject';
    approvalComment?: string;
    manualDecision?: 'retry-current' | 'continue-next';
    abortSignal?: AbortSignal;
    interactiveTerminal?: TerminalSession;
    nativeSplitTerminals?: boolean;
    terminalCloseGraceMs?: number;
    terminalCloseTimeoutMs?: number;
    logger?: (line: string) => void;
  } = {},
): RunnerOptions {
  const graceFromFlag = flags['terminal-close-grace-ms'];
  const closeTimeoutFromFlag = flags['terminal-close-timeout-ms'];
  const terminalCloseGraceMs =
    extras.terminalCloseGraceMs ??
    (graceFromFlag !== undefined ? Number(String(graceFromFlag)) : undefined);
  const terminalCloseTimeoutMs =
    extras.terminalCloseTimeoutMs ??
    (closeTimeoutFromFlag !== undefined ? Number(String(closeTimeoutFromFlag)) : undefined);
  return {
    workspaceRoot: extras.workspaceRoot,
    defaultWorkdir: extras.defaultWorkdir,
    codexCommand: extras.codexCommand,
    approvalDecision: extras.approvalDecision,
    approvalComment: extras.approvalComment,
    manualDecision: extras.manualDecision,
    abortSignal: extras.abortSignal,
    interactiveTerminal: extras.interactiveTerminal,
    logger: extras.logger,
    nativeSplitTerminals: extras.nativeSplitTerminals,
    terminalCloseGraceMs:
      terminalCloseGraceMs !== undefined && Number.isFinite(terminalCloseGraceMs) && terminalCloseGraceMs >= 0
        ? terminalCloseGraceMs
        : undefined,
    terminalCloseTimeoutMs:
      terminalCloseTimeoutMs !== undefined && Number.isFinite(terminalCloseTimeoutMs) && terminalCloseTimeoutMs >= 0
        ? terminalCloseTimeoutMs
        : undefined,
  };
}
