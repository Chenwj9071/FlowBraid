# FlowBraid 架构说明

## 总体结构

FlowBraid 当前拆成四层：

- 工作流定义层：负责读取、解析和校验 workflow 文件。
- 调度层：负责驱动节点执行，处理暂停、审批、回流、`resume`、`send` 和 `recover`。
- 执行器与 provider 层：负责真正拉起 `shell`、`codex` 任务节点，以及会话型 provider 的单次 `turn`。
- 运行时存储层：负责 run workspace、状态文件、消息箱、日志和产物落盘。

## 关键模块

### 1. Workflow Loader

- 读取 YAML / JSON。
- 规范化节点定义。
- 校验起点、节点引用和跳转关系。
- 当前节点类型包括 `shell`、`codex`、`agent_session`、`gate`、`approval`、`end`。
- 校验 workflow 级和节点级的 `workdir` / `contextDir` 配置。

### 2. Run Workspace

- 每次运行创建独立目录。
- 目录内包含 `manifest`、`state`、`nodes`、`artifacts`、`messages` 和 `logs`。
- 节点运行目录和真实业务目录严格分离。
- 默认情况下，workflow 文件所在目录就是默认工作目录，`.flowbraid-runs/` 也落在该目录下。

### 3. Scheduler

- 按图结构驱动节点执行。
- 节点成功、失败、暂停都要写入状态文件。
- `gate` / `approval` 是运行时一等状态，不是脚本外置逻辑。
- `agent_session` 节点暂停时不切到 `pendingNodeId`，而是保持 `currentNodeId` 指向当前会话节点，等待 `send`。
- native split 下的 `codex` 节点不再使用固定时长硬超时判定失败；调度器持续等待节点显式终态，只在终端确认失联时把 run 暂停到人工决策状态。
- 节点失败时如果配置了 `transitions.failure`，调度器会保留该节点的失败状态，并继续流转到失败分支节点。
- 主调度器异常中断后，`recover` 负责重新诊断当前 run，并决定恢复当前节点、继续下一节点或人工确认。

### 4. Executors And Providers

- `shell` 执行器负责一次性本地命令。
- `codex` 任务节点负责短生命周期任务，当前兼容路径仍可通过 `flowbraid node complete|fail` 上报结果，但主方向收敛为控制事件真源。
- 调度器主方向应优先依据 `nodes/<node-id>/state/control-log.jsonl` 派生的当前 attempt 运行态决定 `codex` 节点流转。
- 旧的 `mode: review` / `verdict` 解析仍保留兼容层，但不再是推荐主路径。
- `codex` 的开发模式在交互运行时通过 PTY 直通当前终端，输入输出都走同一条 terminal 通道。
- Windows 下的 PTY 交互链路会先切到 UTF-8 控制台，再启动 `codex`，减少中文角色文档和人工输入的乱码问题。
- `agent_session` 节点不再把“进程退出”当作节点完成信号，而是调用 provider 做一次 `turn`，消费完整会话历史并返回结构化结果。
- 当前 provider 只落在 `codex`，但接口边界已经按 `agent_session` 拆开，后续可以接 `claude` 等其他 provider。

### 5. State And Messaging

- `state/run.json`：run 级状态。
- `state/timeline.json`：按节点 step / attempt 持久化的时间线。
- `nodes/<node-id>/status.json`：节点级状态。
- `nodes/<node-id>/state/control-log.jsonl`：任务型节点控制事件唯一真源。
- `nodes/<node-id>/state/runtime-state.json`：任务型节点派生快照，包含 `status`、`outcome`、`summary`、`attemptId`、`terminalPid` 等。
- `messages/events.jsonl`：全局运行事件。
- `messages/human-feedback.jsonl`：人工审批的 `reject` / `approve` 结果和反馈。
- `nodes/<node-id>/messages/inbox.jsonl`：会话节点的 system / user 输入。
- `nodes/<node-id>/messages/outbox.jsonl`：会话节点的 assistant 回复和结构化事件。
- `nodes/<node-id>/state/session.json`：会话节点状态，如 `running`、`waiting_input`、`completed`、`failed`。
- `nodes/<node-id>/artifacts/session-turn-result.json`：最近一次 provider turn 的结构化输出。

## 双目录节点模型

- `contextDir` 是节点终端默认打开的目录，用于定义身份、角色、行为准则和局部说明。
- `workdir` 是共享业务目录，用于放置真实协作修改的业务文件。
- FlowBraid 会把 `contextDir` 作为终端启动目录，并把 `workdir` 通过参数和环境变量显式传给执行器。
- `codex` / `agent_session` 在启动时同时拿到两类目录：
  - `-C <contextDir>`：从角色目录打开终端和读取局部约束。
  - `--cd <workdir>`：在共享业务目录里执行真实修改和验证。
- 不同节点可以使用不同的 `contextDir`，但指向同一个 `workdir`，实现“身份隔离 + 业务协作”。

## 首版运行流程

1. 读取 workflow 文件。
2. 校验 workflow 图结构和目录配置。
3. 以 workflow 文件所在目录作为默认工作目录，并在该目录下创建 run workspace。
4. 从 `start` 节点开始执行。
5. `shell` 节点运行完成后进入下一跳。
6. `codex` 任务节点启动后，在 prompt 中获得明确的 `complete` / `fail` 上报协议。
7. 调度器优先读取当前 attempt 的 `runtime-state` 或 control-log 派生结果决定成功、失败或暂停。
8. 只有在历史兼容 workflow 且未拿到 runtime-state 终态时，调度器才回退到旧退出码或 `review verdict` 解析。
9. `agent_session` 节点会先读取完整会话历史，再调用 provider 做一次 `turn`。
10. 如果 turn 结果是 `waiting_input`，run 进入 `paused`，当前节点保持不变，等待 `flowbraid send` 或交互模式下继续输入。
11. 如果 turn 结果是 `completed`，调度器按 `next` / `transitions.success` 流转到下一个节点。
12. `approval` 节点在 `resume` 时消费 `approve` / `reject` 决策。
13. native split `codex` 节点如果终端失联，`resume` 会消费 `retry-current` / `continue-next` 人工决策。
14. 如果主调度器异常中断，可通过 `flowbraid recover <run-dir>` 重新接管。
15. 遇到 `end` 节点后结束运行。

## 当前设计取舍

- `codex` 任务节点和 `agent_session` 节点并存，而不是强行合并，避免把短任务语义和长期会话语义混在一个退出协议里。
- `codex` 主路径优先使用通用 outcome 协议，而不是把 review 专用语义扩散到所有任务节点。
- 会话型节点优先走文件协议和结构化结果，不靠解析自然语言输出猜测“任务是否完成”。
- PTY 只用于提升交互体验，不承担节点完成判定职责。
- 正式示例优先使用英文角色提示和本地 demo 文档，以降低 Windows PTY 下中文输出乱码概率。

## 补充设计（2026-05-06）

- native split 下的 `codex` 节点回流策略由节点级 `reentry.mode` 控制，默认值为 `resume`。
- 调度器在启动 native codex 终端后，会基于 `workdir + startedAt` 主动探测新产生的 `codex` `sessionId`，并写入 `nodes/<node-id>/state/native-session.json` 与 `nodes/<node-id>/status.json`。
- 回流到同一 `codex` 节点时，只允许使用该节点自己最近一次持久化的 `sessionId` 恢复，禁止根据共享 `workdir` 推断其他节点会话。
- native split `codex` 节点如果仅仅长时间等待用户输入，会继续保持等待；如果外部终端消失，则把当前节点标记为人工决策暂停，等待 `resume` 指定 `retry-current` 或 `continue-next`。
