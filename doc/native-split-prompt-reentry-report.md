# native split prompt 重构报告

## 处理内容
- 将 `codex` 节点提示词从旧式单段说明重构为分段式结构：`FlowBraid Protocol`、`Re-entry Priority`、`Re-entry Evidence`、`Task Reference`、`Required Commands`、`FlowBraid Protocol Addendum`
- 删除提示词里的 `verify.report` 残留，改为优先读取 `runtime-state.json` 和 `human-feedback.jsonl`
- 保留 `flowbraid node fail --message`，但收缩 `complete` 命令的展示参数，只保留必要的 `--run-dir`、`--node-id`、`--attempt-id`、`--outcome`
- 把 native split 的回流分支接到新的 `buildNewSessionReentryPrompt()` 路径上，区分首次拉起与回流重入
- 同步更新示例工作流、`examples/demo-verify/AGENTS.md` 和相关测试

## 验证结果
- `npm run check` 通过
- `npm test` 通过
- `npm run build` 通过
- `flowbraid --help` 可用
- 已使用安装后的 `flowbraid run` 直接运行 `examples/codex-native-split-demo.workflow.yaml`
- 已通过安装后的 `flowbraid resume` 完成两轮审批回流，最终运行状态为 `completed`

## 后续建议
- 继续收紧 `doc/architecture.md`、`doc/requirements.md` 和 `doc/workflow-authoring.md` 里的旧式兼容措辞
- 如果后续要进一步简化提示词，可以把 `Task Reference` 再拆成“系统编排信息”和“任务原文”两层
- `flowbraid --help` 当前返回退出码 `1`，如果希望更符合 CLI 习惯，可以后续改成 `0`
