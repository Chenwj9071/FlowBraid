# FlowBraid Workflow 编写指南

本文说明 `workflow.yaml` / `workflow.yml` / `workflow.json` 的写法、字段含义、运行语义和推荐用法。

目标读者：

- 需要自己编排 FlowBraid 工作流的人
- 想理解 `workdir` / `contextDir` / `approval` / `agent_session` 语义的人
- 想参考推荐模式和避免常见坑的人

本文描述的是当前仓库已经实现并校验支持的能力，不包含未来设计草案。

## 1. 文件格式

FlowBraid 支持：

- YAML：`.yaml` / `.yml`
- JSON：`.json`

建议优先使用 YAML，因为：

- 可读性更高
- 多行 `prompt` / `command` 更容易写
- 更适合人工维护

## 2. 最小工作流

最小可运行示例：

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

运行：

```bash
flowbraid run path/to/workflow.yaml
```

## 3. 顶层字段

顶层结构：

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
  - 必须是非空字符串

- `start`
  - 必填
  - 起始节点 id
  - 必须引用 `nodes` 中已存在的节点

- `workdir`
  - 可选
  - workflow 级默认业务目录
  - 供 `shell`、`codex`、`agent_session` 节点继承
  - 为空字符串会校验失败

- `contextDir`
  - 可选
  - workflow 级默认上下文目录
  - 供 `shell`、`codex`、`agent_session` 节点继承
  - 为空字符串会校验失败

- `nodes`
  - 必填
  - 节点字典，key 就是节点 id
  - 不能为空

## 4. 节点通用字段

所有节点都支持以下通用字段：

- `id`
  - 可选
  - 如果写了，必须和节点 key 完全一致
  - 一般不推荐写，直接使用节点 key 即可

- `type`
  - 必填
  - 当前支持：
    - `shell`
    - `codex`
    - `agent_session`
    - `gate`
    - `approval`
    - `end`

- `title`
  - 可选
  - 当前主要作为描述字段，不参与调度

- `next`
  - 可选
  - 默认下一跳
  - 常用于单一成功路径

- `transitions`
  - 可选
  - 显式声明分支跳转
  - 支持的 key：
    - `success`
    - `failure`
    - `default`
    - `approve`
    - `reject`

推荐规则：

- 只有一个正常后继时，用 `next`
- 有成功/失败分支时，用 `transitions.success` / `transitions.failure`
- `approval` 必须用 `transitions.approve` / `transitions.reject`

## 5. 目录模型

FlowBraid 里有三个容易混淆的目录概念：

- `run workspace`
  - FlowBraid 运行时目录
  - 用于保存状态、消息、日志和节点产物
  - 默认落在 workflow 文件所在目录下的 `.flowbraid-runs/`

- `contextDir`
  - 节点终端默认打开的目录
  - 用于放 `AGENTS.md`、角色说明、局部约束
  - 更像“身份目录”或“角色目录”

- `workdir`
  - 节点真实修改和验证业务文件的目录
  - 多个节点可以共享同一个 `workdir`
  - 更像“真实业务工作区”

当前实现中的默认规则：

- 节点 `workdir` 优先级：
  - 节点级 `workdir`
  - workflow 级 `workdir`
  - CLI `--workdir`
  - workflow 文件所在目录

- 节点 `contextDir` 优先级：
  - 节点级 `contextDir`
  - workflow 级 `contextDir`
  - 当前节点最终解析出来的 `workdir`

推荐用法：

- 开发/验收节点共享同一个 `workdir`
- 开发节点使用自己的 `contextDir`
- 验收节点使用自己的 `contextDir`
- 不要把角色说明和真实业务文件混在一起

## 6. `shell` 节点

示例：

```yaml
prepare:
  type: shell
  workdir: ./demo-workdir
  contextDir: ./demo-workdir
  command: echo prepare
  next: develop
```

字段：

- `type: shell`
- `command`
  - 必填
  - 非空字符串
- `cwd`
  - 可选
  - 用于覆盖 shell 进程当前目录
  - 如果未写，默认使用该节点的 `contextDir`
- `workdir`
  - 可选
- `contextDir`
  - 可选

运行语义：

- 命令退出码为 `0` 时视为成功
- 非 `0` 时视为失败
- 如果配置了 `transitions.failure`，会进入失败分支
- 否则整个 run 失败

推荐用法：

- 用于准备环境、清理目录、执行一次性脚本
- 多行命令优先用 YAML 块字符串

示例：

```yaml
command: |
  node -e "
  console.log('prepare')
  "
```

## 7. `codex` 节点

示例：

```yaml
develop:
  type: codex
  mode: exec
  contextDir: ./demo-dev
  workdir: ./demo-workdir
  prompt: |
    Read AGENTS.md first, then implement the task.
  outputFile: develop-last-message.md
  transitions:
    success: verify
    failure: verify
```

字段：

- `type: codex`
- `mode`
  - 必填
  - 只能是：
    - `exec`
    - `review`
- `prompt`
  - 必填
  - 非空字符串
- `cwd`
  - 可选
  - 默认使用该节点的 `contextDir`
- `workdir`
  - 可选
- `contextDir`
  - 可选
- `model`
  - 可选
  - 传给 `codex` CLI
- `outputFile`
  - 可选
  - 节点产物文件名
  - 默认是 `codex-last-message.md`

运行语义：

- `mode: exec`
  - 用于开发、修改、生成、执行一次性任务
- `mode: review`
  - 用于验收和审查
  - 结果不仅依赖 CLI 是否成功退出，还依赖输出中是否包含：
    - `verdict: approve`
    - `verdict: reject`

当前推荐规则：

- 开发节点用 `mode: exec`
- 验收节点用 `mode: review`
- `review` 节点的 `prompt` 里明确要求输出 `verdict: approve|reject`
- `review reject` 时配 `transitions.failure` 回流到开发节点

重要说明：

- 当前实现里，`codex` 标准模式、split-terminal 模式、native-split 模式都遵循同一套 success/failure 跳转语义
- `codex` 节点失败时，如果声明了 `transitions.failure`，会继续走失败分支

## 8. `agent_session` 节点

示例：

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

字段：

- `type: agent_session`
- `provider`
  - 必填
  - 当前只支持 `codex`
- `prompt`
  - 必填
  - 非空字符串
- `cwd`
  - 可选
- `workdir`
  - 可选
- `contextDir`
  - 可选
- `model`
  - 可选
- `outputFile`
  - 可选

运行语义：

- 这是长期交互节点，不是一次性执行节点
- provider 每次只做一轮 turn
- provider 返回三种结构化状态之一：
  - `waiting_input`
  - `completed`
  - `failed`

对应行为：

- `waiting_input`
  - 当前 run 进入 `paused`
  - 必须通过 `flowbraid send <run-dir> <message>` 继续
  - 不使用 `resume`

- `completed`
  - 节点成功，继续下一跳

- `failed`
  - 节点失败
  - 如果配置了 `transitions.failure`，进入失败分支

推荐用法：

- 用于需求澄清、长期会话、逐轮交互任务
- 不要把一次性开发任务强行写成 `agent_session`

## 9. `gate` 节点

示例：

```yaml
checkpoint:
  type: gate
  prompt: |
    Check the generated files, then continue.
  next: next-step
```

字段：

- `type: gate`
- `prompt`
  - 可选

运行语义：

- 进入该节点后，run 会暂停
- 通过 `flowbraid resume <run-dir>` 继续
- 继续后流向：
  - `transitions.default`
  - 否则 `next`

适合场景：

- 人工确认
- 手动检查
- 外部条件等待

## 10. `approval` 节点

示例：

```yaml
approve:
  type: approval
  prompt: |
    Human confirmation is required.
  transitions:
    approve: done
    reject: develop
```

字段：

- `type: approval`
- `prompt`
  - 可选
- `transitions.approve`
  - 必填
- `transitions.reject`
  - 必填

运行语义：

- 进入该节点后，run 会暂停
- 必须通过 `flowbraid resume <run-dir> --decision approve|reject` 继续
- 如果 `reject`，当前实现要求提供 comment
- 人工反馈会被记录到 `messages/human-feedback.jsonl`

推荐用法：

- 用于真正的人工审批
- 如果只是“按回车继续”，请用 `gate`

## 11. `end` 节点

示例：

```yaml
done:
  type: end
  message: workflow completed
```

字段：

- `type: end`
- `message`
  - 可选

运行语义：

- 到达后工作流结束

## 12. 分支规则

当前跳转优先级：

普通节点：

1. 如果根据结果命中了 `transitions.success` 或 `transitions.failure`，优先走对应分支
2. 否则如果存在 `transitions.default`，走 `default`
3. 否则如果存在 `next`，走 `next`
4. 否则结束当前链路；若节点是失败态，则整个 run 失败

`approval` 节点：

1. `approve` 走 `transitions.approve`
2. `reject` 走 `transitions.reject`

## 13. 推荐编排模式

### 模式 A：准备 -> 开发 -> 验收 -> 人工审批 -> 结束

这是最推荐的标准闭环：

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
    mode: exec
    contextDir: ./demo-dev
    workdir: ./demo-workdir
    prompt: |
      Implement the task.
    next: verify

  verify:
    type: codex
    mode: review
    contextDir: ./demo-verify
    workdir: ./demo-workdir
    prompt: |
      Verify the task.
      Output verdict: approve or verdict: reject.
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

### 模式 B：长期会话 -> 结束

```yaml
id: session-demo
start: discuss
nodes:
  discuss:
    type: agent_session
    provider: codex
    prompt: |
      Ask clarifying questions first.
    next: done

  done:
    type: end
```

## 14. 常见错误

### 1. `start` 指向不存在节点

会直接校验失败。

### 2. `approval` 缺少 `approve` 或 `reject`

会直接校验失败。

### 3. `agent_session` 用 `resume`

这是错误用法。`agent_session` 应该用 `send`，不是 `resume`。

### 4. `review` 节点不输出 `verdict:`

当前实现会把它视为失败，不会当作成功通过。

### 5. 把 `contextDir` 当作真实业务目录

推荐只把它当角色目录。真实代码修改应该落在 `workdir`。

### 6. 在单行 YAML 里硬塞复杂 shell 命令

复杂命令推荐使用块字符串。

### 7. 没有失败分支却期望自动回流

当前只有显式配置了 `transitions.failure`，失败时才会继续分支流转。

## 15. 推荐实践

- 每个节点只做一种职责
- 开发和验收用不同 `contextDir`
- 共享真实业务目录时统一放到 `workdir`
- `review` 节点明确要求输出 `verdict:`
- `approval reject` 的 prompt 明确要求人工给出具体意见
- 对需要中途对话的节点使用 `agent_session`
- 对一次性准备脚本使用 `shell`

## 16. 参考文件

推荐从以下文件继续看：

- 标准原生分离终端示例：[codex-native-split-demo.workflow.yaml](D:/Code/FlowBraid/examples/codex-native-split-demo.workflow.yaml:1)
- PTY 交互示例：[codex-pty-demo.workflow.yaml](D:/Code/FlowBraid/examples/codex-pty-demo.workflow.yaml:1)
- 长期会话示例：[agent-session-demo.workflow.yaml](D:/Code/FlowBraid/examples/agent-session-demo.workflow.yaml:1)
- 需求与状态模型：[requirements.md](D:/Code/FlowBraid/doc/requirements.md:18)
- 架构与运行流程：[architecture.md](D:/Code/FlowBraid/doc/architecture.md:31)

## 17. 如何启动和运行工作流

### 17.1 校验 workflow 文件

在正式运行前，建议先校验：

```bash
flowbraid validate path/to/workflow.yaml
```

校验通过时会输出：

```text
workflow 校验通过
```

适合用来提前发现：

- `start` 指向不存在节点
- 节点 `type` 非法
- `approval` 缺少 `approve` / `reject`
- 跳转目标不存在

### 17.2 启动工作流

基础命令：

```bash
flowbraid run path/to/workflow.yaml
```

常见参数：

```bash
flowbraid run path/to/workflow.yaml --workspace <runs-dir> --workdir <dir> --codex-command <cmd>
```

字段说明：

- `--workspace <dir>`
  - 指定 run workspace 的根目录
  - 默认是 workflow 文件所在目录下的 `.flowbraid-runs/`

- `--workdir <dir>`
  - 覆盖 workflow 默认 `workdir`
  - 适合同一份 workflow 在不同业务目录中复用

- `--codex-command <cmd>`
  - 指定 `codex` 命令入口
  - 例如本地包装脚本、测试桩或自定义启动命令

### 17.3 交互模式与分离终端模式

如果当前终端是 TTY，`run` 默认会进入交互式运行。

常见模式：

```bash
flowbraid run path/to/workflow.yaml --interactive
flowbraid run path/to/workflow.yaml --interactive
```

说明：

- `--interactive`
  - 允许在当前终端中处理审批、门禁和会话继续输入

  - `codex` 节点使用旧的 helper 包裹型分离终端模式

- ???????????????native split?
  - `codex` 节点使用原生 `codex` 分离终端模式
  - 主进程继续留在当前终端输出流程日志
  - 每个 `codex` 节点在独立窗口中运行

### 17.4 非交互模式

如果你在脚本或 CI 中运行，或者明确不想进入交互模式，可以关闭：

```bash
flowbraid run path/to/workflow.yaml --no-interactive
```

此时如果流程停在：

- `gate`
- `approval`
- `agent_session` 的 `waiting_input`

就需要后续通过 `resume` 或 `send` 手动继续。

## 18. 如何继续、控制和恢复工作流

### 18.1 `resume`

用于继续：

- `gate`
- `approval`

命令：

```bash
flowbraid resume <run-dir>
flowbraid resume <run-dir> --decision approve
flowbraid resume <run-dir> --decision reject --message "具体打回意见"
```

说明：

- `gate` 节点只需要 `resume`
- `approval` 节点必须给出 `approve` 或 `reject`
- `reject` 时必须带 `--message`

### 18.2 `send`

用于继续：

- `agent_session`

命令：

```bash
flowbraid send <run-dir> "继续消息"
```

说明：

- `agent_session` 不使用 `resume`
- `send` 会把消息写入当前会话节点的 `inbox.jsonl`
- provider 会基于完整会话历史继续下一轮 turn

### 18.3 中断运行

运行中按 `Ctrl+C`：

- 第一次：请求主进程终止当前运行，并尽量把失败状态落盘
- 连续再次按：直接强制退出当前 CLI 进程

建议：

- 如果已经拿到 `run-dir`，优先查看状态文件确认中断点
- 不要假设所有外部子进程都会瞬时退出

## 19. 常用命令速查

```bash
flowbraid validate path/to/workflow.yaml
flowbraid run path/to/workflow.yaml
flowbraid run path/to/workflow.yaml --interactive
flowbraid run path/to/workflow.yaml --interactive
flowbraid resume <run-dir>
flowbraid resume <run-dir> --decision approve
flowbraid resume <run-dir> --decision reject --message "请补充错误处理"
flowbraid send <run-dir> "请继续实现导出功能"
```

## 20. 如何理解运行输出

主进程常见输出示例：

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

常见前缀含义：

- `[run]`
  - 调度器级别日志
  - 表示 run 状态变化、节点进入、节点流转

- `[<node-id>]`
  - 来自具体节点执行过程的日志
  - 例如 `shell` 输出、`codex` 输出、provider 输出

- `[native]`
  - 原生分离终端模式下的节点窗口启动、会话恢复、终端关闭等日志

常见状态解释：

- `started`
  - run 已创建并开始执行

- `workspace <dir>`
  - 本次 run 的运行目录
  - 后续 `resume` / `send` 都基于这个目录

- `step N: enter node ...`
  - 调度器进入第 N 步

- `node ... succeeded`
  - 节点成功结束

- `node ... failed`
  - 节点失败
  - 如果日志里还有 `route to ...`，说明失败后进入了 `transitions.failure`

- `paused at ...`
  - 流程暂停
  - 需要你手动继续

- `run ... => completed`
  - 整个工作流完成

- `run ... => failed`
  - 整个工作流失败

## 21. 如何查看运行产物和状态

每次运行都会创建独立 run 目录。

关键文件：

- `state/run.json`
  - run 总状态

- `nodes/<node-id>/status.json`
  - 单节点状态

- `messages/events.jsonl`
  - 全局事件流

- `messages/human-feedback.jsonl`
  - 审批 reject / approve 反馈

- `nodes/<node-id>/artifacts/`
  - 节点输出产物

- `nodes/<node-id>/messages/inbox.jsonl`
  - 会话型节点输入

- `nodes/<node-id>/messages/outbox.jsonl`
  - 会话型节点输出

定位思路：

- 想知道 run 停在哪：看 `state/run.json`
- 想知道某节点为什么失败：看 `nodes/<node-id>/status.json`
- 想知道审批给了什么意见：看 `messages/human-feedback.jsonl`
- 想知道 review 为什么 reject：看对应 `artifacts/*.md`
