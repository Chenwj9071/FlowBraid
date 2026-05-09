# Native Split 协议收口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 native split 的节点-主进程通信收口为显式的 `attemptId + runtime-state + outcome` 协议，减少旧兼容路径对主流程的干扰。

**Architecture:** 保持现有运行模型不变，只收紧节点 CLI 协议边界：节点命令必须绑定当前 attempt，`complete` 必须显式携带 `outcome`。调度器继续优先读取 `runtime-state.json`，旧 `review/verdict` 仅保留兼容读路径，不参与主路径约束。

**Tech Stack:** Node.js, TypeScript, Vitest, FlowBraid CLI / workflow runtime

---

### Task 1: 收紧节点 CLI 协议

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/types.ts`（如需补充更明确的运行态类型约束）

- [ ] **Step 1: 让失败用例先暴露协议缺口**

```ts
// test/native-node-cli.test.ts 里现有用法会缺少 attempt-id / outcome
// 这里先按“必须显式传参”的目标，确保旧调用会失败
expect(async () =>
  cliMain(['node', 'complete', '--run-dir', runDir, '--node-id', 'develop'])
).rejects.toThrow(/--outcome/);
```

- [ ] **Step 2: 修改 CLI 协议边界**

```ts
function requireFlag(flags: Record<string, string | boolean>, name: string): string {
  const value = flags[name];
  if (!value) throw new Error(`node command requires --${name}`);
  return String(value);
}

case 'complete': {
  const attemptId = requireFlag(flags, 'attempt-id');
  const outcome = requireFlag(flags, 'outcome');
  ...
}
```

- [ ] **Step 3: 让 `start|fail|pause|artifact|heartbeat` 也显式绑定 attempt**

```ts
const attemptId = requireFlag(flags, 'attempt-id');
```

- [ ] **Step 4: 运行 TypeScript 编译确认没有类型漂移**

Run: `npm run check`
Expected: exit code `0`

---

### Task 2: 更新测试与示例协议

**Files:**
- Modify: `test/native-node-cli.test.ts`
- Modify: `test/codex-native-split-demo.test.ts`
- Modify: `test/native-split-prompt.test.ts`
- Modify: `examples/codex-native-split-demo.workflow.yaml`
- Modify: `doc/workflow-authoring.md`
- Modify: `doc/architecture.md`

- [ ] **Step 1: 把测试改成显式传 `--attempt-id` / `--outcome`**

```ts
await cliMain([
  'node',
  'complete',
  '--run-dir',
  runDir,
  '--node-id',
  'develop',
  '--attempt-id',
  'attempt-develop-1',
  '--outcome',
  'success',
  '--summary',
  'done',
]);
```

- [ ] **Step 2: 让 native split 示例的说明更明确**

```yaml
prompt: |
  Treat runtime-state plus outcome as the source of truth for node completion.
  Always report the final state with `flowbraid node complete --attempt-id <current attempt> --outcome ...`.
```

- [ ] **Step 3: 把文档里的主路径措辞收紧**

```md
- `complete` 必须带 `--outcome`
- 所有 node CLI 命令必须带当前 `attemptId`
- `review/verdict` 仅保留兼容层说明
```

- [ ] **Step 4: 运行聚焦测试**

Run: `npm test -- test/native-node-cli.test.ts test/native-split-prompt.test.ts test/codex-native-split-demo.test.ts`
Expected: 全部通过

---

### Task 3: 亲自跑示例并做回归确认

**Files:**
- No code changes unless验证暴露问题

- [ ] **Step 1: 跑 native split 示例或等价端到端路径**

Run: `npm run demo:native-split`
Expected: workflow 跑通到结束，或在当前环境缺少外部 `codex` 时，使用测试桩复现并定位具体失败点

- [ ] **Step 2: 如果示例失败，按根因修复**

```text
先确认失败来自哪一层：
1. CLI 入参是否缺失
2. runtime-state 是否没写对
3. attemptId 是否串了
4. scheduler 是否还在读旧 verdict
```

- [ ] **Step 3: 跑全量测试和检查**

Run: `npm test`
Run: `npm run check`
Expected: 全部通过

- [ ] **Step 4: 记录最终结果并提交**

```bash
git status --short
git add -A
git commit -m "feat: tighten native split node protocol"
```

