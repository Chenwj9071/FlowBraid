# PTY 演示问题处理与经验

## 这次实际遇到的问题

### 1. 示例跑成了 stdout 包装日志，不是 PTY 接管模式

原因：

- 早期只有部分节点走了 PTY
- `review` 路径没有和 `exec` 路径统一

处理：

- 统一 `codex` 交互执行路径
- 保证开发节点和验收节点都直接透传 PTY 输出

经验：

- 只要用户要求“接管模式”，就不能只修开发节点，验收节点也必须走同一条 PTY 通道

### 2. Windows 下 PTY 子进程退出后残留资源，导致演示卡住

原因：

- `node-pty` 在 Windows ConPTY 下退出后可能残留 worker 或 socket

处理：

- 在 [src/executors/codex.ts](D:/Project/FlowBraid/src/executors/codex.ts) 里增加显式清理

经验：

- Windows PTY 问题不能只看主进程退出码，还要确认底层资源是否真正释放

### 3. workflow 中的 shell 命令写法触发 YAML 解析错误

原因：

- 复杂命令内联在一行，混入引号和冒号后容易破坏 YAML

处理：

- 改成块字符串写法

经验：

- 复杂 shell 命令不要硬塞单行标量，优先使用块字符串

### 4. 真实 codex 首轮会主动补全注释，破坏了“先打回再修复”的演示路径

原因：

- 只靠弱提示不足以约束真实 agent

处理：

- 在 workflow、开发角色约束和示例文档里同时强调：
  - 首轮没有验收报告时只交付最小正确实现
  - 首轮不要主动加注释
  - 首轮预期会因缺少注释被打回

经验：

- 真实 agent 演示如果依赖“先故意不满足某个标准”，必须把这件事写成硬约束，不能只靠暗示

### 5. Windows 中文审批意见会被写坏

原因：

- 交互链路跨越 PowerShell、Node readline 和终端编码
- 如果正式入口不统一到 UTF-8，中文意见会在某一层变成乱码

处理：

- `npm run demo:pty` 固定通过 [scripts/demo-pty.ps1](D:/Project/FlowBraid/scripts/demo-pty.ps1) 启动
- 在入口处显式设置 `InputEncoding`、`OutputEncoding` 和 `chcp 65001`
- 用正式入口链路补中文审批回归，而不是只验证 `tsx src/cli.ts`

经验：

- Windows 场景下，只要有自由文本输入，正式入口必须主动固定编码
- 不能把“用户自己换终端编码”当成可交付方案

### 6. 自动化驱动审批输入时序容易写错

原因：

- `reject` 后必须等待第二个提示再输入 comment
- 不能把 `reject` 和 comment 一次性盲打进 stdin

处理：

- 在 [test/cli-interactive-approval.test.ts](D:/Project/FlowBraid/test/cli-interactive-approval.test.ts) 里按提示分阶段驱动输入

经验：

- 交互式流程测试必须按提示分段输入，不能依赖一次性管道注入

## 这次形成的交付标准

以后类似 PTY 示例，至少满足：

1. 有专门的交互回归测试覆盖 `reject + comment`
2. 有 PTY 主流程测试覆盖回流
3. 有真实用户入口，不依赖 fake demo 作为最终入口
4. 运行说明写清推荐输入和预期现象
5. Windows 下涉及自由文本输入时，必须提前验证正式入口的编码行为

## 避免重复犯错

1. 不要混用“真实演示入口”和“测试桩入口”对外宣称同一个结论
2. 没有 fresh run 证据前，不要声称“可以直接演示”
3. 不要把“模型应该会这么做”当成稳定行为，关键分支必须靠硬约束
4. 不要用一次性管道输入替代交互式审批验证
5. 不要忽视 Windows 编码和 PTY 资源清理，这两类问题会直接破坏交付体验
