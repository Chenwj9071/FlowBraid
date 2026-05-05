import { describe, expect, it } from 'vitest';
import { parseArgs } from '../src/cli-args.js';

describe('split terminal CLI args', () => {
  it('parses run --interactive --split-terminals', () => {
    const parsed = parseArgs(['run', 'examples/codex-split-demo.workflow.yaml', '--interactive', '--split-terminals']);

    expect(parsed.command).toBe('run');
    expect(parsed.rest).toEqual(['examples/codex-split-demo.workflow.yaml']);
    expect(parsed.flags.interactive).toBe(true);
    expect(parsed.flags['split-terminals']).toBe(true);
  });

  it('parses run --interactive --native-split-terminals', () => {
    const parsed = parseArgs([
      'run',
      'examples/codex-native-split-demo.workflow.yaml',
      '--interactive',
      '--native-split-terminals',
    ]);

    expect(parsed.command).toBe('run');
    expect(parsed.rest).toEqual(['examples/codex-native-split-demo.workflow.yaml']);
    expect(parsed.flags.interactive).toBe(true);
    expect(parsed.flags['native-split-terminals']).toBe(true);
  });

  it('parses internal run-codex-node arguments', () => {
    const parsed = parseArgs(['internal', 'run-codex-node', '--run-dir', 'D:\\runs\\demo-1', '--node-id', 'develop']);

    expect(parsed.command).toBe('internal');
    expect(parsed.rest).toEqual(['run-codex-node']);
    expect(parsed.flags['run-dir']).toBe('D:\\runs\\demo-1');
    expect(parsed.flags['node-id']).toBe('develop');
  });

  it('parses native node complete arguments', () => {
    const parsed = parseArgs([
      'node',
      'complete',
      '--run-dir',
      'D:\\runs\\demo-1',
      '--node-id',
      'develop',
      '--summary',
      'done',
    ]);

    expect(parsed.command).toBe('node');
    expect(parsed.rest).toEqual(['complete']);
    expect(parsed.flags['run-dir']).toBe('D:\\runs\\demo-1');
    expect(parsed.flags['node-id']).toBe('develop');
    expect(parsed.flags.summary).toBe('done');
  });
});
