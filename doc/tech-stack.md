# 技术选型说明

## 首版选型
- 运行时：Node.js
- 语言：TypeScript
- 调度模型：单进程长跑式 CLI 调度器

## 选择原因
- Node.js 对子进程编排、日志流处理、跨平台 CLI 和文件协议支持成熟。
- TypeScript 适合收紧 workflow 定义、运行状态、会话协议和执行器接口。
- 首版以本地运行、目录落盘和终端交互为主，不引入服务端。

## 可复用能力
- `child_process.spawn`：执行本地 shell 命令和非 PTY 的 `codex exec`。
- `node-pty`：给 `codex` 交互任务节点提供 PTY 直通，保证单终端交互体验。
- `fs/promises`：管理 run workspace、状态文件、消息箱和产物目录。
- `yaml`：兼容 YAML/JSON 工作流定义。
- `vitest`：端到端和 CLI 级验证。

## 当前 provider 方案
- `codex` 任务节点：适合一次性开发、review、生成结果后退出的场景。
- `codex` 会话 provider：适合 `agent_session` 节点，按 turn 消费完整会话历史，并返回结构化结果。
- 结构化结果当前固定为：
- `waiting_input`
- `completed`
- `failed`

## 首版不引入的东西
- 后台服务
- 分布式调度
- Web 控制台
- 复杂插件市场
- 过度抽象的统一 agent 总线

## 预留扩展点
- `agent_session` 已经把“任务型执行器”和“会话型 provider”拆开，后续可以继续接入 `claude` 或其他 provider。
- 调度器可以从单进程 CLI 演进到守护进程模式，但当前不依赖这个前提。
- 目录与状态协议稳定后，可再考虑 `status`、TUI 或 Web 观测层。
