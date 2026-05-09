import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isCliDirectExecution } from '../src/cli.js';

describe('cli entrypoint detection', () => {
  it('treats different paths to the same file as direct execution', () => {
    const realScriptPath = path.resolve('dist/src/cli.js');
    const linkedScriptPath = path.join(
      'C:\\Users\\Dennis\\AppData\\Roaming\\npm\\node_modules\\flowbraid',
      'dist',
      'src',
      'cli.js',
    );

    const result = isCliDirectExecution({
      entryScript: linkedScriptPath,
      moduleUrl: new URL(`file:///${realScriptPath.replace(/\\/g, '/')}`).href,
      realPathResolver: (candidate) => {
        const normalized = path.resolve(candidate);
        if (normalized === path.resolve(linkedScriptPath)) {
          return path.resolve(realScriptPath);
        }
        return normalized;
      },
    });

    expect(result).toBe(true);
  });

  it('returns false when the entry script points to a different file', () => {
    const result = isCliDirectExecution({
      entryScript: path.resolve('dist/src/other.js'),
      moduleUrl: new URL(`file:///${path.resolve('dist/src/cli.js').replace(/\\/g, '/')}`).href,
      realPathResolver: (candidate) => path.resolve(candidate),
    });

    expect(result).toBe(false);
  });
});
