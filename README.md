# FlowBraid

FlowBraid 是一个本地优先的 CLI 工作流编排器，面向需要持续执行、人工门禁、节点回流、可恢复执行和可审计日志的开发流程。

## 推荐演示

当前主推演示是原生分离终端模式：

```bash
npm run demo:native-split
```

这个示例会展示：

1. 主进程负责流程日志和人工审批
2. `codex` 节点在独立终端窗口中以原生 CLI 方式运行
3. 开发节点首次交付后被验收节点打回
4. 开发节点根据验收意见继续处理
5. 验收通过后进入人工审批
6. 人工可以继续 `approve` 或 `reject` 回流

## 其他示例

- `npm run demo:pty`
  - 现有单终端 PTY 交互模式
  - 旧的 helper 包裹型分离终端原型，保留作兼容/实验用途
- `npm run demo:session`
  - `agent_session` 长期交互示例

## Workflow 编写指南

- `workflow.yaml` 写法、字段含义、节点类型、运行语义、推荐用法和示例：见 `doc/workflow-authoring.md`

## 开发验证

```bash
npm run check
npm test
```
