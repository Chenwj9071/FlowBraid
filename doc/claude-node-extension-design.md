# FlowBraid `claude` 节点扩展技术方案

## 1. 背景

当前 FlowBraid 已经具备较完整的任务型 `codex` 节点闭环能力：

- 基于本地 CLI 执行任务型 agent 节点
- 通过 `runtime-state + outcome` 作为节点完成真源
- 支持 PTY 交互模式和 native split 外部终端模式
- 支持节点级 `reentry.mode`
- 支持在 `recover` 中恢复同节点历史会话
- 支持 `contextDir / workdir` 双目录模型

现阶段的限制是：

- 任务型 agent 节点只支持 `type: codex`
- `agent_session` 只支持 `provider: codex`
- `engine`、`recovery`、CLI 参数、native session 探测和 prompt 生成都对 `codex` 有显式耦合

本次需求不是扩展 `agent_session`，而是扩展任务型节点，使工作流作者可以只把节点类型从 `codex` 改成 `claude`，就切换到本地 `Claude Code CLI` 承担同类工作。

## 2. 目标与边界

### 2.1 目标

首版 `claude` 节点要尽量对齐当前 `codex` 节点能力：

- 支持非交互执行
- 支持 PTY 交互执行
- 支持 native split 外部终端执行
- 支持 `reentry.mode: resume | new_with_history | new`
- 支持 `recover` 时优先恢复同节点历史会话
- 继续使用现有 `runtime-state + outcome` 协议
- 尽量少影响现有 `codex` 路径和现有 workflow 写法

### 2.2 非目标

本阶段不包含：

- 扩展 `agent_session.provider=claude`
- 把现有 `codex` / `claude` 完全重命名为统一公开类型，例如 `agent_task`
- 重做 `approval`、`gate`、`recover` 的状态机语义
- 重构整个终端启动框架
- 一次性引入多 provider 插件系统

## 3. 现状分析

### 3.1 当前 `codex` 节点的真实职责

当前 `codex` 节点并不只是“调用一个 CLI 命令”，而是一整套运行时协议：

1. 由 workflow 类型系统识别和校验
2. 由调度器为每次进入生成独立 `attemptId`
3. 通过 prompt 注入 FlowBraid 协议、回流上下文、人工反馈和完成命令
4. 通过 `runtime-state.json` 和 `events.jsonl` 决定节点如何流转
5. 在 native split 下维护 `native-session.json`
6. 在回流场景下绑定并恢复“该节点自己的会话”
7. 在 `recover` 中根据运行态和会话态决定是自动继续还是人工确认

因此，`claude` 扩展的关键不是复制一份命令调用代码，而是复用这一整套运行时壳层。

### 3.2 当前实现中的 `codex` 耦合点

主要耦合点如下：

- `src/types.ts`
  - `NodeKind` 只有 `codex`
  - `CodexNodeDefinition` 单独定义
  - `RunnerOptions` 只有 `codexCommand`
- `src/workflow.ts`
  - 只校验 `codex` 节点
  - `agent_session.provider` 只允许 `codex`
- `src/engine.ts`
  - `runCodexNode()`
  - `runNativeSplitCodexNode()`
  - `resolveCodexReentryMode()`
  - `waitForCodexSessionId()`
  - `buildCodexReentryContext()`
- `src/executors/codex.ts`
  - `codex` CLI 调用参数构造
  - PTY/native interactive 执行
  - native wrapper spec 只面向 `codex`
- `src/codex-prompt.ts`
  - 文件名和类型名是 `codex`
  - 但内容其实大部分已是 FlowBraid 通用协议
- `src/native-session.ts`
  - 仅实现 `codex` 会话 id 探测
- `src/recovery.ts`
  - 只在 `node.type === 'codex'` 下做任务型会话恢复诊断
- `src/cli.ts` / `src/runtime-options.ts`
  - 暴露的是 `--codex-command` / `FLOWBRAID_CODEX_COMMAND`

### 3.3 为什么不能直接平行复制一套 `claude`

如果直接新增一套 `claude.ts` 并在 `engine` 里再写一遍平行分支，会产生以下问题：

- `engine` 中任务型 agent 执行逻辑复制
- `recover` 逻辑复制
- native split 会话持久化和恢复逻辑复制
- prompt 协议复制
- 测试矩阵膨胀且难以保持行为一致
- 未来修复 Windows 终端、attempt 隔离、回流协议时需要双份修改

这不符合“功能完整性和稳定性优先、尽量少影响现有功能”的目标。

## 4. 设计原则

本方案采用以下原则：

- 对用户保持显式配置
- 对已有 `codex` 工作流保持兼容
- 先抽共享的任务型 agent 运行时，再接入 `claude`
- 优先复用现有 `runtime-state + outcome` 协议，不引入第二套完成协议
- 会话恢复必须继续绑定“节点自己的历史会话”，不能基于共享 `workdir` 推断别的节点会话
- 首版优先保证 `codex` 与 `claude` 外部行为一致，而不是追求内部抽象一步到位

## 5. 推荐总体方案

### 5.1 对外语义

对外继续保留明确的节点类型：

- `type: codex`
- `type: claude`

工作流作者的使用目标是：

```yaml
develop:
  type: codex
```

可以直接改为：

```yaml
develop:
  type: claude
```

其余字段尽量保持一致：

- `prompt`
- `workdir`
- `contextDir`
- `model`
- `outputFile`
- `reentry.mode`
- `transitions`

### 5.2 内部架构

内部新增一层“任务型 agent provider 抽象”，将现有 `codex` 节点拆为：

1. 通用任务型 agent 运行时壳层
2. provider 适配器

推荐结构：

- `src/task-agent/` 或等价目录
  - provider 类型定义
  - provider 解析
  - 通用 prompt 构建
  - provider-specific invocation 构建

但首版可以不强行新建很多目录，允许先在现有文件内完成最小抽象，只要边界明确。

### 5.3 共享与差异

共享能力：

- 调度循环
- `attemptId`
- `timeline`
- `status.json`
- `runtime-state.json`
- `native-session.json`
- `events.jsonl`
- `approval` / `gate` / `recover`
- `reentry.mode`
- FlowBraid 完成协议
- terminal launcher

provider 差异：

- 实际 CLI 命令名
- 非交互命令行参数
- PTY/native split 的启动参数
- 恢复会话的调用参数
- 会话引用的持久化与探测方式
- prompt 中对上下文文件的兼容策略

## 6. 类型与配置设计

### 6.1 节点类型

在 `src/types.ts` 中新增：

- `NodeKind` 增加 `claude`
- 抽取任务型 agent 共享字段
- 新增 `ClaudeNodeDefinition`

推荐类型关系：

- `TaskAgentNodeBase`
  - `prompt`
  - `cwd`
  - `workdir`
  - `contextDir`
  - `model`
  - `outputFile`
  - `reentry`
- `CodexNodeDefinition extends TaskAgentNodeBase`
- `ClaudeNodeDefinition extends TaskAgentNodeBase`

这样可以保证两类节点的配置形状尽可能一致。

### 6.2 运行参数

`RunnerOptions` 需要从仅支持 `codexCommand` 扩展为支持多 provider 命令覆盖。

推荐方案：

- 保留 `codexCommand?: string`
- 新增 `claudeCommand?: string`

对应 CLI：

- `--codex-command`
- `--claude-command`

对应环境变量：

- `FLOWBRAID_CODEX_COMMAND`
- `FLOWBRAID_CLAUDE_COMMAND`

首版不建议直接删除 `codexCommand`，避免不必要兼容风险。

## 7. 任务型 agent provider 抽象

### 7.1 抽象目标

把“如何调用某个 agent CLI”从“如何驱动 FlowBraid 节点运行”中拆开。

### 7.2 推荐接口

建议新增内部接口：

```ts
interface TaskAgentProvider {
  kind: 'codex' | 'claude';
  resolveCommand(options: RunnerOptions): string | undefined;
  buildExecInvocation(input: ProviderInvocationInput): ProviderInvocation;
  buildResumeInvocation(input: ProviderResumeInvocationInput): ProviderInvocation;
  canResume(sessionRef: ProviderSessionRef | null): boolean;
}
```

其中：

- `ProviderInvocation`
  - `command`
  - `args`
  - `cwd`
  - `env?`
- `ProviderSessionRef`
  - `kind`
  - `value`

### 7.3 为什么 `sessionRef` 不能继续只用 `sessionId`

当前 `codex` 路径的恢复依赖 `sessionId`，这是因为本地 `codex` 会话探测就是按该模型实现的。

但对 `claude` 来说，首版不应假设其本地会话文件结构稳定可扫。更稳妥的抽象是统一为：

```ts
type ProviderSessionRef =
  | { kind: 'session_id'; value: string }
  | { kind: 'session_name'; value: string };
```

这样：

- `codex` 可以继续用 `session_id`
- `claude` 首版可以优先用 `session_name`

## 8. Prompt 设计

### 8.1 核心判断

当前 `src/codex-prompt.ts` 的内容名义上是 `codex prompt`，实际上大部分已经是 FlowBraid 的任务节点协议，不应继续和 provider 名字绑定。

因此建议：

- 将 `codex-prompt.ts` 重命名或抽象为通用 `task-agent-prompt.ts`
- prompt 内容继续以 FlowBraid 协议为主
- provider 只决定少量差异化补充

### 8.2 通用部分

以下内容应继续通用：

- `FlowBraid Protocol`
- `Re-entry Priority`
- `Re-entry Evidence`
- `Task Reference`
- `Required Commands`
- native split addendum

### 8.3 `contextDir` 指令文件兼容策略

当前项目主要依赖 `AGENTS.md`。

对于 `claude`，首版不应要求用户必须改造上下文目录结构。因此建议：

1. 优先读取 `contextDir/CLAUDE.md`
2. 若不存在，再读取 `contextDir/AGENTS.md`
3. 将读取到的指令内容以“显式引用路径 + 摘要/原文片段”的方式注入 prompt
4. 不依赖 CLI 自己是否自动发现这些文件

这样可以保持：

- 现有示例目录仍可直接复用
- `claude` 节点不需要额外迁移成本
- FlowBraid 明确掌控任务协议和回流上下文

### 8.4 完成协议

`claude` 节点必须继续使用和 `codex` 相同的完成协议：

- `flowbraid node complete --outcome success`
- `flowbraid node complete --outcome approve`
- `flowbraid node complete --outcome reject`
- `flowbraid node fail --message "..."`

不允许为 `claude` 设计第二套完成语义。

## 9. 执行模式设计

### 9.1 非交互模式

非交互模式下，调度器调用 provider adapter 生成命令调用，统一走共享任务执行器。

共享行为：

- stdout/stderr 继续写入 `log.txt`
- `outputFile` 继续落盘到 `artifacts/`
- 仍由 `runtime-state.json` 和 outcome 决定最终流转

### 9.2 PTY 交互模式

PTY 交互模式仍复用现有终端桥接逻辑：

- 终端读写
- Windows UTF-8 控制台切换
- 终端 reset
- abort 处理

只替换 provider-specific invocation 构造。

### 9.3 Native Split 模式

native split 继续保留现有主控流：

1. 生成本次节点 prompt
2. 生成 wrapper spec
3. 启动独立终端
4. 由 wrapper 拉起目标 CLI
5. 等待 `native-session.json` 或事件达到终态
6. 请求关闭外部终端
7. 再根据 `runtime-state` 决定流转

建议把现在的 `run-codex-wrapper` 重命名或泛化为：

- `run-task-agent-wrapper`

但为降低首轮改动风险，也可以先保留命令名，内部允许 spec 标识 provider。

## 10. 会话恢复设计

### 10.1 设计目标

回流和 `recover` 的稳定性依赖“节点自己的历史会话可以被可靠恢复”。

当前 `codex` 已实现：

- 同一 run 内回到同一节点时优先恢复该节点自己的 `sessionId`
- 不根据共享 `workdir` 推断别的节点会话

`claude` 必须遵守同样原则。

### 10.2 会话持久化结构

建议在 `native-session.json` 中补充：

- `provider`
- `sessionRef`

并在 `status.json` 中补充：

- `sessionRef`

兼容策略：

- 继续保留现有 `sessionId` 字段
- `codex` 读取时优先兼容 `sessionId`
- 新逻辑优先读 `sessionRef`

推荐结构示意：

```json
{
  "mode": "native_split_terminal",
  "provider": "claude",
  "status": "running",
  "attemptId": "attempt-xxx",
  "sessionRef": {
    "kind": "session_name",
    "value": "flowbraid/<runId>/<nodeId>"
  }
}
```

### 10.3 `claude` 会话恢复策略

首版建议：

- 新会话时，为节点生成稳定的 `session_name`
- 格式推荐：`flowbraid/<runId>/<nodeId>`
- 回流恢复时，优先使用该 `session_name` 恢复

这样可以避免首版强依赖本地私有会话文件扫描。

### 10.4 `codex` 兼容策略

`codex` 保持现有恢复路径：

- 启动后按 `workdir + startedAt` 探测最新 `sessionId`
- 回流时优先恢复该节点自己最近一次持久化的 `sessionId`

后续如需统一，也可以让 `codex` 同时持久化 `sessionRef`。

## 11. Recovery 设计

### 11.1 现状问题

`src/recovery.ts` 当前显式写死 `node.type === 'codex'`，这会导致：

- `claude` 即使具备同样的运行态和会话态，也无法走自动恢复分支

### 11.2 推荐调整

将恢复判断改成“支持会话恢复的任务型 agent 节点”：

- `codex`
- `claude`

诊断逻辑保持不变：

- 若当前 run 已 paused，则走 `resume_paused`
- 若当前 attempt 的 `runtime-state` 已终态，则走 `finalize_then_continue`
- 若存在可恢复的 provider session ref，则走 `resume_task_agent_session`
- 否则走 `confirm_recovery`

### 11.3 行为要求

`recover` 对 `claude` 的语义必须与 `codex` 一致：

- 优先自动恢复可确定场景
- 不确定场景进入人工恢复确认
- 所有恢复动作都有审计事件

## 12. CLI 与文档设计

### 12.1 CLI 参数

新增：

- `--claude-command`

保留：

- `--codex-command`

### 12.2 Workflow Help

以下文档与帮助需要同步更新：

- `src/cli.ts` 中的 `workflow-help`
- `doc/workflow-authoring.md`
- `doc/requirements.md`
- `doc/architecture.md`
- `doc/progress.md`

更新内容包括：

- 节点类型从 `shell / codex / agent_session / ...` 扩展为 `shell / codex / claude / agent_session / ...`
- 明确 `claude` 也是任务型 agent 节点
- 明确 `agent_session.provider` 本阶段仍只支持 `codex`

## 13. 数据与状态变更

### 13.1 保持不变

以下文件结构和主语义保持不变：

- `state/run.json`
- `state/timeline.json`
- `nodes/<node-id>/status.json`
- `nodes/<node-id>/state/runtime-state.json`
- `messages/events.jsonl`
- `messages/human-feedback.jsonl`

### 13.2 建议新增字段

`nodes/<node-id>/status.json`

- `provider?: "codex" | "claude"`
- `sessionRef?: { kind: string; value: string }`

`nodes/<node-id>/state/native-session.json`

- `provider?: "codex" | "claude"`
- `sessionRef?: { kind: string; value: string }`

### 13.3 兼容要求

- 旧 run 目录结构仍可被读取
- 缺少 `provider` 和 `sessionRef` 时，`codex` 逻辑继续按旧字段兼容
- 新逻辑不能破坏现有 `recover`、`status`、`native split` 读取

## 14. 风险与规避

### 14.1 风险一：直接复用 `codex` prompt 文件名与语义造成长期混乱

规避：

- 尽早把 prompt builder 抽象为通用任务型 agent prompt
- 文件名和类型名不要继续扩大 `codex` 语义

### 14.2 风险二：`claude` 的会话恢复如果依赖私有本地文件结构，稳定性不足

规避：

- 首版优先使用稳定的显式 `session_name` 方案
- 不把本地会话目录扫描作为首要恢复路径

### 14.3 风险三：双目录模型在 `claude` 下行为偏移

规避：

- 不依赖 CLI 自动发现 `AGENTS.md`
- 由 FlowBraid 主动将 `contextDir` 指令注入 prompt
- 继续显式传递 `workdir` 概念

### 14.4 风险四：Windows PTY / native split 行为与 `codex` 不一致

规避：

- 增加单独 smoke test
- 先打通 fake runner
- 再补真实 CLI 的手工验证

### 14.5 风险五：首轮重构过大影响现有 `codex`

规避：

- 先抽最小共享边界
- 保持 `codex` 现有调用链可运行
- 以“先等价迁移、再增量接入 `claude`”为节奏

## 15. 测试策略

### 15.1 自动化测试范围

需要覆盖：

- workflow 校验接受 `type: claude`
- CLI 参数解析接受 `--claude-command`
- 非交互 `claude` 节点按 `runtime-state + outcome` 流转
- PTY 模式下 `claude` 节点可运行
- native split 下 `claude` 节点可运行
- `reentry.mode`
  - `resume`
  - `new_with_history`
  - `new`
- `recover` 能识别并恢复 `claude` 节点
- `codex` 现有测试全部继续通过

### 15.2 测试分层

建议分三层：

1. 类型与 workflow 校验测试
2. 运行时单测与 fake CLI 集成测试
3. 真实 CLI 手工验证

### 15.3 手工验证重点

至少验证：

- Windows native split 的外部终端启动与关闭
- 回流到同一 `claude` 节点时恢复的是本节点历史会话
- 共享 `workdir` 的多个节点不会串会话
- `recover` 在主进程中断后可恢复 run

## 16. 分阶段实施计划

以下计划以“低风险迁移 + 渐进接入”为原则。

### 阶段 1：抽取共享任务型 agent 边界

目标：

- 把当前 `codex` 节点运行时中的通用部分抽出来
- 对外行为保持不变

建议改动：

- `src/types.ts`
  - 新增共享任务型节点基础类型
- `src/engine.ts`
  - 提炼 `runTaskAgentNode` 共享路径
  - 提炼 `runNativeSplitTaskAgentNode` 共享路径
- `src/codex-prompt.ts`
  - 改为通用 prompt builder，或新增通用 builder 并保留兼容入口
- `src/recovery.ts`
  - 改造恢复判断，先支持“任务型 agent 节点”抽象

验收标准：

- 所有现有 `codex` 测试继续通过
- 对外 workflow 配置和 CLI 行为不变

### 阶段 2：新增 `claude` 节点类型与 CLI 参数

目标：

- 让 workflow 能声明 `type: claude`
- 让运行器可解析 `claude` 命令覆盖

建议改动：

- `src/types.ts`
  - 新增 `ClaudeNodeDefinition`
- `src/workflow.ts`
  - 校验 `claude` 节点
- `src/runtime-options.ts`
  - 增加 `claudeCommand`
- `src/cli.ts`
  - 增加 `--claude-command`
  - 更新 help 文案

验收标准：

- `validate` 能接受 `type: claude`
- `workflow-help` 能正确展示 `claude`

### 阶段 3：实现 `claude` provider adapter

目标：

- 打通 `claude` 的非交互、PTY、native split 启动能力

建议改动：

- 新增 `src/executors/claude.ts` 或通用 provider invocation builder
- 新增 provider 解析逻辑
- 统一 wrapper spec，使其能标识 provider

实施重点：

- 非交互 invocation
- PTY invocation
- native split new session invocation
- native split resume invocation

验收标准：

- fake `claude` runner 下可跑通基本成功/失败分支

### 阶段 4：实现 `claude` 会话恢复与 `recover` 集成

目标：

- 回流与 `recover` 可恢复同节点 `claude` 会话

建议改动：

- `native-session.json` 持久化 `provider + sessionRef`
- `status.json` 补 `sessionRef`
- `recovery.ts` 支持 `claude`
- `engine.ts` 支持 provider-aware resume

实施重点：

- `session_name` 生成与持久化
- `resume` 时只恢复本节点自己的 session ref

验收标准：

- 回流到同一 `claude` 节点时能恢复同一历史会话
- `recover` 能正确走自动恢复路径

### 阶段 5：文档、示例与回归验证

目标：

- 补齐文档、示例和回归测试矩阵

建议改动：

- 新增 `claude` 示例 workflow
- 更新 `doc/workflow-authoring.md`
- 更新 `doc/requirements.md`
- 更新 `doc/architecture.md`
- 更新 `doc/progress.md`

验收标准：

- 示例可运行
- 文档与实现一致
- 关键回归测试通过

## 17. 详细实施清单

建议按以下顺序推进：

1. 类型抽象与 workflow 校验
2. `RunnerOptions` 和 CLI 参数扩展
3. 通用 prompt builder 抽象
4. `engine` 共享任务型 agent 执行路径抽取
5. native split wrapper 泛化
6. provider session ref 结构落盘
7. `claude` provider 非交互接入
8. `claude` provider PTY 接入
9. `claude` provider native split 接入
10. `claude` 回流恢复
11. `recover` 集成
12. 示例、文档、回归测试

## 18. 文件级改动建议

### 18.1 必改文件

- `src/types.ts`
- `src/workflow.ts`
- `src/engine.ts`
- `src/recovery.ts`
- `src/runtime-options.ts`
- `src/cli.ts`
- `src/executors/codex.ts`
- `src/native-session.ts`

### 18.2 建议新增文件

- `src/executors/claude.ts`
- `src/task-agent-provider.ts` 或等价文件
- `test/claude-*.test.ts`
- `examples/claude-*.workflow.yaml`

### 18.3 文档文件

- `doc/claude-node-extension-design.md`
- `doc/workflow-authoring.md`
- `doc/requirements.md`
- `doc/architecture.md`
- `doc/progress.md`

## 19. 预期收益

落实本方案后，可以得到：

- 用户侧几乎零学习成本地从 `codex` 切换到 `claude`
- 不破坏当前 `codex` 已验证的主路径
- 为后续更多任务型 provider 留下明确边界
- 避免把 `agent_session` 与任务型节点语义混在一起
- 在稳定性优先前提下，把扩展成本集中在 provider adapter，而不是复制整个运行时

## 20. 结论

本次 `claude` 扩展最稳妥的路径是：

- 对外新增 `type: claude`
- 对内抽共享任务型 agent 运行时
- 保留 `codex` 兼容路径
- 首版统一沿用 `runtime-state + outcome`
- 首版把 `claude` 会话恢复建立在显式 `sessionRef` 上

这条路径兼顾了：

- 功能完整性
- 回流与恢复稳定性
- 对现有功能的最小扰动
- 后续继续扩展 provider 的可演进性
