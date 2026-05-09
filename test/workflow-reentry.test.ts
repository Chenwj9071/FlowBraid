import { describe, expect, it } from 'vitest';
import { parseWorkflowText, validateWorkflow, WorkflowError } from '../src/workflow.js';

describe('workflow reentry validation', () => {
  it('accepts supported codex reentry modes', () => {
    const workflow = parseWorkflowText(`
id: workflow-reentry-valid
start: develop
nodes:
  develop:
    type: codex
    prompt: implement
    reentry:
      mode: resume
    next: done
  done:
    type: end
`);

    expect(() => validateWorkflow(workflow)).not.toThrow();
    (workflow.nodes.develop as { reentry?: { mode?: string } }).reentry = { mode: 'new_with_history' };
    expect(() => validateWorkflow(workflow)).not.toThrow();
    (workflow.nodes.develop as { reentry?: { mode?: string } }).reentry = { mode: 'new' };
    expect(() => validateWorkflow(workflow)).not.toThrow();
  });

  it('rejects unsupported codex reentry mode', () => {
    const workflow = parseWorkflowText(`
id: workflow-reentry-invalid
start: develop
nodes:
  develop:
    type: codex
    prompt: implement
    reentry:
      mode: unsupported
    next: done
  done:
    type: end
`);

    expect(() => validateWorkflow(workflow)).toThrow(WorkflowError);
  });
});

