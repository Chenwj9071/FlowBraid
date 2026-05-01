# FlowBraid 架构说明

## 总体结构
FlowBraid 当前拆成四层：
- 工作流定义层：读取、解析、校验 workflow 文件。
- 调度层：驱动节点执行，处理暂停、审批、回流、resume 和 send。
- 执行器与 provider 层：负责真正拉起 `shell`、`codex exec`，以及会话型 provider 的单次 turn。
- 运行时存储层：负责 run workspace、状态文件、消息箱、日志和产物。

## 关键模块
### 1. Workflow Loader
- 读取 YAML/JSON。
- 规范化节点定义。
- 校验起点、节点引用和跳转关系。
- 当前节点类型包括 `shell`、`codex`、`agent_session`、`gate`、`approval`、`end`。

### 2. Run Workspace
- 每次运行创建独立目录。
- 目录内包含 `manifest`、`state`、`nodes`、`artifacts`、`messages` 和 `logs`。
- 节点目录和工程目录严格分离。
- 默认情况下，workflow 文件所在目录就是默认工作目录，`.flowbraid-runs/` 也落在该目录下。

### 3. Scheduler
- 按图结构驱动节点执行。
- 节点成功、失败、暂停都要写入状态文件。
- `gate` / `approval` 是运行时一等状态，不是脚本外置逻辑。
- `agent_session` 节点暂停时不会切到 `pendingNodeId`，而是保持 `currentNodeId` 指向当前会话节点，等待 `send`。
- 节点失败时如果配置了 `transitions.failure`，调度器会保留该节点的失败状态，并继续流转到失败分支节点。

### 4. Executors And Providers
- `shell` 执行器负责一次性本地命令。
- `codex` 任务节点负责短生命周期的 `codex exec`，完成判定仍然依赖子进程退出码。
- `codex` 的开发模式在交互运行时通过 PTY 直通当前终端，输入输出都走同一条 terminal 通道。
- `agent_session` 节点不再把“进程退出”当作节点完成信号，而是调用 provider 做一次 turn，消费完整会话历史并返回结构化结果。
- 当前 provider 只落地 `codex`，但接口边界已经按 `agent_session` 抽开，后续可以接 `claude` 等其他 provider。

### 5. State And Messaging
- `state/run.json`：run 级状态。
- `nodes/<node-id>/status.json`：节点级状态。
- `messages/events.jsonl`：全局运行事件。
- `messages/human-feedback.jsonl`：人工审批的 reject / approve 结果和反馈意见。
- `nodes/<node-id>/messages/inbox.jsonl`：会话节点的 system / user 输入。
- `nodes/<node-id>/messages/outbox.jsonl`：会话节点的 assistant 回复和结构化事件。
- `nodes/<node-id>/state/session.json`：会话节点状态，如 `running`、`waiting_input`、`completed`、`failed`。
- `nodes/<node-id>/artifacts/session-turn-result.json`：最近一次 provider turn 的结构化输出。

## 首版运行流程
1. 读取 workflow 文件。
2. 校验 workflow 图结构。
3. 以 workflow 文件所在目录作为默认工作目录，并在该目录下创建 run workspace。
4. 从 `start` 节点开始执行。
5. `shell` 节点运行完成后进入下一跳。
6. `codex` 任务节点调用本地 `codex exec`，子进程退出后由调度器判断成功或失败。
7. `agent_session` 节点会先读取完整会话历史，再调用 provider 做一次 turn。
8. 如果 turn 结果是 `waiting_input`，run 进入 `paused`，当前节点保持不变，等待 `flowbraid send` 或交互模式下继续输入。
9. 如果 turn 结果是 `completed`，调度器按 `next` / `transitions.success` 流转到下一个节点。
10. `approval` 节点在 `resume` 时消费 `approve` / `reject` 决策。
11. 遇到 `end` 节点后结束运行。

## 当前设计取舍
- `codex` 任务节点和 `agent_session` 节点并存，而不是强行合并。这是为了避免把短任务语义和长期会话语义混在一个退出协议里。
- 会话型节点优先走文件协议和结构化结果，不靠解析自然语言输出来猜测“任务是否完成”。
- PTY 只用于提升交互体验，不承担节点完成判定职责。
