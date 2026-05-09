import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('package CLI metadata', () => {
  it('exposes the flowbraid binary entry', async () => {
    const packageJsonPath = path.resolve(process.cwd(), 'package.json');
    const raw = await readFile(packageJsonPath, 'utf8');
    const parsed = JSON.parse(raw) as {
      name?: string;
      bin?: Record<string, string>;
    };

    expect(parsed.name).toBe('flowbraid');
    expect(parsed.bin).toBeDefined();
    expect(parsed.bin?.flowbraid).toBe('./dist/src/cli.js');
  });
});
