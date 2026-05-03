import type { TerminalSession } from './types.js';

const TERMINAL_RESET_SEQUENCE = [
  '\u001b[?1l',
  '\u001b[?25h',
  '\u001b[?66l',
  '\u001b[?1000l',
  '\u001b[?1002l',
  '\u001b[?1003l',
  '\u001b[?1004l',
  '\u001b[?1006l',
  '\u001b[?1015l',
  '\u001b[?2004l',
  '\u001b[?9001l',
  '\u001b[?1049l',
  '\u001b[>4;0m',
].join('');

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
    output.write(TERMINAL_RESET_SEQUENCE);
  } catch {
    // Ignore best-effort terminal reset failures.
  }
}

export function getTerminalResetSequence(): string {
  return TERMINAL_RESET_SEQUENCE;
}
