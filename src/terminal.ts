import type { TerminalSession } from './types.js';

type RawModeCapableInput = NodeJS.ReadStream & {
  isRaw?: boolean;
  setRawMode?: (mode: boolean) => void;
};

export function resetTerminalForPrompt(
  terminal: Pick<TerminalSession, 'input' | 'output'> | { input: NodeJS.ReadableStream; output: NodeJS.WritableStream },
): void {
  const input = terminal.input as RawModeCapableInput;
  const output = terminal.output;

  try {
    if (typeof input.setRawMode === 'function' && input.isRaw) {
      input.setRawMode(false);
    }
  } catch {
    // Ignore best-effort raw mode restoration failures.
  }

  try {
    output.write(getTerminalResetSequence());
  } catch {
    // Ignore best-effort terminal reset write failures.
  }
}

export function getTerminalResetSequence(): string {
  return '\r\n';
}

export function stabilizeTerminalForPrompt(
  terminal: Pick<TerminalSession, 'input' | 'output'> | { input: NodeJS.ReadableStream; output: NodeJS.WritableStream },
): void {
  resetTerminalForPrompt(terminal);
  try {
    terminal.output.write('\r\n');
  } catch {
    // Ignore best-effort line normalization failures.
  }
}
