# FlowBraid 架构说明

## 总体结构
FlowBraid 当前拆成四层：
- 工作流定义层：读取、解析、校验 workflow 文件。
- 调度层：驱动节点执行，处理暂停、审批、回流、`resume` 和 `send`。
- 执行器与 provider 层：负责真正拉起 `shell`、`codex exec`，以及会话型 provider 的单次 turn。
- 运行时存储层：负责 run workspace、状态文件、消息箱、日志和产物。

## 关键模块
### 1. Workflow Loader
- 读取 YAML/JSON。
- 规范化节点定义。
- 校验起点、节点引用和跳转关系。
- 当前节点类型包括 `shell`、`codex`、`agent_session`、`gate`、`approval`、`end`。
- 校验 workflow 级和节点级的 `workdir` / `contextDir` 配置。

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
- `codex` 任务节点负责短生命周期的 `codex exec`，完成判定仍然依赖子进程退出码或 review verdict。
- `codex` 的开发模式在交互运行时通过 PTY 直通当前终端，输入输出都走同一条 terminal 通道。
- Windows 下的 PTY 交互链路会先切到 UTF-8 控制台，再启动 `codex`，减少中文角色文档和人工输入的乱码问题。
- `agent_session` 节点不再把“进程退出”当作节点完成信号，而是调用 provider 做一次 turn，消费完整会话历史并返回结构化结果。
- 当前 provider 只落在 `codex`，但接口边界已经按 `agent_session` 拆开，后续可以接 `claude` 等其他 provider。

### 5. State And Messaging
- `state/run.json`：run 级状态。
- `nodes/<node-id>/status.json`：节点级状态。
- `messages/events.jsonl`：全局运行事件。
- `messages/human-feedback.jsonl`：人工审批的 reject / approve 结果和反馈意见。
- `nodes/<node-id>/messages/inbox.jsonl`：会话节点的 system / user 输入。
- `nodes/<node-id>/messages/outbox.jsonl`：会话节点的 assistant 回复和结构化事件。
- `nodes/<node-id>/state/session.json`：会话节点状态，如 `running`、`waiting_input`、`completed`、`failed`。
- `nodes/<node-id>/artifacts/session-turn-result.json`：最近一次 provider turn 的结构化输出。

## 双目录节点模型
- `contextDir` 是节点终端默认打开的目录，用于定义身份、角色、行为准则和局部说明。
- `workdir` 是共享业务目录，用于放置真正协作修改的业务文件。
- FlowBraid 会把 `contextDir` 作为终端启动目录，并把 `workdir` 通过参数和环境变量显式传给执行器。
- `codex` / `agent_session` 在启动时同时拿到两类目录：
  - `-C <contextDir>`：从角色目录打开终端和读取局部约束。
  - `--cd <workdir>`：在共享业务目录里执行真实修改和验证。
- 不同节点可以使用不同的 `contextDir`，但指向同一个 `workdir`，从而实现“身份隔离 + 业务协作”。

## 首版运行流程
1. 读取 workflow 文件。
2. 校验 workflow 图结构和目录配置。
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
- 会话型节点优先走文件协议和结构化结果，不靠解析自然语言输出猜测“任务是否完成”。
- PTY 只用于提升交互体验，不承担节点完成判定职责。
- 正式示例优先使用英文角色提示和本地 demo 文档，以降低 Windows PTY 下中文输出乱码的概率。
