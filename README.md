# FlowBraid

FlowBraid 是一个本地优先的 CLI 工作流编排器，面向需要持续执行、人工门禁、节点回流、可恢复执行和可审计日志的开发流程。

## 安装方式

### 1. 本地开发运行

适合仓库开发和调试：

```bash
npm install
npm run dev -- --help
```

直接运行示例：

```bash
npm run dev -- run examples/codex-native-split-demo.workflow.yaml
```

### 2. 从源码仓库安装为本机命令

适合本地长期使用：

```bash
npm install
npm run build
npm link
flowbraid --help
```

也可以使用：

```bash
npm install -g .
flowbraid --help
```

### 3. 打包后安装

适合发布包验证或离线分发：

```bash
npm pack
npm install -g .\flowbraid-0.1.0.tgz
flowbraid --help
```

说明：

- `prepare` 和 `prepack` 会自动先执行 `npm run build`
- CLI 实际入口是 `dist/src/cli.js`
- 安装后通过 `bin` 暴露成稳定命令名 `flowbraid`

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

其他示例：

- `npm run demo:pty`
- `npm run demo:session`

## 常用命令

```bash
flowbraid validate path/to/workflow.yaml
flowbraid run path/to/workflow.yaml
flowbraid run path/to/workflow.yaml --interactive
flowbraid resume <run-dir>
flowbraid resume <run-dir> --decision approve
flowbraid resume <run-dir> --decision reject --message "补充说明"
flowbraid recover <run-dir>
flowbraid send <run-dir> "继续执行"
```

## 开发验证

```bash
npm run check
npm test
```

## 相关文档

- 完整使用指南：`doc/user-guide.md`
- 安装说明：`doc/installation.md`
- workflow 编写指南：`doc/workflow-authoring.md`
- 架构说明：`doc/architecture.md`
- 需求说明：`doc/requirements.md`
- 当前进展：`doc/progress.md`
