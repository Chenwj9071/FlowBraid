# Native Split Codex Design

## Goal

新增一种只作用于 `codex` 节点的交互模式：主进程负责 workflow 流转与状态，节点终端直接拉起原生 `codex` CLI；节点通过显式 `flowbraid node ...` 命令向主进程上报完成、失败、暂停和产物事件。

## Non-Goals

- 不修改现有 PTY 模式行为。
- 不修改现有 `agent_session` 模式。
- 不要求首版支持 `shell` 节点的分离原生交互。
- 不要求首版跨平台，优先支持 Windows。

## User Model

用户仍然执行一条命令启动 workflow，例如：

```bash
npm run demo:native-split
```

主进程保留在当前终端，输出 run 状态、节点事件和人工审批提示。遇到 `codex` 节点时，FlowBraid 打开新的独立终端窗口，窗口里前台直接运行原生 `codex`。`codex` 通过注入提示词了解当前节点身份、共享 `workdir`、以及必须使用的上报命令。

## Mode Boundary

新增 `native-split-terminals` 运行模式。

- `--interactive`：现有单终端交互，保留
- `--split-terminals`：现有 helper 包裹型分离终端原型，保留
- `--native-split-terminals`：新增原生 `codex` 分离终端模式

三者互不覆盖语义。新模式只影响 `codex` 节点，且只在用户显式指定时启用。

## Native Node Protocol

新增 CLI 子命令：

```bash
flowbraid node start --run-dir <dir> --node-id <id> --terminal-pid <pid>
flowbraid node complete --run-dir <dir> --node-id <id> [--summary "..."]
flowbraid node fail --run-dir <dir> --node-id <id> --message "..."
flowbraid node pause --run-dir <dir> --node-id <id> --reason "..."
flowbraid node artifact --run-dir <dir> --node-id <id> --file "<path>"
flowbraid node heartbeat --run-dir <dir> --node-id <id>
```

协议要求：

- `start`：节点真正开始工作后尽快上报
- `complete`：节点确认本轮任务完成后上报
- `fail`：节点确认无法继续后上报
- `pause`：节点需要人工介入但并非 workflow `approval/gate` 时上报
- `artifact`：节点显式登记产物
- `heartbeat`：可选，首版支持命令但不强制在示例中使用

所有命令都会：

1. 更新 `nodes/<node-id>/state/native-session.json`
2. 追加 `messages/events.jsonl`

终态命令是 `complete` / `fail` / `pause`。主进程只以这些命令作为状态流转依据，不再猜测 `codex` 是否完成。

## Session State

新增 `NativeSessionState`：

```json
{
  "mode": "native_split_terminal",
  "status": "launching",
  "terminalPid": 12345,
  "startedAt": "2026-05-05T00:00:00.000Z",
  "updatedAt": "2026-05-05T00:00:00.000Z",
  "lastHeartbeatAt": "2026-05-05T00:01:00.000Z",
  "result": {
    "kind": "complete",
    "summary": "updated calc.js"
  }
}
```

状态枚举：

- `launching`
- `running`
- `completed`
- `failed`
- `paused`
- `aborting`

## Launch Model

主进程对 `codex` 节点做以下动作：

1. 生成本轮节点 prompt
2. 在 `contextDir` 作为窗口打开目录拉起独立终端
3. 终端前台直接启动原生 `codex`
4. 通过 prompt 和环境变量注入：
   - `runDir`
   - `nodeId`
   - `contextDir`
   - `workdir`
   - 上报命令模板
5. 主进程等待 `native-session.json` 进入终态
6. 主进程主动关闭终端窗口
7. 根据协议终态继续 workflow

关键点：外部窗口中不再运行 `flowbraid internal run-codex-node` 这类 helper 作为主交互入口。

## Prompt Contract

每个 `codex` 节点都会自动附加固定协议段，明确要求：

- 真实修改发生在 `workdir`
- 完成时必须执行 `flowbraid node complete ...`
- 失败时必须执行 `flowbraid node fail ...`
- 产物落盘后应执行 `flowbraid node artifact ...`
- 不得静默退出而不回报状态
- 必须先读取最新的验收报告和人工反馈（当存在时）

验收节点同样使用原生 `codex`，但提示词要求输出审查结果并在最后执行上报命令。`review` 节点的“approve/reject”仍以产物文件中的 `verdict:` 为准，协议里的 `complete/fail` 只是告诉主进程该轮节点已结束。

## Event Flow

开发节点：

1. 主进程拉起原生 `codex`
2. 节点执行 `flowbraid node start ...`
3. 节点修改共享 `workdir`
4. 节点可执行 `flowbraid node artifact ...`
5. 节点执行 `flowbraid node complete ...`
6. 主进程关窗并流转到下一节点

验收节点：

1. 主进程拉起原生 `codex`
2. 节点执行真实检查
3. 写出 `verify-report.md`
4. 节点执行 `flowbraid node artifact ...`
5. 节点执行 `flowbraid node complete ...`
6. 主进程读取报告中的 `verdict`
7. `approve` 则前进，`reject` 则回流

## Failure Handling

- 窗口关闭但没有终态命令：视为失败
- 收到重复终态：只认第一次，后续只记审计事件
- 长时间无心跳：首版只记录警告，不自动失败
- 收到 `complete` 但缺少必需产物：按节点语义判定失败
- 主进程无法关闭窗口：记录事件，但不阻塞 workflow 继续

## Demo

新增示例：

- workflow: `examples/codex-native-split-demo.workflow.yaml`
- script: `scripts/demo-native-split.ps1`
- npm script: `demo:native-split`

示例流程沿用当前 PTY demo 语义：

1. `develop` 首次提交最小正确实现，不带注释
2. `verify` 因缺注释 `reject`
3. `develop` 补注释
4. `verify` `approve`
5. 进入人工 `approval`
6. 人工可 `reject` 并附意见
7. 回流开发与验收
8. 最终人工 `approve`

## Testing

需要覆盖：

- CLI 参数解析新增 `--native-split-terminals`
- `flowbraid node ...` 命令写入协议状态
- 主进程 watcher 根据 `native-session.json` 正确流转
- 原生窗口启动命令构造正确
- demo 在 fake codex 下稳定闭环
- 真实 `demo:native-split` fresh 运行可到人工审批，并能完成

## Migration

现有 `split-terminal` 原型不删除，但不作为默认推荐。后续文档主推 `native-split`，旧原型保留为实验模式，避免本次重构影响现有 PTY 和现有测试闭环。
