import { describe, expect, it } from 'vitest';
import { resolveNativeSplitPreference } from '../src/cli.js';

describe('interactive mode selection', () => {
  it('defaults interactive mode to native split', () => {
    expect(resolveNativeSplitPreference({}, true)).toBe(true);
  });

  it('uses pty when --pty is explicitly provided', () => {
    expect(resolveNativeSplitPreference({ pty: true }, true)).toBe(false);
  });

  it('keeps non-interactive runs on non-native mode', () => {
    expect(resolveNativeSplitPreference({}, false)).toBe(false);
  });
});
