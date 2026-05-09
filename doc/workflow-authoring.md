# FlowBraid Workflow 编写指南

本文说明 `workflow.yaml` / `workflow.yml` / `workflow.json` 的写法、字段含义、运行语义和推荐用法�?

目标读者：
- 需要自己编�?FlowBraid 工作流的�?
- 想理�?`workdir` / `contextDir` / `approval` / `agent_session` 语义的人
- 想参考推荐模式和避免常见坑的�?

本文描述的是当前仓库已经实现并校验支持的能力，不包含未来设计草案�?

## 1. 文件格式

FlowBraid 支持�?
- YAML：`.yaml` / `.yml`
- JSON：`.json`

建议优先使用 YAML，因为：
- 可读性更�?
- 多行 `prompt` / `command` 更容易写
- 更适合人工维护

## 2. 最小工作流

最小可运行示例�?

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

运行�?

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

字段说明�?
- `id`：必填，工作流唯一标识�?
- `start`：必填，起始节点 id�?
- `workdir`：可选，workflow 级默认业务目录�?
- `contextDir`：可选，workflow 级默认上下文目录�?
- `nodes`：必填，节点字典，key 就是节点 id�?

## 4. 节点通用字段

所有节点都支持以下通用字段�?
- `id`：可选，必须和节�?key 一致�?
- `type`：必填，当前支持 `shell`、`codex`、`agent_session`、`gate`、`approval`、`end`�?
- `title`：可选，描述字段，不参与调度�?
- `next`：可选，默认下一跳�?
- `transitions`：可选，支持 `success`、`failure`、`default`、`approve`、`reject`�?

推荐规则�?
- 只有一个正常后继时，用 `next`
- 有成�?失败分支时，�?`transitions.success` / `transitions.failure`
- `approval` 必须�?`transitions.approve` / `transitions.reject`

## 5. 目录模型

FlowBraid 里有三个容易混淆的目录概念：
- `run workspace`：保存状态、消息、日志和节点产物�?
- `contextDir`：节点终端默认打开的目录，放角色说明和局部约束�?
- `workdir`：节点真正修改和验证业务文件的目录�?

默认规则�?
- 节点 `workdir` 优先级最高：节点�?`workdir` > workflow �?`workdir` > CLI `--workdir` > workflow 文件所在目录�?
- 节点 `contextDir` 优先级最高：节点�?`contextDir` > workflow �?`contextDir` > 当前节点最终解析出来的 `workdir`�?

## 6. `shell` 节点

```yaml
prepare:
  type: shell
  workdir: ./demo-workdir
  contextDir: ./demo-workdir
  command: echo prepare
  next: develop
```

- `command` 必填，非空字符串�?
- `cwd` 可选，未写时默认使用该节点�?`contextDir`�?
- 命令退出码�?`0` 视为成功，非 `0` 视为失败�?
- 如果配置�?`transitions.failure`，会进入失败分支�?

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

- `prompt` 必填�?
- `outputFile` 默认�?`codex-last-message.md`�?
- `model` 可选，用于覆盖默认模型�?
- `reentry.mode` 可选，用于控制回流时如何恢复该节点历史会话�?
- 当前推荐�?`codex` 节点写成“任�?+ outcome 上报”模型，而不是依赖自然语言 `verdict` 解析�?

### 完成协议

当前推荐写法下，`codex` 节点应把以下内容写进 `prompt`�?
- 明确要求在任务完成后调用 `flowbraid node complete --outcome ...`
- 明确要求失败时调�?`flowbraid node fail`

推荐 outcome�?
- `success`：普通任务完成，通常流向 `transitions.success` �?`next`
- `approve`：验�?审核通过，通常也视为成功分�?
- `reject`：验�?审核打回，通常映射到失败分支或回流分支

调度器当前会优先读取�?
- `nodes/<node-id>/state/runtime-state.json`
- 当前 attempt 的最�?outcome 事件

因此推荐把“节点是否完成、走哪条分支”的真源建立�?runtime-state + outcome 上，而不是只靠子进程退出码或自然语言结果�?

### `mode` 兼容字段

`mode` 目前仍被实现层接受，但它已经不是推荐主路径：
- `mode: exec`：兼容旧的开�?生成语义
- `mode: review`：兼容旧�?review/verdict 语义

兼容说明�?
- �?workflow 仍可继续运行
- �?workflow 不建议再围绕 `mode: review + verdict: approve|reject` 设计主流�?
- 新示例应优先使用显式 outcome 协议

### `reentry`

`codex` 节点支持 `reentry` 配置，用于控制同一�?run 内再次进入该节点时如何打开终端�?

```yaml
develop:
  type: codex
  prompt: |
    Implement the task.
  reentry:
    mode: resume
```

支持取值：
- `resume`：默认值，优先恢复该节点上一�?`sessionId`�?
- `new_with_history`：新开会话，但带上最新验证和反馈上下文�?
- `new`：新开会话，只保留当前轮必要引导�?

补充说明�?
- `reentry` 当前只对 `codex` 节点生效�?
- `agent_session` 节点不使用这个字段�?
- native split 模式下，主进程会记录该节点自己的 `sessionId`�?

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

- `provider` 当前只支�?`codex`�?
- 这是长期交互节点，每次只做一�?turn�?
- `waiting_input` �?run 进入 `paused`，必须通过 `flowbraid send <run-dir> <message>` 继续�?
- `completed` 时继续下一跳�?
- `failed` 时按 `transitions.failure` 处理�?

## 9. `gate` 节点

```yaml
checkpoint:
  type: gate
  prompt: |
    Check the generated files, then continue.
  next: next-step
```

- 进入�?run 会暂停�?
- 通过 `flowbraid resume <run-dir>` 继续�?
- 适合人工确认、手动检查和外部条件等待�?

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

- 必须通过 `flowbraid resume <run-dir> --decision approve|reject` 继续�?
- `reject` 时当前实现要求带�?`--message`�?
- 人工反馈会写�?`messages/human-feedback.jsonl`�?

## 11. `end` 节点

```yaml
done:
  type: end
  message: workflow completed
```

- 到达后工作流结束�?

## 12. 分支规则

普通节点：
1. 命中 `transitions.success` / `transitions.failure` 时优先走对应分支�?
2. 否则如果存在 `transitions.default`，走 `default`�?
3. 否则如果存在 `next`，走 `next`�?
4. 否则结束当前链路；若节点是失败态，则整�?run 失败�?

`approval` 节点�?
1. `approve` �?`transitions.approve`
2. `reject` �?`transitions.reject`

�?`codex` 节点，推荐把分支理解为“最�?outcome 映射”：
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

这个模式体现的是�?
- `develop` 负责产出共享业务修改
- `verify` 负责真正执行验证并给出显�?outcome
- `approval` 负责最终人工确�?
- 回流依赖显式状态和结构化反馈，而不是隐式约�?

## 14. 常见错误

- `start` 指向不存在节点�?
- `approval` 缺少 `approve` �?`reject`�?
- `agent_session` 误用 `resume`�?
- `codex` 节点 prompt 没有明确要求上报 `flowbraid node complete --outcome ...`�?
- �� workflow �Կ���ʹ�� `mode: review` �� `verdict:`���� workflow ��Ӧ�����ǵ���Ψһ���Э�顣
- �?`contextDir` 当作真实业务目录�?
- 在单�?YAML 里硬塞复�?shell 命令�?
- 没有失败分支却期待自动回流�?

## 15. 推荐实践

- 每个节点只做一种职责�?
- 开发和验收用不�?`contextDir`�?
- 共享真实业务目录时统一放到 `workdir`�?
- `codex` 节点 prompt 里显式写�?complete、fail 两类终态命令触发条件�?
- 验证类节点把报告文件和最�?outcome 一起产出，避免只有自然语言结论�?
- `approval reject` �?prompt 要明确要求人工给出具体意见�?
- 中途对话任务用 `agent_session`�?
- 一次性准备脚本用 `shell`�?

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

常见输出�?

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

- `state/run.json`：run 总状态�?
- `state/timeline.json`：按 step / attempt 记录的时间线�?
- `nodes/<node-id>/status.json`：单节点状态�?
- `nodes/<node-id>/state/runtime-state.json`：节点运行态真源，包含 status、outcome、summary、attemptId 等�?
- `messages/events.jsonl`：全局事件流�?
- `messages/human-feedback.jsonl`：审批反馈�?
- `nodes/<node-id>/artifacts/`：节点输出产物�?
- `nodes/<node-id>/messages/inbox.jsonl`：会话型节点输入�?
- `nodes/<node-id>/messages/outbox.jsonl`：会话型节点输出�?
