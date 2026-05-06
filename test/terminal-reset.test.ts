import { describe, expect, it } from 'vitest';
import { getTerminalResetSequence, resetTerminalForPrompt } from '../src/terminal.js';

describe('terminal reset', () => {
  it('restores normal terminal modes before readline takes over', () => {
    const writes: string[] = [];
    type FakeInput = NodeJS.ReadableStream & {
      isRaw?: boolean;
      setRawMode: (mode: boolean) => void;
    };
    const fakeInput: FakeInput = {
      isRaw: true,
      setRawMode(mode: boolean) {
        this.isRaw = mode;
      },
    } as FakeInput;
    const terminal = {
      input: fakeInput as unknown as NodeJS.ReadableStream,
      output: {
        write(chunk: string) {
          writes.push(chunk);
          return true;
        },
      } as unknown as NodeJS.WritableStream,
    };

    resetTerminalForPrompt(terminal);

    expect(fakeInput.isRaw).toBe(false);
    expect(writes).toEqual([getTerminalResetSequence()]);
    expect(writes[0].startsWith('\r\n')).toBe(true);
  });
});
