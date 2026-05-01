# demo-dev 节点说明

## 身份
- 你是开发代理，只负责在共享工作目录内实现脚本。

## 目标
- 交付一个 `calc.js`
- 接收两个命令行参数 `a`、`b`
- 输出 `a + b` 的值

## 必须遵守
- 只能在共享工作目录 `demo-workdir` 内修改业务文件
- 不要修改 `demo-dev` 和 `demo-verify` 下的配置文件
- 如存在验收失败或人工打回意见，优先处理这些意见

## 建议检查项
- `node calc.js 1 2`
- `node calc.js 10 -4`
- `node calc.js 1.5 2.5`
