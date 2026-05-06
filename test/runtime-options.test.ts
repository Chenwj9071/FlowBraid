import { describe, expect, it } from 'vitest';
import { buildRunnerOptionsFromFlags } from '../src/runtime-options.js';

describe('runtime options', () => {
  it('preserves native split flags across run/resume/send option building', () => {
    const logger = (): void => undefined;
    const interactiveTerminal = { input: process.stdin, output: process.stdout };
    const options = buildRunnerOptionsFromFlags(
      {
        'native-split-terminals': true,
      },
      {
        codexCommand: 'codex',
        approvalDecision: 'reject',
        approvalComment: 'fix it',
        interactiveTerminal,
        logger,
      },
    );

    expect(options.nativeSplitTerminals).toBe(true);
    expect(options.codexCommand).toBe('codex');
    expect(options.approvalDecision).toBe('reject');
    expect(options.approvalComment).toBe('fix it');
    expect(options.interactiveTerminal).toBe(interactiveTerminal);
    expect(options.logger).toBe(logger);
  });
});
