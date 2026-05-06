import type { RunnerOptions, TerminalSession } from './types.js';

export function buildRunnerOptionsFromFlags(
  flags: Record<string, string | boolean>,
  extras: {
    workspaceRoot?: string;
    defaultWorkdir?: string;
    codexCommand?: string;
    approvalDecision?: 'approve' | 'reject';
    approvalComment?: string;
    abortSignal?: AbortSignal;
    interactiveTerminal?: TerminalSession;
    logger?: (line: string) => void;
  } = {},
): RunnerOptions {
  return {
    workspaceRoot: extras.workspaceRoot,
    defaultWorkdir: extras.defaultWorkdir,
    codexCommand: extras.codexCommand,
    approvalDecision: extras.approvalDecision,
    approvalComment: extras.approvalComment,
    abortSignal: extras.abortSignal,
    interactiveTerminal: extras.interactiveTerminal,
    logger: extras.logger,
    nativeSplitTerminals: flags['native-split-terminals'] === true,
  };
}
