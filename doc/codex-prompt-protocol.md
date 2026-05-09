# codex 节点提示词协议

这份说明对应当前实现：`codex` 节点提示词以流程协议为主，不再由编排系统注入开发/验证角色身份。

## 编排系统提供什么

- 当前工作流和节点标识
- `contextDir`、`workdir`、`node.dir`、`artifacts.dir`
- 节点任务本体 `prompt`
- 结果上报命令：`complete`、`fail`
- 回流上下文：`from`、`reason`、`required action`

## 编排系统不提供什么

- 具体业务角色定义
- 节点应该修改哪些业务文件的硬性沙箱规则
- 仅靠提示词推断的身份语义

## 回流提示

回流时应优先说明：

1. 从哪里回流
2. 回流原因是什么
3. 这轮需要处理什么
4. 完成后应该执行什么流程命令

如果是 resume 场景，agent 已经带着会话历史，提示词不应再强调“重启任务”，而应聚焦这次回流要处理的关键意见。

## 流程命令触发

- `complete`：节点任务完成、结果明确时，必须执行
- `fail`：节点无法继续或已不可恢复失败时，必须执行

触发条件应写成强约束，不要只写成建议语气。

## ??????

- prompt ???????????? `flowbraid`
- ????? `node.exe + cli.js`?`tsx + cli.ts` ???????????
- ????????????`flowbraid` ??? PATH ????
- ????????????????????
  - `FLOWBRAID_PROMPT_USE_ENTRYPOINT=1`
  - ????? `FLOWBRAID_NODE_CLI_COMMAND`

## `outputFile`

`outputFile` 只表示 artifact 的默认文件名，不承担流程控制语义，也不定义节点身份。

## 关于 `artifact` CLI

`flowbraid node artifact` 底层能力仍然保留，用于需要时显式登记节点产物。

但当前推荐方案里：
- 不再默认把 `artifact` 命令注入到 `codex` 节点 prompt
- 是否上报中间产物，交给具体节点任务约定自行定义
