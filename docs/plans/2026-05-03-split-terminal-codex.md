# Split-Terminal Codex Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 `codex` 节点新增“主进程控流 + 外部独立终端执行”的 split-terminal 交互模式，并提供可真实运行的新示例。

**Architecture:** 在现有调度器和 `codex` 执行器之上新增一层“外部终端 + 节点助手 + 状态文件协议”。主进程负责启动外部终端、监听节点状态文件、在节点完成后关闭窗口并继续流转；节点助手负责在独立窗口中运行真实交互式 `codex`，并主动写入完成状态。整个方案延续现有 `contextDir/workdir`、`review verdict` 和审批回流逻辑。

**Tech Stack:** TypeScript, Node.js, PowerShell, Vitest, existing `node-pty`

---

### Task 1: 扩展类型与状态协议

**Files:**
- Modify: `src/types.ts`
- Create: `src/external-session.ts`
- Test: `test/external-session.test.ts`

**Step 1: 写失败测试**

为 `external-session` 协议写测试，覆盖：
- 初始 `launching` 状态写入
- 状态更新到 `running/completed/failed`
- 读回结构化字段

**Step 2: 运行测试确认失败**

Run: `npx vitest run test/external-session.test.ts`
Expected: FAIL，提示缺少 `external-session` 模块或导出

**Step 3: 写最小实现**

- 在 `src/types.ts` 增加：
  - `RunnerOptions.splitTerminals?: boolean`
  - `ExternalSessionStatus`
  - `ExternalSessionState`
- 在 `src/external-session.ts` 实现：
  - `getExternalSessionPath(nodeDir)`
  - `readExternalSessionState(path)`
  - `writeExternalSessionState(path, state)`

**Step 4: 运行测试确认通过**

Run: `npx vitest run test/external-session.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/types.ts src/external-session.ts test/external-session.test.ts
git commit -m "feat: add external codex session state"
```

### Task 2: 终端启动器抽象与 Windows 实现

**Files:**
- Create: `src/terminal-launchers/types.ts`
- Create: `src/terminal-launchers/windows.ts`
- Create: `src/terminal-launchers/index.ts`
- Test: `test/terminal-launcher.test.ts`

**Step 1: 写失败测试**

覆盖：
- Windows 启动命令拼装
- 返回的 `terminalPid` 解析
- 非 Windows 平台行为显式失败

**Step 2: 运行测试确认失败**

Run: `npx vitest run test/terminal-launcher.test.ts`
Expected: FAIL，提示模块不存在或行为不匹配

**Step 3: 写最小实现**

- 定义 `ExternalTerminalLauncher` 接口
- 实现 Windows launcher：
  - `launchExternalTerminal(...)`
  - `closeExternalTerminal(...)`
- 首版非 Windows 平台返回显式错误

**Step 4: 运行测试确认通过**

Run: `npx vitest run test/terminal-launcher.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/terminal-launchers src/terminal-launchers/types.ts src/terminal-launchers/windows.ts src/terminal-launchers/index.ts test/terminal-launcher.test.ts
git commit -m "feat: add external terminal launcher"
```

### Task 3: 为 `codex` 执行器补节点助手入口能力

**Files:**
- Modify: `src/executors/codex.ts`
- Test: `test/codex-command-string.test.ts`

**Step 1: 写失败测试**

补一个新的命令拼装测试，覆盖：
- split-terminal 下内部节点助手命令的参数格式
- `contextDir` 与 `--cd <workdir>` 不冲突

**Step 2: 运行测试确认失败**

Run: `npx vitest run test/codex-command-string.test.ts`
Expected: FAIL，新的断言不满足

**Step 3: 写最小实现**

在 `src/executors/codex.ts` 中补独立 helper，用于生成：
- `flowbraid internal run-codex-node --run-dir ... --node-id ...`
- 或 `node dist/cli.js internal run-codex-node ...`

注意只抽 helper，不先接入主调度器。

**Step 4: 运行测试确认通过**

Run: `npx vitest run test/codex-command-string.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/executors/codex.ts test/codex-command-string.test.ts
git commit -m "feat: add split terminal command helpers"
```

### Task 4: 新增内部 CLI 子命令 `internal run-codex-node`

**Files:**
- Modify: `src/cli.ts`
- Create: `src/internal-codex-node.ts`
- Test: `test/internal-codex-node.test.ts`

**Step 1: 写失败测试**

覆盖：
- CLI 能解析 `internal run-codex-node --run-dir --node-id`
- 节点助手能从 manifest 加载节点配置
- 对 review 节点能基于 `verdict` 写 `completed/failed`

**Step 2: 运行测试确认失败**

Run: `npx vitest run test/internal-codex-node.test.ts`
Expected: FAIL，命令不存在或状态文件未写入

**Step 3: 写最小实现**

- 在 `src/internal-codex-node.ts` 实现：
  - 加载 run/manifest
  - 解析指定节点
  - 写 `launching/running/completed/failed`
  - 调起现有交互式 `codex` 执行器
  - review 模式解析 `verdict`
- 在 `src/cli.ts` 注册内部命令分支

**Step 4: 运行测试确认通过**

Run: `npx vitest run test/internal-codex-node.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/cli.ts src/internal-codex-node.ts test/internal-codex-node.test.ts
git commit -m "feat: add internal codex node runner"
```

### Task 5: 调度器接入 split-terminal 模式

**Files:**
- Modify: `src/engine.ts`
- Modify: `src/types.ts`
- Test: `test/split-terminal-engine.test.ts`

**Step 1: 写失败测试**

覆盖：
- `splitTerminals=true` 时，`codex` 节点改走外部终端路径
- 主进程等待 `external-session.json`
- 节点完成后主进程请求关闭窗口
- `failure` 分支仍可打回开发节点

**Step 2: 运行测试确认失败**

Run: `npx vitest run test/split-terminal-engine.test.ts`
Expected: FAIL，说明主调度器尚未走新路径

**Step 3: 写最小实现**

- 在 `RunnerOptions` 使用 `splitTerminals`
- `engine` 新增：
  - 启动外部终端
  - 监听 `external-session.json`
  - 写新事件
  - 节点完成后关闭窗口
- 保持：
  - `review verdict`
  - `transitions.failure`
  - `Ctrl+C` 中断逻辑

**Step 4: 运行测试确认通过**

Run: `npx vitest run test/split-terminal-engine.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/engine.ts src/types.ts test/split-terminal-engine.test.ts
git commit -m "feat: support split terminal codex nodes"
```

### Task 6: CLI 暴露 `--split-terminals` 用户入口

**Files:**
- Modify: `src/cli.ts`
- Test: `test/cli-split-terminal.test.ts`

**Step 1: 写失败测试**

覆盖：
- `run --interactive --split-terminals` 能传递选项
- 非 Windows 平台行为按设计显式失败或提示

**Step 2: 运行测试确认失败**

Run: `npx vitest run test/cli-split-terminal.test.ts`
Expected: FAIL，CLI 尚未识别该参数

**Step 3: 写最小实现**

- 扩展 `parseArgs` 和 `run` 路径
- 把 `splitTerminals` 传给 `startWorkflow` / `resumeWorkflow` / `sendWorkflow` 需要的地方

**Step 4: 运行测试确认通过**

Run: `npx vitest run test/cli-split-terminal.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/cli.ts test/cli-split-terminal.test.ts
git commit -m "feat: expose split terminal cli mode"
```

### Task 7: 新增 split demo 示例与脚本

**Files:**
- Create: `examples/codex-split-demo.workflow.yaml`
- Create: `scripts/demo-split.ps1`
- Modify: `package.json`
- Test: `test/codex-split-demo.test.ts`

**Step 1: 写失败测试**

覆盖：
- 示例 workflow 的主链路存在
- `demo:split` 会使用 split-terminal 入口
- fake codex 下能走“缺注释打回 -> 修复 -> 人工 reject -> 再开发 -> 结束”

**Step 2: 运行测试确认失败**

Run: `npx vitest run test/codex-split-demo.test.ts`
Expected: FAIL，示例或脚本尚不存在

**Step 3: 写最小实现**

- 复制并收紧现有 PTY 示例，改成 split-terminal 入口
- `package.json` 增加 `demo:split`
- `scripts/demo-split.ps1` 负责 UTF-8 和 fresh run 环境

**Step 4: 运行测试确认通过**

Run: `npx vitest run test/codex-split-demo.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add examples/codex-split-demo.workflow.yaml scripts/demo-split.ps1 package.json test/codex-split-demo.test.ts
git commit -m "feat: add split terminal demo"
```

### Task 8: 真实自测与文档补齐

**Files:**
- Create: `doc/demo-split-runbook.md`
- Create: `doc/demo-split-troubleshooting.md`
- Modify: `doc/progress.md`

**Step 1: 跑 targeted tests**

Run:
- `npx vitest run test/external-session.test.ts test/terminal-launcher.test.ts test/internal-codex-node.test.ts test/split-terminal-engine.test.ts test/cli-split-terminal.test.ts test/codex-split-demo.test.ts`

Expected: PASS

**Step 2: 跑全量静态检查和测试**

Run:
- `npm run check`
- `npm test`

Expected: PASS

**Step 3: 跑真实 demo**

Run:
- `npm run demo:split`

Expected:
- 主窗口驻留
- `develop` / `verify` 自动拉起新窗口
- 节点完成后主进程关闭窗口
- 整条示例无异常跑通

**Step 4: 写运行说明与问题处理文档**

- 记录执行方法
- 记录 Windows 外部终端、PID、乱码、关窗失败等常见问题及处理方式
- 更新 `doc/progress.md`

**Step 5: Commit**

```bash
git add doc/demo-split-runbook.md doc/demo-split-troubleshooting.md doc/progress.md
git commit -m "docs: document split terminal demo"
```
