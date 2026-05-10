# FlowBraid Workflow 编写指南

本文说明 `workflow.yaml` / `workflow.yml` / `workflow.json` 的写法、字段含义、运行语义和推荐用法。

可以先运行 `flowbraid workflow-help` 获取简化版的工作流编写说明；如需完整字段、语义和示例，再继续阅读本文。

目标读者：
- 需要自己编排 FlowBraid 工作流的人
- 想理解 `workdir` / `contextDir` / `approval` / `agent_session` 语义的人
- 想参考推荐模式并避免常见坑的人

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
```yaml
id: your-workflow-id
start: first-node-id
workdir: ./shared-workdir
contextDir: ./default-context
nodes:
  ...
```

字段说明：
- `id`：必填，工作流唯一标识。
- `start`：必填，起始节点 id。
- `workdir`：可选，workflow 级默认业务目录。
- `contextDir`：可选，workflow 级默认上下文目录。
- `nodes`：必填，节点字典，key 就是节点 id。

## 4. 节点通用字段
所有节点都支持以下通用字段：
- `id`：可选，但必须与节点 key 一致。
- `type`：必填，当前支持 `shell`、`codex`、`agent_session`、`gate`、`approval`、`end`。
- `title`：可选，仅作描述，不参与调度。
- `next`：可选，默认下一跳。
- `transitions`：可选，支持 `success`、`failure`、`default`、`approve`、`reject`。

推荐规则：
- 只有一个正常后续时，用 `next`
- 有成功 / 失败分支时，用 `transitions.success` / `transitions.failure`
- `approval` 节点必须声明 `transitions.approve` / `transitions.reject`

## 5. 目录模型
FlowBraid 里有三个容易混淆的目录概念：
- `run workspace`：保存状态、消息、日志和节点产物
- `contextDir`：节点终端默认打开的目录，放角色说明和局部约束
- `workdir`：节点真实修改和验证业务文件的目录

默认规则：
- 节点 `workdir` 优先级最高：节点级 `workdir` > workflow 级 `workdir` > CLI `--workdir` > workflow 文件所在目录
- 节点 `contextDir` 优先级最高：节点级 `contextDir` > workflow 级 `contextDir` > 当前节点最终解析出的 `workdir`

推荐理解：
- `contextDir` 负责“身份和约束”
- `workdir` 负责“真实业务修改”

## 6. `shell` 节点
```yaml
prepare:
  type: shell
  workdir: ./demo-workdir
  contextDir: ./demo-workdir
  command: echo prepare
  next: develop
```

说明：
- `command` 必填，非空字符串。
- `cwd` 可选，未写时默认使用该节点的 `contextDir`。
- 命令退出码为 `0` 视为成功，非 `0` 视为失败。
- 如果配置了 `transitions.failure`，会进入失败分支。

## 7. `codex` 节点
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
- `prompt` 必填。
- `outputFile` 默认是 `codex-last-message.md`。
- `model` 可选，用于覆盖默认模型。
- `reentry.mode` 可选，用于控制回流时如何恢复该节点历史会话。
- 当前推荐把 `codex` 节点写成“任务 + outcome 上报”模型，而不是依赖自然语言 `verdict` 解析。

### 完成协议
当前推荐写法下，`codex` 节点应在 prompt 中明确要求：
- 任务完成后执行 `flowbraid node complete --outcome ...`
- 任务失败或无法继续时执行 `flowbraid node fail`

推荐 outcome：
- `success`：普通任务完成
- `approve`：验收 / 审核通过
- `reject`：验收 / 审核打回

调度器当前优先读取：
- `nodes/<node-id>/state/runtime-state.json`
- 当前 attempt 的最新 outcome 事件

因此推荐把“节点是否完成、走哪条分支”的真源建立在 `runtime-state + outcome` 上，而不是只靠退出码或自然语言结论。

### `mode` 历史兼容
`mode` 当前仍被实现层接受，但已经不是推荐主路径：
- `mode: exec`：历史 workflow 的旧生成语义
- `mode: review`：历史 workflow 的 review/verdict 语义

兼容说明：
- 历史 workflow 仍可继续运行
- 新 workflow 不应围绕 `mode: review + verdict` 设计主流转

### `reentry`
`codex` 节点支持：
```yaml
develop:
  type: codex
  prompt: |
    Implement the task.
  reentry:
    mode: resume
```

支持值：
- `resume`：默认值，优先恢复该节点上一轮 `sessionId`
- `new_with_history`：新开会话，但带上最新回流上下文
- `new`：新开会话，只保留当前轮必要引导

补充说明：
- `reentry` 当前只对 `codex` 节点生效
- `agent_session` 不使用这个字段
- native split 模式下，主进程会记录该节点自己的 `sessionId`

## 8. `agent_session` 节点
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
- `provider` 当前只支持 `codex`
- 这是长期交互节点，每次只做一轮 `turn`
- `waiting_input` 时 run 进入 `paused`，必须通过 `flowbraid send <run-dir> <message>` 继续
- `completed` 时继续下一跳
- `failed` 时按 `transitions.failure` 处理

## 9. `gate` 节点
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
- 适合人工确认、手动检查和外部条件等待

## 10. `approval` 节点
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

## 11. `end` 节点
```yaml
done:
  type: end
  message: workflow completed
```

说明：
- 到达后工作流结束

## 12. 分支规则
普通节点：
1. 命中 `transitions.success` / `transitions.failure` 时优先走对应分支
2. 否则如存在 `transitions.default`，走 `default`
3. 否则如存在 `next`，走 `next`
4. 否则结束当前链路；若节点是失败态，则整个 run 失败

`approval` 节点：
1. `approve` 走 `transitions.approve`
2. `reject` 走 `transitions.reject`

对 `codex` 节点，推荐把分支理解为“最终 outcome 映射”：
- `success` / `approve` 通常进入成功分支
- `reject` / `failure` 通常进入失败分支
- 如果节点只是暂停或等待人工动作，不应提前上报完成 outcome

## 13. 推荐编排模式
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
      If verification fails, report reject.
      If verification passes, report approve.
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

这个模式体现的是：
- `develop` 负责产出共享业务修改
- `verify` 负责真正执行验证并给出显式 outcome
- `approval` 负责最终人工确认
- 回流依赖显式状态和结构化反馈，而不是隐式约定

## 14. 常见错误
- `start` 指向不存在节点
- `approval` 缺少 `approve` 或 `reject`
- `agent_session` 误用 `resume`
- `codex` 节点 prompt 没有明确要求上报 `flowbraid node complete --outcome ...`
- 历史 workflow 仍可能使用 `mode: review` 和 `verdict:`；新 workflow 不应把它们当作主协议
- 把 `contextDir` 当作真实业务目录
- 在单行 YAML 里硬塞复杂 shell 命令
- 没有失败分支却期待自动回流

## 15. 推荐实践
- 每个节点只做一种职责
- 开发和验收使用不同 `contextDir`
- 共享真实业务目录统一放到 `workdir`
- `codex` 节点 prompt 里显式写清 `complete` / `fail` 两类终态命令触发条件
- 验证类节点把报告文件和最终 outcome 一起产出，避免只给自然语言结论
- `approval reject` 的 prompt 要明确要求人工给出具体意见
- 中途对话任务用 `agent_session`
- 一次性准备脚本用 `shell`

## 16. 运行入口
```bash
flowbraid validate path/to/workflow.yaml
flowbraid run path/to/workflow.yaml
flowbraid run path/to/workflow.yaml --interactive
flowbraid run path/to/workflow.yaml --no-interactive
flowbraid resume <run-dir>
flowbraid resume <run-dir> --decision approve
flowbraid resume <run-dir> --decision reject --message "补充说明"
flowbraid send <run-dir> "继续执行"
```

## 17. 运行输出
常见输出：
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

## 18. 运行产物
- `state/run.json`：run 总状态
- `state/timeline.json`：按 step / attempt 记录的时间线
- `nodes/<node-id>/status.json`：单节点状态
- `nodes/<node-id>/state/runtime-state.json`：节点运行态真源，包含 `status`、`outcome`、`summary`、`attemptId` 等
- `messages/events.jsonl`：全局事件流
- `messages/human-feedback.jsonl`：审批反馈
- `nodes/<node-id>/artifacts/`：节点输出产物
- `nodes/<node-id>/messages/inbox.jsonl`：会话型节点输入
- `nodes/<node-id>/messages/outbox.jsonl`：会话型节点输出
