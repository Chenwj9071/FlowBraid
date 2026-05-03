# Split-Terminal Codex 交互方案设计

## 背景

当前 `interactive` 模式下，`codex` 节点通过 PTY 直接接管主进程所在终端。这个方案已经能跑通交互式开发、验收、人工审批和回流，但存在两个限制：

1. 主进程与节点终端复用同一个窗口，用户很难同时观察整体流程和单节点执行细节。
2. 节点终端的生命周期与主进程强耦合，不适合作为后续默认交互模式继续扩展。

本设计新增一种新的交互方案：一条命令启动整个 workflow，主进程只负责流程控制和状态输出；每个 `codex` 节点启动时，自动拉起一个独立外部终端窗口，由节点助手在窗口内运行真正的交互式 `codex`。节点完成后主动把结果写回 run workspace，主进程检测到结果后继续流转，并主动关闭对应节点窗口。

## 目标

1. 保持“一条命令启动整条任务编排”的体验。
2. 首版只覆盖 `codex` 节点，其他节点行为保持不变。
3. 主进程与节点终端分离：
   - 主进程负责 workflow 调度、日志、run 状态、人工审批。
   - 节点窗口负责具体 `codex` 交互，允许用户完全自由接管。
4. 节点自行判断是否完成任务，并主动写入结构化状态。
5. 主进程监听节点状态变化，节点完成或失败后主动关闭对应外部终端窗口。
6. 继续兼容现有双目录模型：
   - `contextDir` 作为节点终端默认打开目录
   - `workdir` 作为真实业务目录
7. 提供一个基于现有 PTY demo 语义的新示例，并完成真实自测。

## 非目标

1. 首版不支持 `shell` 节点分离终端。
2. 首版不支持 `agent_session` 节点分离终端。
3. 首版不引入常驻后台服务、守护进程或网络 IPC。
4. 首版不做复杂窗口编排，例如平铺、窗口复用、TUI 面板。
5. 首版不要求 Linux/macOS/Windows 完全统一实现细节，但必须优先保证 Windows 可用，并保留跨平台适配边界。

## 方案对比

### 方案 A：主进程直接启动外部终端并运行 `codex`

- 优点：实现最短。
- 缺点：主进程拿不到节点级结构化状态；只能猜窗口是否退出；错误恢复和回流难以稳定实现。

### 方案 B：主进程启动外部终端，终端里运行 FlowBraid 节点助手

- 优点：
  - 保持主调度器与节点执行器解耦。
  - 节点助手可以标准化写回状态、产物和错误信息。
  - 主进程只需要监听 run workspace，不依赖解析终端输出。
  - 能和现有 `contextDir` / `workdir`、`review verdict`、回流逻辑平滑衔接。
- 缺点：需要新增一层内部 CLI 和终端启动器。

### 方案 C：常驻守护进程 + IPC

- 优点：后续能力最强。
- 缺点：首版复杂度明显过高，违反当前“先闭环后扩展”的原则。

### 结论

首版采用方案 B。

## 总体架构

### 新的交互模式

新增一个新的交互模式，暂定名称：

- CLI 开关：`--split-terminals`
- 内部运行模式标记：`interactiveMode = "split-terminal"`

调用方式保持一条命令：

```bash
flowbraid run <workflow-file> --interactive --split-terminals
```

或通过示例脚本暴露为：

```bash
npm run demo:split
```

### 运行链路

1. 用户启动 `flowbraid run ... --split-terminals`
2. 主进程创建 run workspace，进入调度循环
3. 遇到 `codex` 节点时：
   - 不在当前终端直接跑 PTY
   - 改为启动外部终端窗口
   - 外部终端窗口里运行 `flowbraid internal run-codex-node`
4. 节点助手子命令在独立窗口中：
   - 从 manifest 还原节点配置
   - 读取 `contextDir` 角色约束
   - 用 `--cd <workdir>` 调起真实 `codex`
   - 等待 `codex` 自然完成
   - 把结果写入节点状态文件和 artifacts
5. 主进程轮询或监听节点状态文件
6. 检测到节点完成或失败后：
   - 主动关闭对应外部终端窗口
   - 根据节点结果继续 workflow 流转
7. 整个流程直到 `approval` / `end` 为止，主进程一直驻留在原终端

## 组件设计

### 1. 主调度器扩展

`FlowBraidEngine` 新增对 split-terminal 模式的分支处理。

当满足以下条件时，`codex` 节点走分离终端模式：

- `interactiveTerminal` 已启用
- `splitTerminals` 选项为真
- 当前节点类型为 `codex`

主调度器在该模式下的职责：

1. 为节点准备状态目录：
   - `nodes/<node-id>/status.json`
   - `nodes/<node-id>/state/external-session.json`
2. 调用终端启动器，拉起外部窗口
3. 把启动信息写入状态文件
4. 进入等待循环，监视 `external-session.json`
5. 收到节点最终状态后，主动关闭窗口
6. 更新标准节点状态并继续原有成功/失败/暂停分支

### 2. 外部终端启动器

新增一个终端启动器模块，封装“在独立窗口中启动命令”。

建议抽象：

- `src/terminal-launchers/types.ts`
- `src/terminal-launchers/windows.ts`
- `src/terminal-launchers/index.ts`

首版至少实现 Windows：

- 通过 `Start-Process` 启动新的 PowerShell 窗口
- 新窗口执行 `node dist/cli.js internal run-codex-node ...`
- 需要拿到宿主窗口 PID，便于后续主动关闭

返回结构建议：

- `terminalPid`
- `launcherPid` 或 `processHandle`
- `close()`：关闭窗口

跨平台边界先保留接口，非 Windows 平台首版可以：

- 返回明确错误，提示 split-terminal 暂只支持 Windows
- 或退回现有单终端 PTY 模式

推荐首版优先失败显式化，不做静默降级。

### 3. 节点助手子命令

新增内部 CLI 子命令：

```bash
flowbraid internal run-codex-node --run-dir <run-dir> --node-id <node-id>
```

这是只给外部终端窗口调用的内部命令，不对普通用户文档暴露为常规用法。

职责：

1. 加载 manifest 和 run state
2. 还原指定 `codex` 节点定义
3. 写入 `external-session.json = launching`
4. 在独立窗口中运行真正的交互式 `codex`
5. 节点完成后主动写入最终状态：
   - `completed`
   - `failed`
6. 记录：
   - `terminalPid`
   - `workerPid`
   - `codexPid`
   - `exitCode`
   - `signal`
   - `completedAt`
   - `outputFile`
   - `error`
7. 写完最终状态后，短暂等待主进程关闭窗口；如果主进程未能关闭，则超时自退

### 4. 外部会话状态文件

新增状态文件：

`nodes/<node-id>/state/external-session.json`

建议结构：

```json
{
  "mode": "detached_terminal",
  "status": "launching",
  "terminalPid": 1234,
  "workerPid": 5678,
  "codexPid": 7890,
  "startedAt": "2026-05-03T00:00:00.000Z",
  "updatedAt": "2026-05-03T00:00:05.000Z",
  "completedAt": null,
  "exitCode": null,
  "signal": null,
  "resultFile": "artifacts/verify-report.md",
  "closeRequestedAt": null,
  "closeObservedAt": null,
  "error": null
}
```

`status` 枚举：

- `launching`
- `running`
- `completed`
- `failed`
- `aborting`

### 5. 节点完成判定

判定职责必须在节点侧，而不是主进程猜测。

具体语义：

- `codex exec`
  - `codex` 退出码为 0，则节点助手写 `completed`
  - 非 0，则写 `failed`
- `codex review`
  - `codex` 退出码非 0，则写 `failed`
  - `codex` 退出码为 0 后，节点助手继续解析输出文件中的 `verdict: approve|reject`
  - `approve` -> `completed`
  - `reject` -> `failed`
  - 未声明 verdict -> `failed`

这里的 `failed` 仍然是“节点结果”，不等于整个 run 失败。主进程仍按现有 `transitions.failure` 继续流转。

### 6. 主进程监听与主动关窗

主进程在 split-terminal 模式下，对单个 `codex` 节点执行等待循环：

1. 定期读取 `external-session.json`
2. 当状态仍为 `launching` / `running` 时：
   - 输出简洁日志，例如 `node develop running in external terminal`
   - 不阻塞其他内部状态持久化
3. 当状态变为 `completed` / `failed` 时：
   - 先把 FlowBraid 标准节点状态写为 `succeeded` / `failed`
   - 再调用终端启动器的关闭逻辑
   - 关闭请求写回 `closeRequestedAt`
   - 观察窗口是否已结束，写 `closeObservedAt`
4. 若关闭失败：
   - 在事件日志记录 `terminal.close_failed`
   - 节点助手等待固定超时后自行退出

这保证：

- 节点完成信号来自节点自身
- 终端关闭动作来自主进程
- 关闭失败时仍有兜底，不会无限挂窗

## CLI 设计

### 用户可见 CLI

新增运行开关：

- `flowbraid run <workflow> --interactive --split-terminals`

说明：

- `--interactive` 表示保留主进程持续交互能力
- `--split-terminals` 表示 `codex` 节点使用分离终端

后续如果这套成为默认模式，可以再把 `--interactive` 的默认语义切到 split-terminal，但本次不直接改变现有默认行为。

### 内部 CLI

新增内部子命令：

- `flowbraid internal run-codex-node --run-dir <dir> --node-id <id>`

约束：

- 只用于主进程启动节点窗口
- 普通帮助信息可以隐藏或弱化展示

## 双目录行为

split-terminal 模式必须延续现有双目录模型：

- 外部终端窗口默认打开在 `contextDir`
- 节点助手在该目录里启动 `codex`
- 真实业务执行路径仍通过 `--cd <workdir>` 指向共享工作目录

这样开发节点仍可以从 `demo-dev` 读角色约束，验收节点从 `demo-verify` 读验收约束，同时共同操作 `demo-workdir`。

## 示例设计

新增一个正式示例，建议名称：

- workflow：`examples/codex-split-demo.workflow.yaml`
- 启动脚本：`npm run demo:split`

流程沿用现有 PTY 主示例语义：

1. `prepare`
2. `develop`
3. `verify`
4. `approve`
5. `done`

验收逻辑保持不变：

1. 开发节点第一次只提交最小正确实现
2. 验收节点执行功能检查，并以“必须有注释”为硬性标准
3. 首次因缺少注释 `reject`，打回开发
4. 开发补注释
5. 验收通过
6. 人工审批可 `reject` 并给意见，回到开发
7. 再次验收通过后，人工 `approve`
8. 正常结束

差异只在交互方式：

- `develop` 和 `verify` 不再占用主窗口
- 每次节点执行都在新窗口中进行
- 主窗口持续显示流程进展和等待状态

## 状态与日志

### 标准状态

保持现有：

- `state/run.json`
- `nodes/<node-id>/status.json`
- `messages/events.jsonl`
- `messages/human-feedback.jsonl`

### 新增事件

建议新增事件类型：

- `terminal.launched`
- `terminal.close_requested`
- `terminal.closed`
- `terminal.close_failed`
- `node.external_session.updated`

### 诊断原则

- 所有窗口启动失败、状态文件缺失、状态超时、关闭失败都必须显式落盘
- 禁止仅打印控制台日志而不写事件文件

## 错误处理

### 启动失败

如果外部窗口启动失败：

- 节点记为 `failed`
- `detail` 写明启动器错误
- 如果节点配置了 `transitions.failure`，按失败分支继续
- 否则 run 失败结束

### 状态文件缺失或损坏

如果节点已启动，但主进程长时间读不到有效 `external-session.json`：

- 视为节点执行异常
- 记录 `terminal.state_invalid`
- 尝试关闭窗口
- 节点记为 `failed`

### 用户中断

当主进程收到 `Ctrl+C`：

1. 标记 run 为中断中
2. 对当前活跃外部节点发起关闭
3. 更新 `external-session.json = aborting`
4. 关闭失败时继续强制退出，但要把事件写盘

### 节点窗口被用户手动关闭

这是允许的，但必须被识别成异常节点结束：

- 若节点尚未写最终状态，主进程把它视为 `failed`
- 记录 `terminal.closed_before_result`

## 测试设计

### 单元测试

1. 终端启动命令拼装测试
2. `external-session.json` 读写测试
3. 主进程等待逻辑测试：
   - 从 `launching` 到 `running` 到 `completed`
   - 从 `running` 到 `failed`
   - 状态缺失 / 关闭失败
4. 内部 CLI 参数解析测试

### 集成测试

使用 fake codex 和 fake terminal launcher：

1. `develop` 节点在独立终端模式下完成并回写 `completed`
2. `verify` 节点第一次 `reject`，主进程按失败分支打回
3. 第二次 `verify` `approve`
4. `approval reject` 后回到开发，再次验收通过
5. 主进程在节点完成后调用窗口关闭逻辑

### 真实自测

必须实际运行：

```bash
npm run demo:split
```

验收标准：

1. 主窗口持续可见，能看到流程推进
2. `develop` 和 `verify` 会自动打开独立外部终端
3. 节点窗口中 `codex` 可正常自由交互
4. 节点完成后主进程能检测到完成并主动关闭该窗口
5. 示例能完整走完“缺注释打回 -> 修复 -> 人工 reject -> 再开发 -> 再验收 -> 人工 approve -> 结束”
6. 全程无未处理异常

## 分阶段落地顺序

### 第一阶段：协议与骨架

1. 扩展类型定义和 CLI 参数
2. 新增 `external-session.json` 协议
3. 新增内部 `run-codex-node` 子命令
4. 新增终端启动器接口和 Windows 实现

### 第二阶段：调度器接入

1. 主调度器在 split-terminal 模式下切换 `codex` 执行路径
2. 接入节点状态轮询与窗口关闭
3. 接通标准 `success` / `failure` / `review verdict` 流转

### 第三阶段：示例与回归

1. 新增 split demo workflow 和脚本
2. 为 fake terminal / fake codex 写集成测试
3. 完成真实 `npm run demo:split` 自测
4. 补充运行说明和问题处理文档

## 风险与取舍

### 风险 1：Windows 外部终端 PID 与 `codex` PID 不是同一个

处理：

- 状态文件同时记录 `terminalPid`、`workerPid`、`codexPid`
- 主进程关闭窗口时只关 `terminalPid`

### 风险 2：节点完成后主进程未能及时读到状态

处理：

- 使用短轮询，首版不强求文件系统事件监听
- 状态文件每次写入都更新 `updatedAt`

### 风险 3：窗口关闭失败

处理：

- 主进程记录失败事件
- 节点助手保留超时自退兜底

### 风险 4：真实 `codex` 行为慢

处理：

- 这是预期，不视为功能失败
- 主窗口应持续输出“当前节点运行中”而不是静默等待

## 结论

本设计通过“主进程调度 + 外部终端节点助手 + 文件状态协议”的组合，在不引入后台服务的前提下，为 `codex` 节点提供了独立窗口交互能力。它延续了当前 FlowBraid 的本地优先、显式状态、双目录协作和可恢复运行模型，也为后续把 split-terminal 逐步演进成默认交互模式留出了清晰边界。
