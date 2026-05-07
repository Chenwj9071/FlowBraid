# FlowBraid 项目进展记录

## 记录目的
用于快速告诉后续 agent：
- 当前项目已经做到哪一步
- 哪些闭环已经验证过
- 最近一次重点改动是什么
- 接下来最合理的推进方向是什么

## 当前状态
- 已完成首版工程骨架
- 已完成 workflow 解析、状态落盘、`shell` 执行器、`codex` 任务执行器和 CLI 调度
- 已支持 `shell`、`codex`、`agent_session`、`gate`、`approval`、`end` 节点
- 已支持 `run`、`resume`、`send` 的基本运行闭环
- `codex` 主路径已开始迁移到通用 `runtime-state + outcome` 状态协议，主示例和 native split 已优先按新协议流转
- `codex review` 已支持读取 `verdict: approve|reject` 自动走 success / failure 分支
- `agent_session` 已改为长期会话模型，节点完成由结构化 turn 结果决定
- 已支持 `contextDir` / `workdir` 双目录模型
- Windows PTY 路径已显式切换到 UTF-8 控制台后再启动交互式 `codex`
- native split 路径已补上 `attemptId` 和 `timeline` 机制，用于隔离同一节点的多轮回流执行
- `codex` 节点已支持节点级 `reentry.mode`，默认回流优先使用 `codex resume` 恢复同节点历史会话
- 已支持 `terminalCloseGraceMs`，native split 终态后会延时收尾，再请求关闭终端
- Windows native split 关窗已改为标题优先 + PID 兜底，并在关闭请求中携带 `attemptId` 标题，避免只靠 PID 竞态关错窗

## 已完成里程碑
1. 冻结需求、架构和技术选型文档
2. 建立 Node.js + TypeScript 工程骨架
3. 实现 workflow 解析与图校验
4. 实现 run workspace、状态文件、消息箱与日志
5. 实现 `shell` 执行器
6. 接入本地 `codex` 任务执行器
7. 实现 `approval` 人工审批节点
8. 实现 `run --interactive` 单命令交互执行
9. 补齐基础端到端测试、审批回流测试和 PTY smoke test
10. 引入 `agent_session` 目录协议、`send` 命令和 `codex` session provider
11. 打通 `review reject -> develop` 与 `approval reject -> 记录反馈 -> reopen` 闭环
12. 支持节点双目录执行：角色目录定义身份，共享工作目录承载真实业务修改
13. 为 Windows PTY 链路补上 UTF-8 控制台启动
14. 为 native split 补上 `attemptId`、`currentAttemptId`、`timeline.json` 和按 attempt 隔离的事件消费
15. 为 `codex` 节点补上 `reentry.mode`，并在 native split 下默认按节点自己的 `sessionId` 恢复会话
16. 为 `codex` 节点补上通用 `runtime-state.json`、`node.state` 事件和 `complete --outcome`
17. 主示例与 native split 主路径已迁移为 outcome 驱动，不再依赖 `review verdict` 作为唯一流转真源
18. 新增 `terminalCloseGraceMs` 并补齐相关回归测试

## 已验证内容
- `npx tsc -p tsconfig.json --noEmit` 通过
- `npm run check` 通过
- `npm test` 通过
- 示例 workflow 可在 `examples/` 目录直接运行
- `agent_session` 已覆盖“等待输入 -> send -> 完成”闭环测试
- `codex review` 自动分支与人工反馈回流已有自动化测试
- `codex` 通用 outcome 协议已有自动化测试，覆盖：
  - `success / approve / reject`
  - native split 回流恢复
  - attempt 隔离
  - 终端延时关闭
- native split 已验证：
  - 节点完成后终端正常关闭
  - Windows 终端关闭失败不会覆盖已完成 outcome
  - 回流到同一节点时优先使用该节点自己的 sessionId 恢复
  - 共享 `workdir` 下不会串用其他节点的 sessionId
  - 新 attempt 不会误消费旧 attempt 的完成事件
  - 主进程启动 native codex 节点后会主动探测并持久化最新 `sessionId`

## 当前默认行为
- workflow 文件所在目录是默认工作目录
- run workspace 默认落在该目录下的 `.flowbraid-runs/`
- `gate` / `approval` 使用 `resume` 继续
- `agent_session` 使用 `send` 继续，不走 `resume`
- 如果节点未单独声明 `contextDir`，默认回退到当前节点的 `workdir`
- native split 回流节点时，只消费当前 `attemptId` 的 session 状态和事件
- `codex` 节点回流策略默认是 `reentry.mode: resume`

## 最近一次重点改动
- 新增 `nodes/<node-id>/state/runtime-state.json`
- `flowbraid node complete` 已支持 `--outcome`
- 调度器已优先读取当前 attempt 的 `runtime-state` 和最新 `outcome` 决定流转
- `codex` prompt 已统一注入 outcome 上报命令：
  - `--outcome success`
  - `--outcome approve`
  - `--outcome reject`
- 主示例 `examples/codex-native-split-demo.workflow.yaml`、`examples/codex-pty-demo.workflow.yaml` 已切到新协议说明
- 新增 `terminalCloseGraceMs`，native split 收到终态后默认等待 `1500ms` 再请求关闭终端
- 为每次节点进入生成唯一 `attemptId`，并写入：
  - `state/run.json.currentAttemptId`
  - `nodes/<node-id>/status.json.attemptId`
  - `state/timeline.json`
  - `messages/events.jsonl`
  - `native-session.json`
- `waitForNativeSession()` 不再按 `nodeId` 消费“最近一条完成事件”，而是只接受当前 `attemptId` 的 session 状态或事件
- `cli node start|complete|fail|pause|artifact|heartbeat` 已补 `--attempt-id`
- `codex` native prompt 已注入 `--attempt-id`
- 修复 native split 测试桩，确保测试中的 session 状态写入当前 attemptId
- `codex` 节点新增 `reentry.mode: resume|new_with_history|new`
- native split 启动后主进程会按 `workdir + startedAt` 主动探测新会话 `sessionId`，并写入：
  - `nodes/<node-id>/state/native-session.json.sessionId`
  - `nodes/<node-id>/status.json.sessionId`
- native split 关闭逻辑已从“仅 PID”改为“标题匹配主关窗 + PID 兜底”，关闭命令会使用 `FlowBraid native <node> [<attemptId>]` 作为窗口标题标识

## 后续建议
1. 继续删除 `mode: exec|review` 的主路径依赖，最终只保留兼容层或彻底移除
2. 把 `workflow-authoring.md`、`requirements.md`、`architecture.md` 进一步更新为通用 outcome 状态机表述
3. 为 `timeline.json` 增加更明确的 CLI 展示或调试输出
4. 继续观察真实 Windows 终端下的 native split 行为，必要时补充更细粒度的 terminal / session 诊断日志

## 维护规则
- 每次做完一轮明确功能，更新这里
- 如果默认行为或状态协议变了，先更新这里，再改代码
- 新 agent 启动前优先读取本文件，避免沿用过期上下文

