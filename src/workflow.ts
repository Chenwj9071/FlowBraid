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
  if (workflow.workdir !== undefined && (typeof workflow.workdir !== 'string' || workflow.workdir.trim() === '')) {
    throw new WorkflowError('workflow.workdir 必须是非空字符串');
  }
  if (workflow.contextDir !== undefined && (typeof workflow.contextDir !== 'string' || workflow.contextDir.trim() === '')) {
    throw new WorkflowError('workflow.contextDir 必须是非空字符串');
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
  if (
    node.type !== 'shell' &&
    node.type !== 'gate' &&
    node.type !== 'approval' &&
    node.type !== 'codex' &&
    node.type !== 'agent_session' &&
    node.type !== 'end'
  ) {
    throw new WorkflowError(`节点 ${nodeId} 的 type 不合法: ${String((node as { type?: string }).type)}`);
  }
  if ('cwd' in node && node.cwd !== undefined && (typeof node.cwd !== 'string' || node.cwd.trim() === '')) {
    throw new WorkflowError(`节点 ${nodeId} 的 cwd 必须是非空字符串`);
  }
  if ('workdir' in node && node.workdir !== undefined && (typeof node.workdir !== 'string' || node.workdir.trim() === '')) {
    throw new WorkflowError(`节点 ${nodeId} 的 workdir 必须是非空字符串`);
  }
  if ('contextDir' in node && node.contextDir !== undefined && (typeof node.contextDir !== 'string' || node.contextDir.trim() === '')) {
    throw new WorkflowError(`节点 ${nodeId} 的 contextDir 必须是非空字符串`);
  }

  if (node.type === 'shell' && (typeof node.command !== 'string' || node.command.trim() === '')) {
    throw new WorkflowError(`shell 节点 ${nodeId} 必须提供 command`);
  }
  if (node.type === 'codex') {
    if (typeof node.prompt !== 'string' || node.prompt.trim() === '') {
      throw new WorkflowError(`codex 节点 ${nodeId} 必须提供非空 prompt`);
    }
    if (
      node.reentry &&
      node.reentry.mode !== undefined &&
      node.reentry.mode !== 'resume' &&
      node.reentry.mode !== 'new_with_history' &&
      node.reentry.mode !== 'new'
    ) {
      throw new WorkflowError(`codex 节点 ${nodeId} 的 reentry.mode 只能是 resume、new_with_history 或 new`);
    }
  }
  if (node.type === 'agent_session') {
    if (node.provider !== 'codex') {
      throw new WorkflowError(`agent_session 节点 ${nodeId} 当前仅支持 provider=codex`);
    }
    if (typeof node.prompt !== 'string' || node.prompt.trim() === '') {
      throw new WorkflowError(`agent_session 节点 ${nodeId} 必须提供非空 prompt`);
    }
  }
  if (node.type === 'approval') {
    const approve = node.transitions?.approve;
    const reject = node.transitions?.reject;
    if (typeof approve !== 'string' || approve.trim() === '' || typeof reject !== 'string' || reject.trim() === '') {
      throw new WorkflowError(`approval 节点 ${nodeId} 必须提供 transitions.approve 和 transitions.reject`);
    }
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

export function resolveApprovalNext(node: WorkflowNodeDefinition, decision: 'approve' | 'reject'): string | null {
  const map = node.transitions ?? {};
  if (decision === 'approve' && typeof map.approve === 'string') {
    return map.approve;
  }
  if (decision === 'reject' && typeof map.reject === 'string') {
    return map.reject;
  }
  return null;
}

export function resolveNodeTransition(node: WorkflowNodeDefinition, keys: string[]): string | null {
  const map = node.transitions ?? {};
  for (const key of keys) {
    const target = map[key];
    if (typeof target === 'string') {
      return target;
    }
    if (target === null) {
      return null;
    }
  }
  return resolveNodeNext(node, 'default');
}
