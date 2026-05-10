# Workflow Recovery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 FlowBraid 增加 `flowbraid recover <run-dir>`，用于恢复异常中断后的 workflow run，并在不确定场景下提供人工恢复确认。

**Architecture:** 新增 `recovery` 层负责诊断和恢复动作，CLI 只负责入口与交互，现有 `engine` 仅补最小辅助方法以复用既有调度逻辑。正常 `run/resume/send` 语义不变。

**Tech Stack:** Node.js, TypeScript, Vitest

---

### Task 1: 扩展类型与恢复状态字段

**Files:**
- Modify: `src/types.ts`
- Test: `test/recovery-engine.test.ts`

**Step 1: Write the failing test**

为 `RunState` 恢复字段增加读写断言，覆盖：
- `recoveryCount`
- `recoveryState`
- `recoveryTargetNodeId`
- `recoveryTargetAttemptId`
- `recoverySuggestedAction`

**Step 2: Run test to verify it fails**

Run: `npm test -- test/recovery-engine.test.ts`
Expected: FAIL because recovery fields/types do not exist.

**Step 3: Write minimal implementation**

在 `src/types.ts` 为 `RunState` 增加恢复字段类型。

**Step 4: Run test to verify it passes**

Run: `npm test -- test/recovery-engine.test.ts`
Expected: PASS

### Task 2: 新增恢复诊断模块

**Files:**
- Create: `src/recovery.ts`
- Test: `test/recovery-engine.test.ts`

**Step 1: Write the failing test**

覆盖恢复诊断输出：
- paused gate => `resume_paused`
- native split codex with completed runtime-state => `finalize_then_continue`
- native split codex with sessionId => `resume_codex_session`
- shell interrupted => `confirm_recovery`

**Step 2: Run test to verify it fails**

Run: `npm test -- test/recovery-engine.test.ts`
Expected: FAIL because `src/recovery.ts` does not exist.

**Step 3: Write minimal implementation**

在 `src/recovery.ts` 实现：
- 读取 manifest/runState/timeline/node state
- 恢复判定枚举
- 诊断结果结构

**Step 4: Run test to verify it passes**

Run: `npm test -- test/recovery-engine.test.ts`
Expected: PASS

### Task 3: 为 engine 增加最小恢复执行辅助方法

**Files:**
- Modify: `src/engine.ts`
- Test: `test/recovery-engine.test.ts`

**Step 1: Write the failing test**

覆盖：
- 从当前节点 retry 生成新 attempt
- 从指定 next node 继续 runLoop
- 已终态节点补 run 收尾后继续

**Step 2: Run test to verify it fails**

Run: `npm test -- test/recovery-engine.test.ts`
Expected: FAIL because engine lacks recovery helper methods.

**Step 3: Write minimal implementation**

在 `src/engine.ts` 增加可复用入口，例如：
- `restartCurrentNode(...)`
- `continueFromNode(...)`
- `resumeCompletedNodeOutcome(...)`

尽量复用现有 `runLoop`，避免复制调度逻辑。

**Step 4: Run test to verify it passes**

Run: `npm test -- test/recovery-engine.test.ts`
Expected: PASS

### Task 4: 实现 recover CLI 命令

**Files:**
- Modify: `src/cli.ts`
- Test: `test/recovery-cli.test.ts`

**Step 1: Write the failing test**

覆盖：
- `flowbraid recover <run-dir>` usage
- paused run recover
- confirmation required 时交互/参数行为
- `continue-next` / `fail-run` 缺少 message 报错

**Step 2: Run test to verify it fails**

Run: `npm test -- test/recovery-cli.test.ts`
Expected: FAIL because CLI has no `recover`.

**Step 3: Write minimal implementation**

在 `src/cli.ts`：
- 增加 usage
- 新增 `recover` 分支
- 增加人工恢复决策 prompt

**Step 4: Run test to verify it passes**

Run: `npm test -- test/recovery-cli.test.ts`
Expected: PASS

### Task 5: 审计事件与恢复决策持久化

**Files:**
- Modify: `src/recovery.ts`
- Test: `test/recovery-engine.test.ts`

**Step 1: Write the failing test**

断言恢复动作写入：
- `run.recovery.detected`
- `run.recovery.decision`
- 相关 comment / nodeId / attemptId / targetNodeId

**Step 2: Run test to verify it fails**

Run: `npm test -- test/recovery-engine.test.ts`
Expected: FAIL because events are missing.

**Step 3: Write minimal implementation**

在恢复执行路径中补 events 写入，保证人工恢复可审计。

**Step 4: Run test to verify it passes**

Run: `npm test -- test/recovery-engine.test.ts`
Expected: PASS

### Task 6: 文档更新

**Files:**
- Modify: `doc/progress.md`
- Modify: `doc/requirements.md`
- Modify: `doc/architecture.md`
- Modify: `doc/workflow-authoring.md`

**Step 1: Write minimal doc updates**

补充：
- `recover` 命令语义
- 恢复策略边界
- 人工恢复确认动作

**Step 2: Verify docs are consistent**

人工检查文档术语：
- `resume`
- `recover`
- `send`

Expected: no conflicts.

### Task 7: 全量验证

**Files:**
- No code changes expected

**Step 1: Run focused tests**

Run: `npm test -- test/recovery-engine.test.ts test/recovery-cli.test.ts`
Expected: PASS

**Step 2: Run related regression tests**

Run: `npm test -- test/interactive-mode-selection.test.ts test/native-split-engine.test.ts test/agent-session.test.ts test/e2e.workflow.test.ts`
Expected: PASS

**Step 3: Run repo checks**

Run: `npm run check`
Expected: PASS

**Step 4: Run full test suite**

Run: `npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/cli.ts src/engine.ts src/recovery.ts src/types.ts test/recovery-engine.test.ts test/recovery-cli.test.ts doc/progress.md doc/requirements.md doc/architecture.md doc/workflow-authoring.md docs/superpowers/specs/2026-05-10-workflow-recovery-design.md docs/plans/2026-05-10-workflow-recovery.md
git commit -m "add workflow recovery flow"
```
