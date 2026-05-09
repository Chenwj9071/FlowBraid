# FlowBraid 控制通道重构方案 v3

## 文档目的
本文定义 FlowBraid 控制通道重构的第三版正式方案。v3 的目标不是继续扩展抽象，而是收敛为一套可以直接落地实现的、闭合的运行时协议：节点如何上报、主进程如何接受、什么是唯一真源、如何恢复、如何回流、如何处理 native split 与 PTY。

## 设计结论
v3 的核心结论只有五条：

1. 唯一持久真源是 `nodes/<node-id>/state/control-log.jsonl`
2. 只有 `scheduler` 进程可以 append 真源日志
3. 所有节点上报路径都只能向 `scheduler` 提交候选事件，不能直接写真源
4. ACK 定义为真源 durable append 成功，不依赖派生视图写入成功
5. `runtime-state.json`、`events.jsonl`、`timeline.json` 全部是派生视图

这五条是 v3 的不可退让边界。

## 背景
当前系统的 `codex` 节点终态主要通过：

- `flowbraid node complete --run-dir ... --node-id ... --attempt-id ...`
- `flowbraid node fail --run-dir ... --node-id ... --attempt-id ...`

来回写节点运行态和事件流。该方案已经可用，但它仍然存在以下根本缺陷：

1. 节点需要通过 shell 命令拼装协议参数，调用脆弱。
2. `runtime-state.json` 既像状态快照，又承担事实真源角色，恢复边界不清晰。
3. `events.jsonl`、`timeline.json` 与 `runtime-state.json` 是并行写入，存在真源分叉风险。
4. `attemptId` 只被用作现象级隔离，还没有成为协议级边界。
5. native split、PTY、resume/reentry、`sessionId` 恢复还没有统一纳入一套闭合状态机。

## v3 要解决的核心问题

### 1. 写入权必须唯一
真源日志只能由当前 run 的 `scheduler` 进程写入。

这意味着以下路径都不能直接 append `control-log.jsonl`：
- `flowbraid node complete|fail|pause`
- `flowbraid-agent`
- native split sidecar
- fallback outbox 回放器

它们只能提交候选事件，由 `scheduler` 统一裁决、去重、落盘。

### 2. ACK 必须绑定 durable append
ACK 不是“收到消息”，也不是“更新了派生快照”，而是：

- `control-log.jsonl` append 成功
- 数据已 flush 到 durable 边界

只有在这一条件满足后，`scheduler` 才可以向 sender 返回正式 ACK。

### 3. 去重必须有稳定操作标识
v3 不接受“payload hash + timestamp bucket”一类启发式去重。

每次 sender 提交候选事件时，必须提供：
- `operationId`

它是 sender 侧生成的稳定标识，用于：
- IPC 重试幂等
- outbox 回放幂等
- 双通道重复送达裁决
- 晚到旧消息过滤

### 4. `pause -> resume` 必须闭合旧 attempt
v3 保留“resume 一律新 attempt”的方向，但旧 attempt 不能悬挂在 `paused`。

当新的 reentry attempt 被建立时，旧 attempt 必须显式收口为：
- `superseded`

这样才能避免：
- timeline 永久悬挂
- currentAttemptId 与历史 attempt 语义冲突
- 审计中出现多个同时活跃的同节点 attempt

### 5. `orphaned` 不能抢跑真实终态
`orphaned` 只允许在以下顺序后合成：

1. drain 当前 attempt 的 fallback outbox
2. 等待定义好的宽限期
3. 再确认 provider / terminal / session 已不可恢复
4. 追加 `recovery-synthesized orphaned`

如果宽限期内收到真实 `complete/fail/pause`，则真实事件优先，禁止合成 orphaned。

## 目标

### 功能目标
- 节点可以主动报告 `complete`、`fail`、`pause`、`artifact`
- 主进程可以主动检测异常退出、会话中断和窗口关闭
- 主进程崩溃重启后可只靠真源日志恢复节点认知
- PTY 和 native split 都能被纳入可验证的运行时协议
- 兼容 CLI 路径可以逐步迁移而不破坏现有示例

### 非功能目标
- 不解析自然语言推断终态
- 不把控制协议混进 stdout/stderr
- 不要求 agent 本体承担周期性心跳
- 不强行用统一宿主抽象覆盖 PTY 与 native split

## 真源与派生视图

### 唯一真源
- `nodes/<node-id>/state/control-log.jsonl`

这是 node 级 append-only 真源日志，不是 attempt 单文件。每个节点的多轮 attempt 共享一份真源日志，但每条事件都必须绑定：
- `nodeId`
- `attemptId`
- `operationId`
- `kind`

### 派生视图
以下文件全部改为派生视图：

- `nodes/<node-id>/state/runtime-state.json`
- `messages/events.jsonl`
- `state/timeline.json`

它们都必须可由真源日志重建。

### 派生视图失败策略
真源日志 append 成功后，即使派生视图更新失败：
- 该事件仍然被视为已接受
- `scheduler` 需要记录派生更新失败
- 恢复或后续重建时重新生成派生视图

派生失败不能回滚真源，也不能撤销 ACK。

## 事件模型

### 真源事件结构
建议结构如下：

```json
{
  "version": 1,
  "eventId": "evt_01",
  "operationId": "op_123",
  "runId": "run_01",
  "nodeId": "develop",
  "attemptId": "att_01",
  "source": "ipc",
  "kind": "complete",
  "at": "2026-05-08T10:15:00.000Z",
  "payload": {
    "outcome": "approve",
    "summary": "approved"
  }
}
```

### 最小事件全集
v3 要求支持以下最小事件集：

- `attempt.started`
- `pause`
- `complete`
- `fail`
- `artifact`
- `attempt.superseded`
- `recovery.orphaned`

注意：
- `attempt.started` 必须显式写入真源
- `attempt.superseded` 是 `pause -> 新 attempt` 的闭口事件
- `recovery.orphaned` 是合成事件，不是节点主动上报

### 生产者职责
- `scheduler`
  - append 真源日志
  - 生成 `eventId`
  - 追加 `attempt.started`
  - 追加 `attempt.superseded`
  - 追加 `recovery.orphaned`
- sender
  - 提供 `operationId`
  - 提交候选事件

sender 不能自己生成真源事件。

## 候选事件提交流程

### sender 类型
候选事件可以来自：

- `flowbraid-agent`
- `flowbraid node complete|fail|pause`
- native split sidecar
- fallback outbox 回放器

### 提交流程
统一流程如下：

1. sender 生成 `operationId`
2. sender 构造候选事件
3. sender 通过 IPC 或 fallback outbox 提交给 `scheduler`
4. `scheduler` 校验当前 `runId/nodeId/attemptId`
5. `scheduler` 去重并裁决
6. `scheduler` append 真源日志
7. `scheduler` 更新派生视图
8. `scheduler` 返回 ACK

### 去重规则
去重键唯一采用：
- `attemptId + operationId`

不再使用启发式 hash 去重。

这意味着：
- sender 在重试时必须复用同一 `operationId`
- outbox 回放必须保留原 `operationId`

## ACK 契约

### ACK 的定义
ACK 表示：
- 该候选事件已经被 `scheduler` 正式接受
- 对应真源事件已经 durable append 到 `control-log.jsonl`

ACK 不表示：
- 派生视图一定已经写成功
- 后续 workflow 一定已经流转完成

### durable append 要求
v3 明确要求：
- append 后必须执行 durable flush
- 如果 durable flush 失败，则不能返回 ACK

Windows 与 macOS/Linux 的具体落盘实现可不同，但语义必须一致。

## `runtime-state.json` 派生规则

### 定位
`runtime-state.json` 是当前 node 最新 attempt 的快照，不再是真源。

### 最小字段
- `nodeId`
- `attemptId`
- `status`
- `outcome`
- `summary`
- `reason`
- `error`
- `updatedAt`
- `completedAt`

### 派生方式
从真源日志重放后，选择最新有效 attempt 的最新状态事件构建。

## `timeline.json` 派生规则

### 定位
`timeline.json` 是调度展示视图，不是运行真源。

### 关键要求
每个 attempt 在 timeline 中必须有明确生命周期：
- `started`
- `paused`
- `superseded`
- `completed`
- `failed`
- `orphaned`

这意味着 `pause -> 新 attempt` 时：
- 旧 attempt 不能永远停留在 `paused`
- 必须显式追加 `attempt.superseded`

## `pause/resume/reentry` 规则

### `pause`
`pause` 事件表示：
- 当前 attempt 暂停等待
- 当前 attempt 仍是活跃 attempt

### `resume`
v3 继续规定：
- `resume` 一律创建新 `attemptId`

但新增收口规则：
- 在新 attempt `attempt.started` 写入真源之前，必须先对旧 attempt 写入 `attempt.superseded`

### `reentry.mode`
`reentry.mode` 的 provider 语义与 attempt 语义显式拆开：

- `resume`
  - provider 会尽量恢复旧会话
  - FlowBraid 仍创建新 attempt
- `new_with_history`
  - provider 新会话
  - FlowBraid 新 attempt
  - 注入历史上下文
- `new`
  - provider 新会话
  - FlowBraid 新 attempt
  - 不注入历史上下文

## PTY 运行拓扑

### 结构
`scheduler <-> provider child`

控制支路：
`flowbraid-agent -> scheduler IPC`

### 特点
- `scheduler` 直接持有 provider 子进程句柄
- provider 异常退出可以直接作为观测输入
- IPC 是实时层，真源日志是恢复层

### 主路径
PTY 是 v3 第一优先级实现路径。

## native split 运行拓扑

### 结构
`scheduler -> external terminal launcher -> shell/provider session`

控制支路：
- 主路径：`helper -> scheduler IPC`
- 兜底：`helper or sidecar -> control-outbox.jsonl`

### sidecar 的职责
v3 不再把 sidecar 写成抽象口号，而是限定为：

1. 由 launcher 注入到 native split 会话启动脚本中
2. 写入或暴露 `FLOWBRAID_CONTROL_FILE`
3. 提供在窗口内调用 helper 的最小桥接
4. 在 shell/provider 退出时，尽量补写观测性元数据到 outbox

sidecar 不负责：
- 拥有统一宿主语义
- 透传全部终端 IO
- 直接判定 workflow 分支

### sidecar 注入契约
native split 必须明确一条启动契约：
- `scheduler` 生成 bootstrap 脚本或 bootstrap 命令
- launcher 负责在新窗口中先执行 bootstrap，再进入 provider

如果某个终端 launcher 无法提供这条契约，则该 native split 后端不支持 v3 主路径。

## fallback outbox

### 定位
`control-outbox.jsonl` 是候选事件暂存队列，不是真源。

### 关键规则
- outbox 中的记录从未被正式接受
- 只有 `scheduler` 消费并 append 到真源后，事件才成立

### 消费规则
1. 读取 outbox 候选事件
2. 按 `attemptId + operationId` 去重
3. 尝试写入真源
4. 成功后推进消费 offset

### 与 orphaned 的优先级
恢复或收尾时，顺序必须是：

1. 先 drain outbox
2. 再等待宽限期
3. 再探测 provider/session 是否仍可恢复
4. 最后才允许合成 `recovery.orphaned`

## `orphaned` 规则

### 定义
`orphaned` 表示：
- 当前 attempt 没有真实终态
- 当前 attempt 已无法继续确认执行状态

### 合成时机
只有在以下条件同时成立时，`scheduler` 才能追加 `recovery.orphaned`：

1. 真源日志中该 attempt 尚无 `complete/fail`
2. outbox 已 drain
3. 宽限期已过
4. provider/session/terminal 已不可恢复

### late event 裁决
一旦 `recovery.orphaned` 已被追加到真源：
- 后续同 attempt 的真实终态候选事件默认拒绝
- 必须通过人工恢复或新 attempt 继续

所以 orphaned 合成必须足够保守，不能抢跑。

## 通道凭据

### 必要性
单靠 `runId/nodeId/attemptId` 不足以防止旧终端、错节点或同机其他进程误提交当前 attempt 事件。

### v3 要求
每个 attempt 的 `control-channel.json` 必须包含：
- `capabilityToken`

sender 提交候选事件时必须携带它。

`scheduler` 只有在：
- `runId`
- `nodeId`
- `attemptId`
- `capabilityToken`

全部匹配时，才接受候选事件。

## 控制描述文件

### 文件
- `nodes/<node-id>/state/control-channel.json`

### 结构
```json
{
  "version": 1,
  "runId": "run_01",
  "nodeId": "develop",
  "attemptId": "att_01",
  "capabilityToken": "cap_xxx",
  "transport": {
    "ipc": {
      "kind": "named_pipe",
      "endpoint": "\\\\.\\pipe\\flowbraid-run_01-develop-att_01"
    },
    "fallbackOutbox": "D:/.../nodes/develop/state/control-outbox.jsonl"
  },
  "createdAt": "2026-05-08T10:00:00.000Z"
}
```

## 兼容 CLI

### 保留范围
以下命令继续保留：
- `flowbraid node start`
- `flowbraid node complete`
- `flowbraid node fail`
- `flowbraid node pause`
- `flowbraid node artifact`
- `flowbraid node heartbeat`

### 兼容行为
兼容 CLI 不能直接真源写入。它必须改为：
1. 构造候选事件
2. 调用当前 run 的 `scheduler` 接收入口
3. 由 `scheduler` 决定是否 append 真源

如果当前没有活着的 `scheduler`，兼容 CLI 只能写 fallback outbox，不能直写真源。

## 本地安装与 `flowbraid-agent`

### `flowbraid-agent` 的定位
它是给节点 prompt 暴露的短 helper，不是真源写入器。

### 载荷传递
自由文本一律避免直接用 argv 作为主路径，推荐：
- `--message-file`
- `--summary-file`
- `--json-stdin`

固定 outcome 可以保留短枚举参数：
- `flowbraid-agent complete approve`
- `flowbraid-agent complete reject`
- `flowbraid-agent complete success`

## 平台约束

### Windows
- native split 仍依赖外部终端 launcher
- 窗口 PID、shell PID、provider PID 不能混为一个单一真相

### macOS/Linux
- Unix Domain Socket 路径必须走短路径策略
- 不允许直接把 socket endpoint 放在过深的 run 路径下

## 模块拆分建议

### 新增
- `src/control-log.ts`
- `src/control-events.ts`
- `src/control-derived-state.ts`
- `src/control-channel.ts`
- `src/control-dispatch.ts`
- `src/native-split-sidecar.ts`

### 改造
- `src/cli.ts`
  - `node complete/fail/pause/artifact/heartbeat` 改为候选事件入口
- `src/engine.ts`
  - 流转优先读派生自真源的 runtime 状态
- `src/node-runtime.ts`
  - 只保留派生快照读写，不再承担真源语义

## 实现顺序

### 阶段 1：真源落地
- 引入 `control-log.jsonl`
- 只改兼容 CLI 路径
- `runtime-state.json` 改为从真源派生

### 阶段 2：PTY 主路径
- 增加 `flowbraid-agent`
- 增加 IPC 候选事件接收
- PTY 节点 prompt 切换为 helper

### 阶段 3：回流与 attempt 收口
- 引入 `attempt.superseded`
- 调整 `pause/resume/reentry`
- timeline 派生闭合

### 阶段 4：native split
- 引入最小 sidecar
- 接入 outbox
- 补齐恢复与 orphaned 规则

## 测试策略

### 必测
- 真源 append 后 ACK
- 派生视图失败不影响真源接受
- 同一 `operationId` 重试幂等
- IPC 与 outbox 双通道重复送达幂等
- `pause -> superseded -> new attempt`
- drain outbox 后再合成 orphaned
- native split 终端关闭无终态
- PTY 子进程异常退出无终态

### 恢复测试
- 仅靠 `control-log.jsonl` 重建 `runtime-state.json`
- 仅靠 `control-log.jsonl` 重建 `timeline.json`
- `resume` 恢复 provider 会话但 FlowBraid 生成新 attempt

## 最终建议
v3 不是在 v2 上继续堆功能，而是把运行时协议真正闭合：

1. 写入权唯一
2. ACK 语义明确
3. 去重键稳定
4. 旧 attempt 有收口状态
5. orphaned 合成保守
6. native split 与 PTY 分模式实现

只有在这六点全部成立时，FlowBraid 的控制通道重构才值得进入代码实现阶段。
