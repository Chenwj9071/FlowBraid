# FlowBraid 安装说明

本文只回答一件事：怎样让 `flowbraid` 变成一条稳定可调用的本机命令。

## 目标

安装完成后，应满足：

```bash
flowbraid --help
```

可以直接执行。

这很重要，因为 `codex` 节点 prompt 协议默认会注入：

```bash
flowbraid node complete ...
flowbraid node fail ...
```

如果安装后没有 `flowbraid` 命令，prompt 协议就无法闭环。

## 当前产物结构

- 源码入口：`src/cli.ts`
- 构建产物入口：`dist/src/cli.js`
- 包导出命令名：`flowbraid`

`package.json` 通过 `bin` 字段把 `dist/src/cli.js` 暴露成系统命令。

## 安装路径

### 1. 仓库开发态

只适合开发，不适合让 prompt 协议长期依赖：

```bash
npm install
npm run dev -- --help
```

### 2. 本机可执行安装

推荐本地使用：

```bash
npm install
npm run build
npm install -g .
flowbraid --help
```

也可以用：

```bash
npm link
flowbraid --help
```

### 3. 打包验证安装

推荐发布前验证：

```bash
npm pack
npm install -g .\\flowbraid-0.1.0.tgz
flowbraid --help
```

## 构建与打包钩子

当前已配置：

- `prepare`
- `prepack`

两者都会先执行：

```bash
npm run build
```

这样可以保证：
- 本地 `npm install -g .` 前有构建产物
- `npm pack` 之前有构建产物

## 开发态回退开关

默认情况下，prompt 协议层只注入：

```bash
flowbraid ...
```

如果需要显式回退到开发机入口路径，可设置：

```bash
FLOWBRAID_PROMPT_USE_ENTRYPOINT=1
```

如果需要覆盖为别的命令名，可设置：

```bash
FLOWBRAID_NODE_CLI_COMMAND=<your-command>
```

## Windows 注意事项

- 全局安装后，需确认 npm global bin 已进入 PATH
- PowerShell 新开一个窗口再执行 `flowbraid --help`，避免 PATH 未刷新
- native split 仍然只支持 Windows，这和 CLI 安装本身是两件事

## 推荐验收步骤

发布或安装流程改动后，至少验证：

1. `npm run build`
2. `npm pack`
3. `npm install -g <tgz>`
4. `flowbraid --help`
5. `flowbraid validate examples/codex-native-split-demo.workflow.yaml`
