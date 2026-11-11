# Codex Web 本地原型

启动：Node.js 22+，本机已安装并登录 Codex Desktop（本次实际为 ChatGPT.app）。

```sh
npm start
```

打开 http://localhost:8787 。服务只监听 127.0.0.1；App 需要保持运行。可用 PORT 更改端口，CODEX_BIN 指定与桌面配套的 codex 可执行文件。没有 npm 依赖。

新建对话：列表顶部点「新建对话」，选择项目和可选模型。空白对话通过官方 thread/start 和 thread/name/set 持久化，释放后由桌面加载。网页把新建对话 ID 保存在 `.local/threads.json`，用于补充尚未发送首条消息的列表。桌面自动打开依赖本机深链接处理，未连接时需要在桌面手动打开一次。

布局采用项目/对话侧栏、居中消息区和底部输入框；手机单屏切换。主题默认跟随系统，可在顶部手动切换，选择保存在浏览器本地。输入框下方并排选择模型和思考强度（effort）；档位根据本机模型目录动态显示，读取当前会话设置，通过桌面 IPC 更新，从下一条消息生效。新建对话也支持 effort，未指定时沿用默认配置。额度文本和进度条均显示剩余百分比。

已实现：真实项目筛选、对话列表与搜索、历史纯文本与分页、向桌面拥有的对话发送纯文本、实时额度查询（每分钟刷新）。文本历史每 3 秒轮询；不显示工具调用、图片和思考内容。草稿仅保存在网页内存中，切换对话保留，刷新后丢失。

网页选择与桌面当前标签独立。「在桌面打开」使用 codex://threads/<id>。发送需桌面先加载该对话；未找到 owner 时不会启动第二个推理进程，不会直接修改数据库。不支持运行中消息排队、审批或其他桌面功能；遇到这些交互需回桌面处理。发送发生超时后结果可能未知，先核对历史再重试。

## 调研结论（2026-11-11）

本机版本 codex-cli 0.166.0-alpha.6，桌面 156.0.8078.79。

### 三条路径

1. 官方 app-server：提供 JSON-RPC 的项目、历史、额度、turn/start 等接口。但本机桌面使用私有 stdio 连接，没有公开的可附加 app-server Unix 控制 socket。`~/.codex/ipc/ipc.sock` 是 Electron IPC 路由器，不是 `codex app-server proxy` 的控制 socket。另起 app-server 后，已在桌面运行的对话会显示 notLoaded，因此不能据此判断它空闲，也不能直接通过它 resume/start 来实现同一桌面对话控制。
2. 桌面 IPC follower：当前 App 支持跨窗口 owner 发现、历史与 turn 转发。原型连接这个实际运行中的 IPC，让原窗口接收消息。它是未公开的内部协议，需要随 App 版本复核；不是官方稳定 API。
3. 桌面 UI 自动化：可以操作输入框，但依赖焦点、权限及界面布局，本次没有采用。

### 实现结构

浏览器 → localhost HTTP → 只读 app-server（project/list、thread/list、thread/items/list、account/rateLimits/read）；发送则走 DesktopIPC → 当前桌面会话 owner → 桌面已有 app-server。

读取 RPC 入口限制在只读方法；新建对话另有专用入口，调用 thread/start、thread/name/set、thread/unsubscribe，不发起推理。已有对话和模型设置通过桌面 IPC 操作。额度使用本机既有登录，不复制或向网页输出 auth.json。macOS 系统代理经 scutil 检测后传给读取进程；未更改系统或 Codex 配置。

旧对话的 projectId 可能为空；项目归属利用只读的 `.codex-global-state.json` 迁移映射补齐。此文件和 IPC 都属于内部实现。项目名、路径和文本是私有数据，网页按个人控制台使用。

### 实测结果

- 读取到 14 个真实项目、65 个未归档对话，并匹配当前 codexweb 项目。
- 当前对话纯文本历史分页读取成功。
- 当前会话 IPC owner 发现成功。已在新建测试会话完成真实消息往返，收到「连接成功」。桌面首次加载空白会话仍依赖其窗口加载完成；深链接自动打开存在限制。
- 额度接口真实返回：5 小时窗口已用 11%、每周窗口已用 4%（调研时快照，页面动态刷新）。最初请求失败，匹配系统代理后成功。
- Playwright 已在 390 × 844 手机视口验证页面打开、项目筛选、选择当前会话、显示文本与额度；发送投递已由本地 HTTP 接口验证。
- 三项边界测试通过：无 owner 时不会发送；只读入口拒绝 thread/resume、thread/start、turn/start；新建入口按项目目录持久化并释放对话。HTTP 写接口的无令牌及跨站请求均返回 403。

### 具体限制

不镜像桌面输入框里未发送的草稿，不自动同步桌面当前选中项目或标签，不支持普通 ChatGPT 云端聊天；本次处理的是这个 App 中的本地 Codex 工作对话。桌面发出的新文本会通过历史轮询出现，但不是逐 token 推送。

历史及列表均分页；「全部项目」包含没有项目的聊天。已归档聊天不显示。

### 来源

- 官方协议：https://learn.chatgpt.com/docs/app-server （initialize、线程分页、额度、传输）。
- 平台介绍：https://developers.openai.com/blog/codex-as-a-platform
- 本机 `codex app-server --help`、`proxy --help`，以及 `generate-ts` 生成的当前版本协议。
- 本机 App bundle 只读检查与 Unix socket 实测；没有修改 App bundle、桌面状态或数据库。
