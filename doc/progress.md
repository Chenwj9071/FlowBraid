# FlowBraid 项目进展记录

## 记录目的
用于快速告诉后续 agent：
- 当前项目做到哪一步了
- 已验证哪些闭环
- 还有哪些未完成事项
- 最近一次开发重点是什么

## 当前状态
- 已完成首版工程骨架。
- 已完成 workflow 解析、状态落盘、shell 执行器、`codex` 执行器和 CLI 调度。
- 已支持 `gate`、`approval`、`codex`、`shell`、`end` 节点。
- 已支持 `run` 一条命令交互式执行，也支持 `resume` 非交互恢复。

## 已完成里程碑
1. 冻结需求文档、架构文档和技术选型文档。
2. 建立 Node.js + TypeScript 工程骨架。
3. 实现 workflow 解析与图校验。
4. 实现 run workspace、状态文件、日志与消息箱。
5. 实现 shell 执行器。
6. 接入本地 `codex` 执行器。
7. 实现 `approval` 人工审批节点。
8. 实现 `run --interactive` 单命令交互式执行。
9. 补齐最小端到端测试和 `codex` 审核回流测试。

## 已验证内容
- `npm run check` 通过。
- `npm test` 通过。
- `npm run build` 通过。
- 示例 workflow 可以在 `examples/` 目录下直接交互运行。

## 当前默认行为
- workflow 文件所在目录就是工作目录。
- 运行时 workspace 默认落在该目录下的 `.flowbraid-runs/`。
- 示例运行产物通过 `examples/.gitignore` 忽略。

## 最近一次重点改动
- 将 `run` 做成交互式单命令入口。
- `approval` 节点支持在终端中直接选择 `approve/reject`。
- 新增 `examples/codex-approval-loop.workflow.yaml` 作为完整示例。

## 后续建议
1. 增加 `flowbraid status`，直接查看当前 run 状态。
2. 完善分支和回流语义。
3. 统一 `codex` 节点输入输出协议。
4. 再考虑接入 `claude` 执行器。

## 维护规则
- 每次做完一轮明显功能，都更新这里。
- 如果默认行为或目录结构变了，先更新这份文档，再改代码。
- 新 agent 启动前应优先读取本文件，以免沿用过期上下文。

