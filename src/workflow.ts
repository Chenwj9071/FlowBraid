import { readFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { WorkflowDefinition, WorkflowNodeDefinition, WorkflowSourceMeta } from './types.js';

export class WorkflowError extends Error {}

export async function loadWorkflowFile(filePath: string): Promise<WorkflowDefinition & WorkflowSourceMeta> {
  const raw = await readFile(filePath, 'utf8');
  const parsed = parseWorkflowText(raw, filePath);
  return validateWorkflow(parsed, { filePath, directory: path.dirname(filePath) });
}

export function parseWorkflowText(raw: string, filePath = '<memory>'): WorkflowDefinition {
  const lower = filePath.toLowerCase();
  let data: unknown;

  if (lower.endsWith('.json')) {
    data = JSON.parse(raw);
  } else if (lower.endsWith('.yaml') || lower.endsWith('.yml')) {
    data = YAML.parse(raw);
  } else {
    try {
      data = JSON.parse(raw);
    } catch {
      data = YAML.parse(raw);
    }
  }

  if (!data || typeof data !== 'object') {
    throw new WorkflowError('workflow 文件内容必须是对象');
  }

  return data as WorkflowDefinition;
}

export function validateWorkflow(
  workflow: WorkflowDefinition,
  source?: WorkflowSourceMeta,
): WorkflowDefinition & WorkflowSourceMeta {
  if (!workflow || typeof workflow !== 'object') {
    throw new WorkflowError('workflow 必须是对象');
  }
  if (typeof workflow.id !== 'string' || workflow.id.trim() === '') {
    throw new WorkflowError('workflow.id 必须是非空字符串');
  }
  if (typeof workflow.start !== 'string' || workflow.start.trim() === '') {
    throw new WorkflowError('workflow.start 必须是非空字符串');
  }
  if (!workflow.nodes || typeof workflow.nodes !== 'object') {
    throw new WorkflowError('workflow.nodes 必须是对象');
  }

  const nodeIds = Object.keys(workflow.nodes);
  if (nodeIds.length === 0) {
    throw new WorkflowError('workflow.nodes 不能为空');
  }
  if (!workflow.nodes[workflow.start]) {
    throw new WorkflowError(`起始节点不存在: ${workflow.start}`);
  }

  for (const [nodeId, node] of Object.entries(workflow.nodes)) {
    validateNode(nodeId, node);
  }

  for (const [nodeId, node] of Object.entries(workflow.nodes)) {
    for (const target of collectTransitions(node)) {
      if (!workflow.nodes[target]) {
        throw new WorkflowError(`节点 ${nodeId} 引用了不存在的下一跳: ${target}`);
      }
    }
  }

  return {
    ...workflow,
    filePath: source?.filePath ?? '<memory>',
    directory: source?.directory ?? process.cwd(),
  };
}

function validateNode(nodeId: string, node: WorkflowNodeDefinition): void {
  if (!node || typeof node !== 'object') {
    throw new WorkflowError(`节点 ${nodeId} 必须是对象`);
  }
  if (node.id && node.id !== nodeId) {
    throw new WorkflowError(`节点 ${nodeId} 的 id 字段必须与键名一致`);
  }
  if (node.type !== 'shell' && node.type !== 'gate' && node.type !== 'end') {
    throw new WorkflowError(`节点 ${nodeId} 的 type 不合法: ${String((node as { type?: string }).type)}`);
  }
  if (node.type === 'shell' && (typeof node.command !== 'string' || node.command.trim() === '')) {
    throw new WorkflowError(`shell 节点 ${nodeId} 必须提供 command`);
  }
}

function collectTransitions(node: WorkflowNodeDefinition): string[] {
  const targets = new Set<string>();
  if (typeof node.next === 'string' && node.next.trim()) {
    targets.add(node.next);
  }
  if (node.transitions) {
    for (const value of Object.values(node.transitions)) {
      if (typeof value === 'string' && value.trim()) {
        targets.add(value);
      }
    }
  }
  return [...targets];
}

export function resolveNodeNext(node: WorkflowNodeDefinition, outcome: 'success' | 'failure' | 'default' = 'default'): string | null {
  const map = node.transitions ?? {};
  if (outcome === 'success' && typeof map.success === 'string') {
    return map.success;
  }
  if (outcome === 'failure' && typeof map.failure === 'string') {
    return map.failure;
  }
  if (typeof map.default === 'string') {
    return map.default;
  }
  if (typeof node.next === 'string') {
    return node.next;
  }
  return null;
}

