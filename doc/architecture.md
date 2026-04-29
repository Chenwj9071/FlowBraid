# FlowBraid 架构说明

## 总体结构
FlowBraid 分成四层：
- 工作流定义层：负责读取、解析和校验 workflow 文件。
- 调度层：负责决定当前节点、处理门禁、resume 和跳转。
- 执行器层：负责真正跑 shell / 未来的 codex / claude 子进程。
- 运行时存储层：负责 run workspace、状态文件、日志和消息箱。

## 关键模块
### 1. Workflow Loader
- 读取 YAML/JSON。
- 规范化节点定义。
- 校验起点、节点引用和跳转关系。

### 2. Run Workspace
- 每次运行创建独立目录。
- 目录内保存 manifest、state、nodes、artifacts、messages 和 logs。
- 节点目录和工程目录严格分离。

### 3. Scheduler
- 按图结构驱动节点执行。
- 节点成功、失败、暂停都要写入状态文件。
- 遇到 gate 节点时暂停并等待 resume。

### 4. Executors
- 首版先实现 `shell` 执行器。
- `codex` 和 `claude` 作为后续执行器适配入口。
- 执行器统一处理：启动、标准输出、标准错误、退出码、资源关闭。

### 5. State and Messaging
- 状态文件用于恢复执行。
- messages 目录用于节点间通信和审计。
- artifacts 目录用于节点输出文件。

## 首版运行流程
1. 读取 workflow 文件。
2. 校验 workflow 图结构。
3. 以 workflow 文件所在目录作为默认工作目录，并在该目录下创建 run workspace。
4. 从 start 节点开始执行。
5. shell 节点运行完成后进入下一跳。
6. gate 节点暂停流程并落盘。
7. resume 后继续执行后续节点。
8. 遇到 end 节点后结束运行。
