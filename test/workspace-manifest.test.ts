import path from 'node:path';
import os from 'node:os';
import { access, mkdtemp } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createRunWorkspace } from '../src/workspace.js';

describe('workspace 初始化', () => {
  it('创建 run workspace 后必须立即落盘 manifest.json', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'flowbraid-workspace-manifest-'));
    const workflow = {
      id: 'manifest-check',
      start: 'done',
      nodes: {
        done: {
          type: 'end' as const,
          message: 'done',
        },
      },
      filePath: '<memory>',
      directory: tempRoot,
    };

    const workspace = await createRunWorkspace(tempRoot, workflow);
    await expect(access(workspace.manifestPath)).resolves.toBeUndefined();
  });
});
