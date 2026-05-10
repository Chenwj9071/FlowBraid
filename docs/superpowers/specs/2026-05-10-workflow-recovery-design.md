# Workflow Recovery Design

**Date:** 2026-05-10

## Goal

为 FlowBraid 增加 `flowbraid recover <run-dir>` 能力，用于在主调度器被中断、终端误关或主进程异常退出后，基于已落盘运行态恢复整个 workflow run。

恢复目标不是承诺“任何节点都能无损从进程中途继续”，而是：

- 能证明节点已经终态时，补 run 收尾并继续
- 能证明 native split `codex` 会话可恢复时，优先恢复该会话
- 其他不确定场景进入人工恢复确认

## Non-Goals

- 不修改现有 `flowbraid resume` 的语义
- 不修改现有 `flowbraid send` 的语义
- 不动态改写 workflow 图定义
- 不支持 PTY `codex` 进程级重连
- 不支持 `shell` 进程级重连
- 不支持任意节点跳转恢复

## Existing Context

当前已有以下恢复基础：

- `state/run.json` 持久化 run 状态、当前节点、待继续节点、当前 attempt
- `state/timeline.json` 持久化节点进入/结束时间线
- `nodes/<node-id>/status.json` 持久化节点级状态摘要
- `nodes/<node-id>/state/runtime-state.json` 持久化任务节点终态真源
- `nodes/<node-id>/state/native-session.json` 持久化 native split `codex` 会话信息
- native split `codex` 已支持基于落盘 `sessionId` 走 `codex resume <sessionId>`

当前缺失的是“异常中断后的 run 级恢复入口与恢复决策状态机”。

## CLI Design

新增命令：

```text
flowbraid recover <run-dir> [--decision retry-current|continue-next|fail-run] [--message <text>] [--codex-command <cmd>] [--pty]
```

命令语义：

- `recover` 专门处理异常中断后的 run 恢复
- 如果 run 只是正常 `paused`，`recover` 会委托到现有 `resume` 或提示改用 `send`
- 如果当前场景需要人工恢复确认：
  - 未传 `--decision` 且当前是 TTY 时，交互询问恢复动作
  - 非 TTY 下要求显式传 `--decision`
- `continue-next` 和 `fail-run` 要求 `--message`，用于审计

## Recovery Model

恢复入口先做诊断，再执行动作。诊断结果分为五类：

1. `resume_paused`
2. `finalize_then_continue`
3. `resume_codex_session`
4. `confirm_recovery`
5. `fail_unrecoverable`

### 1. `resume_paused`

适用场景：

- `run.status === paused`
- 当前节点是 `gate`
- 当前节点是 `approval`
- 当前节点是 `agent_session` 且 `session.json.status === waiting_input`

动作：

- `gate` / `approval`：走现有 `resumeWorkflow`
- `agent_session waiting_input`：提示用户使用 `send`，或在交互式 `recover` 中直接委托到 `send`

### 2. `finalize_then_continue`

适用场景：

- `run.status === running` 或 `failed`
- 当前节点存在
- 该节点的 `runtime-state` / `native-session` / `status.json` 能证明该 attempt 已经终态
- 只是 run 没来得及完成主调度收尾

动作：

- 基于已落盘节点终态补写 run/timeline/events
- 如果节点终态对应后继节点，则继续调度
- 如果节点已经是终点，则完成 run

### 3. `resume_codex_session`

适用场景：

- 当前节点是 native split `codex`
- 存在落盘 `sessionId`
- 恢复策略允许走会话恢复

动作：

- 使用新的 attempt 重新进入同一 `codex` 节点
- prompt 标记为 re-entry
- 执行 `codex resume <sessionId> ...`

说明：

- 这是“整个 workflow 恢复”中的一个节点级恢复子策略
- 不尝试接管旧主进程，只重新启动新的调度器和新的节点 attempt

### 4. `confirm_recovery`

适用场景：

- `shell` 节点执行中断
- PTY `codex` 节点执行中断
- `agent_session` 正在 turn 处理中断
- native split `codex` 缺少 `sessionId`
- native split `codex` 虽有 `sessionId` 但恢复条件不足或恢复失败
- 其他无法自动判定“重试还是放行”的情况

人工恢复动作固定为：

- `retry-current`
- `continue-next`
- `fail-run`

动作语义：

- `retry-current`
  - 对当前节点创建新 attempt
  - 保留旧 attempt 时间线
  - 从当前节点重跑

- `continue-next`
  - 把当前节点标记为“人工恢复放行”
  - 直接进入该节点原本的 success/default 后继
  - 必须写审计事件，不能伪装成节点自然成功

- `fail-run`
  - 明确将 run 标记为失败
  - 写入人工恢复决策事件

### 5. `fail_unrecoverable`

适用场景：

- `run.json` 与 `timeline.json` 严重不一致
- 当前节点不存在
- 当前节点没有可用状态信息，且无法安全推断下一步

动作：

- 直接报错
- 不隐式更改 run

## State Additions

为最小化侵入，保持 `RunStatus` 不变，仅在 `RunState` 增加：

- `recoveryCount?: number`
- `recoveryState?: 'idle' | 'awaiting_decision'`
- `recoveryTargetNodeId?: string | null`
- `recoveryTargetAttemptId?: string | null`
- `recoverySuggestedAction?: 'resume' | 'retry-current' | 'continue-next' | 'fail-run' | null`

这些字段只服务于恢复流程，不影响现有 `run/resume/send` 主路径。

## Eventing And Audit

恢复流程新增事件写入 `messages/events.jsonl`：

- `run.recovery.detected`
- `run.recovery.resume_paused`
- `run.recovery.finalize_then_continue`
- `run.recovery.resume_codex_session`
- `run.recovery.confirmation_required`
- `run.recovery.decision`
- `run.recovery.failed`

人工动作还应包含：

- `decision`
- `comment`
- `nodeId`
- `attemptId`
- `targetNodeId`

## Timeline Rules

- `retry-current` 必须生成新的 `attemptId`
- 历史 attempt 不修改、不覆盖
- `continue-next` 不新增“伪造的节点成功 attempt”
- `continue-next` 通过事件审计体现人为放行

## Node-Type Recovery Policy

### gate

- 若 run 已 paused：直接按原语义恢复
- 若 run 显示 running 但节点状态已 paused：补 run paused，再恢复

### approval

- 若 run 已 paused：继续等待 `approve/reject`
- 若 run 显示 running 但节点状态已 paused：补 run paused，再恢复

### agent_session

- 若 `session.json.status === waiting_input`：不做自动 turn 恢复，转入等待输入语义
- 若中断发生在 turn 执行中：进入人工恢复确认

### codex native split

- 若 `runtime-state` 已终态：补收尾并继续
- 若已落盘 `sessionId`：优先尝试会话恢复
- 否则进入人工恢复确认

### codex PTY

- 不做会话接管
- 默认进入人工恢复确认

### shell

- 不做进程接管
- 默认进入人工恢复确认

## Implementation Shape

建议新增恢复层，而不是大改现有 `resume`：

- `src/recovery.ts`
  - 恢复诊断
  - 恢复动作执行
  - 审计事件写入

`src/engine.ts` 只补最小辅助能力：

- 从当前节点重新启动新 attempt
- 从指定 next node 继续 runLoop
- 对已终态节点执行“补收尾继续”

`src/cli.ts` 只增加：

- `recover` 命令解析
- 恢复交互提示
- 使用说明更新

## Testing Scope

一期至少覆盖：

1. `gate` paused run 的 recover
2. `approval` paused run 的 recover
3. `agent_session waiting_input` 的 recover 行为
4. native split `codex` 已终态未收尾的 recover
5. native split `codex` 基于已落盘 `sessionId` 的 recover
6. 人工恢复确认：
   - `retry-current`
   - `continue-next`
   - `fail-run`
7. `events.jsonl` 审计事件正确
8. `timeline.json` 中 retry 产生新 attempt

## Reliability Notes

- 恢复优先保证“可解释、可审计”，不是“尽量自动猜”
- 对做不到无损恢复的节点类型，明确降级为人工确认
- 保持正常主路径不变，避免引入现有 `run/resume/send` 回归风险
