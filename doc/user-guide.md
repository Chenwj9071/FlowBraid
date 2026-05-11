# FlowBraid 使用指南

本文是一份从零开始的完整使用说明，覆盖三部分：

1. 安装命令
2. 工作流编写说明
3. 工作流执行方式

如果你第一次接触 FlowBraid，建议直接按本文顺序阅读和操作。

## 1. FlowBraid 是什么

FlowBraid 是一个本地优先的 CLI 工作流编排器，用来把一组节点按固定流程串起来执行。它适合这类场景：

- 需要 `shell` 命令和 `codex` 节点混合执行
- 需要人工门禁、人工审批和回流
- 需要中断后继续执行
- 需要把运行状态、日志和产物落盘保存

FlowBraid 的核心特点是：

- 工作流定义和运行状态分离
- 节点目录和业务目录分离
- 支持 `resume`、`send`、`approval reject -> loopback`
- `codex` 主路径基于 `runtime-state + outcome` 流转

## 2. 安装

### 2.1 环境前提

当前至少需要：

- Node.js
- npm

如果要运行 `codex` 节点，还需要本机已有可调用的 `codex` CLI。

安装完成后，目标状态应当是：

```bash
flowbraid --help
```

可以直接执行。

### 2.2 开发态运行

如果你只是想在当前仓库里开发或调试：

```bash
npm install
npm run dev -- --help
```

也可以直接运行示例：

```bash
npm run dev -- run examples/codex-native-split-demo.workflow.yaml
```

这条链路直接使用源码入口 `src/cli.ts`，适合开发，不适合作为最终安装方式。

### 2.3 本机安装为命令

如果你希望把当前仓库安装成一条稳定命令：

```bash
npm install
npm run build
npm install -g .
```

安装后验证：

```bash
flowbraid --help
```

如果你不想全局安装，也可以用：

```bash
npm link
flowbraid --help
```

### 2.4 打包后安装

如果你要验证发布包或做离线分发：

```bash
npm pack
npm install -g .\\flowbraid-0.1.0.tgz
flowbraid --help
```

### 2.5 为什么安装后必须能直接调用 `flowbraid`

当前 `codex` 节点 prompt 协议默认注入的完成命令是：

```bash
flowbraid node complete ...
flowbraid node fail ...
```

所以安装态的基本要求是：

- `flowbraid` 命令在 PATH 中可用
- 不依赖 `tsx src/cli.ts`
- 不依赖开发机绝对路径形式的 `node D:\\...\\cli.js`

## 3. 工作流基础概念

在写 FlowBraid 工作流前，先明确三个目录概念：

- `run workspace`
  - 一次运行的落盘目录
  - 用于保存状态、消息、日志和节点产物
- `contextDir`
  - 节点终端默认打开的上下文目录
  - 用来放该节点自己的 `AGENTS.md`、角色说明和局部规则
- `workdir`
  - 共享业务目录
  - 节点真正修改和验证业务文件的地方

默认情况下：

- workflow 文件所在目录就是默认工作目录
- `.flowbraid-runs/` 也默认创建在该目录下

## 4. 工作流文件格式

FlowBraid 支持：

- `.yaml`
- `.yml`
- `.json`

推荐优先使用 YAML，因为更适合写多行 `prompt` 和 `command`。

## 5. 最小工作流示例

下面是一个最小可运行示例：

```yaml
id: hello-demo
start: hello
nodes:
  hello:
    type: shell
    command: echo hello
    next: done

  done:
    type: end
    message: finished
```

执行：

```bash
flowbraid run path/to/workflow.yaml
```

## 6. 顶层字段说明

一个常见工作流通常长这样：

```yaml
id: your-workflow-id
start: first-node-id
workdir: ./shared-workdir
contextDir: ./default-context
nodes:
  ...
```

字段说明：

- `id`
  - 必填
  - 工作流唯一标识
- `start`
  - 必填
  - 起始节点 id
- `workdir`
  - 可选
  - workflow 级默认业务目录
- `contextDir`
  - 可选
  - workflow 级默认上下文目录
- `nodes`
  - 必填
  - 节点字典

## 7. 节点通用字段

所有节点都支持这些通用字段：

- `type`
  - 节点类型
- `title`
  - 可选说明，不参与调度
- `next`
  - 默认后继节点
- `transitions`
  - 显式分支

当前支持的节点类型有：

- `shell`
- `codex`
- `agent_session`
- `gate`
- `approval`
- `end`

推荐规则：

- 只有一个正常后继时用 `next`
- 有成功/失败分支时用 `transitions.success` / `transitions.failure`
- `approval` 使用 `transitions.approve` / `transitions.reject`

## 8. 各节点类型怎么写

### 8.1 `shell`

```yaml
prepare:
  type: shell
  workdir: ./demo-workdir
  contextDir: ./demo-workdir
  command: echo prepare
  next: develop
```

说明：

- `command` 必填
- `cwd` 可选，默认使用该节点解析后的 `contextDir`
- 退出码 `0` 视为成功
- 非 `0` 视为失败

### 8.2 `codex`

```yaml
develop:
  type: codex
  contextDir: ./demo-dev
  workdir: ./demo-workdir
  prompt: |
    Read AGENTS.md first, then implement the task.
  outputFile: develop-last-message.md
  transitions:
    success: verify
    failure: verify
```

说明：

- `prompt` 必填
- `outputFile` 默认是 `codex-last-message.md`
- `model` 可选
- `reentry.mode` 可选

当前推荐把 `codex` 节点写成“任务 + outcome 上报”模式，而不是依赖自然语言 `verdict` 解析。

#### `codex` 节点完成协议

在推荐写法下，prompt 应明确要求：

- 任务完成后调用 `flowbraid node complete --outcome ...`
- 无法继续时调用 `flowbraid node fail`

常见 outcome：

- `success`
  - 普通任务完成
- `approve`
  - 验收通过
- `reject`
  - 验收打回

调度器会优先读取：

- `nodes/<node-id>/state/runtime-state.json`
- 当前 attempt 的最新 outcome

所以 `runtime-state + outcome` 才是主真源。

#### `reentry.mode`

`codex` 节点支持：

```yaml
reentry:
  mode: resume
```

可选值：

- `resume`
  - 默认值
  - 回流时优先恢复同节点历史会话
- `new_with_history`
  - 开新会话，但带上历史上下文
- `new`
  - 开新会话，只保留当前必要引导

#### native split 终端失联处理

对于 native split 模式下的 `codex` 节点，当前默认行为是：

- 不使用固定时长硬超时判定失败
- 只要外部终端仍存活，调度器就继续等待节点显式上报终态
- 如果外部终端确认失联，run 会暂停在当前 `codex` 节点，等待人工决定下一步

此时应使用：

```bash
flowbraid resume <run-dir> --decision retry-current
flowbraid resume <run-dir> --decision continue-next
```

适用场景：

- `retry-current`
  - 终端意外关闭，但你希望重新拉起当前节点再做一次
- `continue-next`
  - 你确认当前节点结果可以接受，或者希望人工跳过该节点继续往后跑

### 8.3 `agent_session`

```yaml
discuss:
  type: agent_session
  provider: codex
  prompt: |
    Ask the user what to build first.
    If information is still missing, return waiting_input.
    If the task boundary is clear, return completed.
  outputFile: turn-result.json
  next: done
```

说明：

- 当前 `provider` 只支持 `codex`
- 这是长期交互节点
- 每次只执行一轮 turn
- `waiting_input` 时 run 进入 `paused`
- 必须通过 `flowbraid send <run-dir> <message>` 继续

### 8.4 `gate`

```yaml
checkpoint:
  type: gate
  prompt: |
    Check the generated files, then continue.
  next: next-step
```

说明：

- 进入后 run 会暂停
- 通过 `flowbraid resume <run-dir>` 继续

### 8.5 `approval`

```yaml
approve:
  type: approval
  prompt: |
    Human confirmation is required.
  transitions:
    approve: done
    reject: develop
```

说明：

- 必须通过 `flowbraid resume <run-dir> --decision approve|reject` 继续
- `reject` 时当前实现要求带 `--message`
- 人工反馈会写入 `messages/human-feedback.jsonl`

### 8.6 `end`

```yaml
done:
  type: end
  message: workflow completed
```

说明：

- 到达后工作流结束

## 9. 推荐编排模式

最常见的闭环是：

```yaml
id: standard-loop
workdir: ./demo-workdir
contextDir: ./demo-dev
start: prepare
nodes:
  prepare:
    type: shell
    command: echo prepare
    next: develop

  develop:
    type: codex
    contextDir: ./demo-dev
    workdir: ./demo-workdir
    prompt: |
      Implement the task.
      When finished, report the final result with:
      `flowbraid node complete --outcome success`
    next: verify

  verify:
    type: codex
    contextDir: ./demo-verify
    workdir: ./demo-workdir
    prompt: |
      Verify the task.
      Write the verification report to the artifact path.
      If verification fails, report:
      `flowbraid node complete --outcome reject`
      If verification passes, report:
      `flowbraid node complete --outcome approve`
    transitions:
      success: approve
      failure: develop

  approve:
    type: approval
    transitions:
      approve: done
      reject: develop

  done:
    type: end
```

这个模式里：

- `develop` 负责修改共享业务目录
- `verify` 负责验证并给出最终 outcome
- `approval` 负责最终人工确认
- 回流依赖显式状态和结构化反馈

## 10. 工作流怎么执行

### 10.1 运行前校验

建议先校验：

```bash
flowbraid validate path/to/workflow.yaml
```

### 10.2 启动运行

非交互运行：

```bash
flowbraid run path/to/workflow.yaml
```

交互运行：

```bash
flowbraid run path/to/workflow.yaml --interactive
```

如果你明确不想进入交互模式：

```bash
flowbraid run path/to/workflow.yaml --no-interactive
```

### 10.3 继续执行 paused 的 run

普通门禁继续：

```bash
flowbraid resume <run-dir>
```

审批通过：

```bash
flowbraid resume <run-dir> --decision approve
```

审批打回：

```bash
flowbraid resume <run-dir> --decision reject --message "补充说明"
```

codex 终端失联后重试当前节点：

```bash
flowbraid resume <run-dir> --decision retry-current
```

codex 终端失联后继续后续节点：

```bash
flowbraid resume <run-dir> --decision continue-next
```

### 10.4 `recover` 的使用方式

`recover` 用于主调度器异常退出、终端误关或 run 进入不一致状态后的重新接管。

推荐直接执行：

```bash
flowbraid recover <run-dir>
```

当前实现会先读取 run 落盘状态，再决定如何接管：

- 如果当前是正常 `paused` 的 `approval` 节点，会恢复到审批等待状态，并继续进入 `approve/reject` 交互
- 如果当前是正常 `paused` 的 `gate` 节点，会恢复到 gate 等待继续状态
- 如果当前是 codex 终端失联后的人工决策暂停，会恢复到该节点的人工处理交互
- 只有在状态不足以自动判断时，才需要额外指定恢复决策

因此，通常不需要在执行 `recover` 前先知道工作流停在哪个节点。

### 10.5 续 `agent_session` 发送输入

```bash
flowbraid send <run-dir> "继续执行"
```

### 10.6 查看运行状态

```bash
flowbraid status <run-dir>
flowbraid status <run-dir> --json
```

## 11. 一次完整执行示例

假设你有一个工作流文件：

```bash
flowbraid validate examples/codex-native-split-demo.workflow.yaml
flowbraid run examples/codex-native-split-demo.workflow.yaml --interactive
```

运行中你可能会看到类似输出：

```text
[run] started 20260506-123456-abcdef
[run] workspace D:\Code\FlowBraid\examples\.flowbraid-runs\20260506-123456-abcdef
[run] step 1: enter node develop (codex)
[run] node develop succeeded, next verify
[run] step 2: enter node verify (codex)
[run] paused at approve: Human confirmation is required
run 20260506-123456-abcdef => paused
workspace: D:\Code\FlowBraid\examples\.flowbraid-runs\20260506-123456-abcdef
```

这时你可以根据节点类型继续：

- `gate` 节点用 `resume`
- `approval` 节点用 `resume --decision ...`
- codex 终端失联后的人工决策暂停用 `resume --decision retry-current|continue-next`
- `agent_session` 节点用 `send`
- 主调度器异常退出或 run 状态异常时用 `recover`

## 12. 运行产物在哪里

一次运行常见会生成这些文件：

- `state/run.json`
  - run 总状态
- `state/timeline.json`
  - 每步执行时间线
- `nodes/<node-id>/status.json`
  - 节点级状态
- `nodes/<node-id>/state/runtime-state.json`
  - 任务型节点运行态真源
- `messages/events.jsonl`
  - 全局事件流
- `messages/human-feedback.jsonl`
  - 审批反馈
- `nodes/<node-id>/artifacts/`
  - 节点输出产物

## 13. 常见错误

- `start` 指向不存在的节点
- `approval` 没有配置 `approve` 或 `reject`
- `agent_session` 错用 `resume`
- 把正常 paused 的 `approval` / `gate` / codex 人工决策场景错误交给 `recover --decision ...`
- `codex` prompt 没有明确要求上报 `flowbraid node complete --outcome ...`
- 新 workflow 仍把 `mode: review + verdict:` 当成主完成协议
- 把 `contextDir` 当成真实业务修改目录

## 14. 推荐实践

- 一个节点只做一种职责
- 开发和验收使用不同 `contextDir`
- 共享真实业务目录统一放到 `workdir`
- `codex` prompt 中明确写出 `complete` / `fail` 触发条件
- 验收节点同时产出报告和最终 outcome
- 人工 `reject` 时给出具体意见

## 15. 从哪里继续看

如果你需要更细的说明，可以继续看：

- `doc/installation.md`
- `doc/workflow-authoring.md`
- `doc/architecture.md`

如果只是要开始使用，这份文档已经够了。
