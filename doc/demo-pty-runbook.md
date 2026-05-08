# PTY 演示运行说明

## 目标

这个示例用于演示一条真实的 PTY 交互式工作流：

1. `develop` 首次提交一个功能正确但没有注释的 `calc.js`
2. `verify` 实际运行脚本，并因“缺少注释”给出 `outcome: reject`
3. `develop` 读取验收报告后补充注释并重新提交
4. `verify` 再次验收通过
5. 流程进入人工审批节点
6. 人工可以 `reject` 并填写意见，流程会打回 `develop`
7. 开发处理人工意见后重新验收
8. 人工 `approve` 后结束

## 运行命令

```bash
npm run demo:pty
```

Windows 下该命令会通过 [scripts/demo-pty.ps1](D:/Project/FlowBraid/scripts/demo-pty.ps1) 启动，并在入口处显式切到 UTF-8，正常场景下可以直接输入中文审批意见。

## 建议演示步骤

第一次进入人工审批时，输入：

```text
reject
请补充一条命令行使用说明，并确认注释足够清晰。
```

第二次进入人工审批时，输入：

```text
approve
```

## 预期现象

运行过程中应看到这些关键行为：

- 开发节点和验收节点都以 PTY 直出方式运行，不是 `[stdout]` 包装日志
- 验收节点会实际运行：
  - `node calc.js 1 2`
  - `node calc.js 10 -4`
  - `node calc.js 1.5 2.5`
- 首次验收出现 `outcome: reject`
- 失败原因明确指出“缺少注释”
- 第二次验收出现 `outcome: approve`
- 审批节点提示 `审批结果 [approve/reject]:`
- 最终出现 `run <id> => completed`

## 结果检查

演示结束后可检查这些文件：

- 工作流定义：[examples/codex-pty-demo.workflow.yaml](D:/Project/FlowBraid/examples/codex-pty-demo.workflow.yaml)
- 交付文件：[examples/demo-workdir/calc.js](D:/Project/FlowBraid/examples/demo-workdir/calc.js)
- 运行目录：`examples/.flowbraid-runs/<run-id>/`
- 人工反馈记录：`examples/.flowbraid-runs/<run-id>/messages/human-feedback.jsonl`
- 验收报告：`examples/.flowbraid-runs/<run-id>/nodes/verify/artifacts/verify-report.md`

## 说明

- 这是“真实 codex 行为”的演示，不是 fake runner。
- 因此节点耗时会明显高于测试桩，终端里会看到 codex 的真实执行过程。
