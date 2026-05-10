import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('workflow authoring doc', () => {
  it('keeps the workflow-help entry note near the top and out of the tail section', () => {
    const text = readFileSync('doc/workflow-authoring.md', 'utf8');
    const lines = text.split(/\r?\n/);
    const note = '可以先运行 `flowbraid workflow-help` 获取简化版的工作流编写说明；如需完整字段、语义和示例，再继续阅读本文。';
    const noteIndex = lines.findIndex((line) => line.includes(note));

    expect(noteIndex).toBeGreaterThanOrEqual(0);
    expect(noteIndex).toBeLessThan(12);
    expect(lines.slice(-5).join('\n')).not.toContain('鍙互鍏堣繍琛');
  });
});
