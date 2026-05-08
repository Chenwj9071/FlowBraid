# FlowBraid 需求说明

## 目标
FlowBraid 是一个本地优先的 CLI 工作流编排器，面向需要持续执行、人工门禁、节点回流、长期交互 agent 和可恢复执行的开发流程。

## 已确认需求
- 通过 CLI 启动工作流。
- 工作流以图结构描述，支持顺序执行、分支、回流和人工确认点。
- 每个节点拥有独立运行目录。
- 每个节点还可以显式声明独立的 `contextDir`，作为该节点终端默认打开的角色目录。
- 实际工程目录通过独立 `workdir` 注入，不能与节点运行目录或 `contextDir` 混用。
- 多个节点可以共享同一个 `workdir`，但分别使用不同的 `contextDir` 定义身份、职责和行为准则。
- 运行状态必须落盘，支持中断后继续执行。
- 执行过程要可审计，保留日志、状态和消息。
- 首版监控以终端实时日志和基础状态面板为主，不提前引入复杂 Web 控制台。

## 工作流模型
- `workflow`：具备唯一标识、起始节点和节点集合的有向图。
- `node`：一个运行单元，当前支持 `shell`、`codex`、`agent_session`、`gate`、`approval`、`end`。
- `transition`：节点执行结果对应的下一跳。
- `gate`：人工确认或门禁节点，会阻断流程并等待 `resume`。
- `codex`：调用本地 `Codex CLI` 的任务型节点，支持开发和 code review 两种模式。
- `agent_session`：长期交互 agent 节点，当前先支持 `provider: codex`，节点完成由结构化会话结果决定。
- `approval`：人工审批节点，`resume` 时通过 `approve` / `reject` 决定下一跳。

## 节点目录模型
- `nodeDir`：FlowBraid 为节点分配的运行态目录，用于状态、日志和节点产物。
- `contextDir`：节点终端默认打开的上下文目录，用于放置该节点的 `AGENTS.md`、角色说明和局部约束。
- `workdir`：共享业务目录，节点真正修改和验证的业务文件放在这里。
- 默认情况下，如果未显式声明 `contextDir`，则 `contextDir` 回退为当前节点的 `workdir`。
- `shell`、`codex` 和 `agent_session` 节点都必须能够同时感知 `contextDir` 与 `workdir`。

## 节点生命周期
- `pending`：等待执行。
- `running`：正在执行。
- `paused`：被门禁、审批或会话输入等待阻断。
- `succeeded`：节点完成。
- `failed`：节点失败。
- `closed`：节点资源已释放。

## 目录模型
- `run/`：一次工作流运行的根目录。
- `state/`：运行时状态文件。
- `nodes/<node-id>/`：节点独立目录。
- `artifacts/`：节点输出产物。
- `messages/`：节点间消息箱。
- `logs/`：可选的聚合日志视图。
- `nodes/<node-id>/messages/inbox.jsonl`：会话型节点的 system / user 输入。
- `nodes/<node-id>/messages/outbox.jsonl`：会话型节点的 assistant 回复和结构化事件。
- `nodes/<node-id>/state/session.json`：会话型节点的会话状态。
- 默认情况下，workflow 文件所在目录就是默认工作目录，运行时 workspace 也落在该目录下。

## 门禁、回流与会话继续
- 门禁不是额外脚本，而是运行态的一部分。
- 运行到 `gate` 节点时，调度器必须暂停并持久化状态。
- `resume` 后要从门禁后续节点继续执行。
- 审批节点 `resume` 时必须显式给出决策，审批通过或打回都属于正常流转。
- 工作流允许回流，但实现必须避免因配置错误造成无限循环。
- 当节点执行失败但声明了 `transitions.failure` 时，调度器应按失败分支继续流转，而不是直接结束整个 run。
- 会话型节点暂停时，不通过 `resume` 恢复，而是通过 `send` 向当前节点继续发送输入。
- 人工审批 `reject` 时应支持记录结构化反馈，供后续节点读取和处理。

## 监控要求
- 终端实时输出节点日志。
- 能看到当前运行节点、状态和暂停原因。
- 运行结束后要能定位到对应 run workspace。
- 对 `agent_session` 节点，终端需要能区分“节点仍在运行”和“节点正在等待用户输入”。

## 补充约束（2026-05-06）
- 对于会回流的 `codex` 节点，系统必须记录该节点自己的会话 id，并在同一次 workflow run 内优先恢复该节点历史会话。
- 同一 run 内再次进入同一个 `codex` 节点时，默认行为是恢复该节点上一轮会话上下文继续执行，而不是强制新开会话。
- 工作流作者可以通过节点级 `reentry.mode` 覆盖默认回流方式，支持：`resume`、`new_with_history`、`new`。
