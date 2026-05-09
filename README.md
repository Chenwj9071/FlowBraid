# FlowBraid

FlowBraid 是一个本地优先的 CLI 工作流编排器，面向需要持续执行、人工门禁、节点回流、可恢复执行和可审计日志的开发流程。

## 本地命令安装

`npm install` 只会安装依赖，不会自动把 `flowbraid` 命令注册到系统 `PATH`。

如果要在本机直接使用 `flowbraid` 命令，请执行：

```bash
npm install
npm run build
npm link
```

安装完成后可直接验证：

```bash
flowbraid validate examples/codex-native-split-demo.workflow.yaml
```

如果只是临时在仓库内运行，也可以不做全局链接，直接执行：

```bash
node dist/src/cli.js validate examples/codex-native-split-demo.workflow.yaml
```

## 推荐示例

当前主推示例是原生分离终端模式：

```bash
flowbraid run examples/codex-native-split-demo.workflow.yaml --interactive
```

这个示例会展示：

1. 主进程负责流程日志和人工审批
2. `codex` 节点在独立终端窗口中以原生 CLI 方式运行
3. 开发节点首次交付后被验证节点打回
4. 开发节点根据验证意见继续处理
5. 验收通过后进入人工审批
6. 人工可以继续 `approve` 或 `reject` 回流

## 其他示例

- `npm run demo:pty`
- `npm run demo:session`

## Workflow 编写指南

- 见 [doc/workflow-authoring.md](doc/workflow-authoring.md)

## 开发验证

```bash
npm run check
npm test
```
