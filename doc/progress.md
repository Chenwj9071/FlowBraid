# FlowBraid 项目进展记录

## 记录目的
用于快速告诉后续 agent：
- 当前项目已经做到哪一步。
- 哪些闭环已经验证过。
- 最近一次重点改动是什么。
- 接下来最合理的推进方向是什么。

## 当前状态
- 已完成首版工程骨架。
- 已完成 workflow 解析、状态落盘、`shell` 执行器、`codex` 任务执行器和 CLI 调度。
- 已支持 `shell`、`codex`、`agent_session`、`gate`、`approval`、`end` 节点。
- 已支持 `run` 一条命令交互式执行，也支持 `resume` 和 `send`。
- `codex` 的任务型交互路径已切到 PTY 直通模式。
- `agent_session` 已改成长期交互模型：节点完成由结构化 turn 结果决定，不再依赖进程退出。
- `Ctrl+C` 已接到统一中断链路，当前 run 会尽量终止子任务并以“用户中断运行”落盘为失败。
- `codex review` 节点现在会读取 `verdict: approve|reject` 自动走 success / failure 分支。
- 人工审批 `reject` 会把意见落盘到 `messages/human-feedback.jsonl`。
- 已支持 workflow 级和节点级的双目录模型：节点可使用独立 `contextDir` 打开角色目录，同时共享独立 `workdir` 协同工作。

## 已完成里程碑
1. 冻结需求文档、架构文档和技术选型文档。
2. 建立 Node.js + TypeScript 工程骨架。
3. 实现 workflow 解析与图校验。
4. 实现 run workspace、状态文件、日志与消息箱。
5. 实现 `shell` 执行器。
6. 接入本地 `codex` 任务执行器。
7. 实现 `approval` 人工审批节点。
8. 实现 `run --interactive` 单命令交互式执行。
9. 补齐基础端到端测试、审批回流测试和 PTY smoke test。
10. 引入 `agent_session` 目录协议、`send` 命令和 `codex` session provider。
11. 打通 `review verdict -> 自动打回开发` 和 `approval reject -> 记录人工反馈 -> 再开发` 闭环。
12. 支持节点双目录执行：角色目录定义身份，共享工作目录承载真实业务修改。
13. 为 Windows PTY 交互链路补上 UTF-8 控制台启动，降低中文角色文档和人工输入乱码问题。

## 已验证内容
- `npx tsc -p tsconfig.json --noEmit` 通过。
- `npm test` 通过。
- `npm run build` 通过。
- 示例 workflow 可以在 `examples/` 目录下直接交互运行。
- `codex` 任务节点在交互模式下通过 PTY 直通终端。
- `agent_session` 已覆盖“等待输入 -> send -> 完成”闭环测试。
- `codex review` 自动分支和人工反馈回流已覆盖自动化测试。
- PTY 主示例已覆盖“开发目录 + 验收目录 + 共享 workdir”的双目录执行路径。

## 当前默认行为
- workflow 文件所在目录就是默认工作目录。
- 运行时 workspace 默认落在该目录下的 `.flowbraid-runs/`。
- `gate` / `approval` 使用 `resume` 继续。
- `agent_session` 使用 `send` 继续，不走 `resume`。
- 示例运行产物通过 `examples/.gitignore` 忽略。
- 如果节点未单独声明 `contextDir`，则默认使用当前节点的 `workdir`。

## 最近一次重点改动
- 给 `shell`、`codex`、`agent_session` 节点补上 `contextDir` / `workdir` 双目录能力。
- `codex` 和 `agent_session` 现在会从角色目录启动终端，同时在共享业务目录里执行真实工作。
- 重构 `examples/codex-pty-demo.workflow.yaml`，让开发节点从 `demo-dev` 打开、验收节点从 `demo-verify` 打开，并共同操作 `demo-workdir`。
- Windows PTY 路径不再直接依赖默认代码页，而是显式切到 UTF-8 控制台后再启动交互式 `codex`。

## 后续建议
1. 增加 `flowbraid status`，直接查看当前 run、当前节点和最近一次会话事件。
2. 为 `agent_session` 增加更明确的 provider 抽象，准备接入第二个 provider。
3. 完善分支、回流和循环保护的文档与测试矩阵。
4. 继续观察真实 Windows 终端下的 PTY 中文显示，必要时再增加可选的统一英文终端模式。

## 维护规则
- 每次做完一轮明确功能，更新这里。
- 如果默认行为或目录协议变了，先更新这里，再改代码。
- 新 agent 启动前优先读取本文件，避免沿用过期上下文。
