# 本地多模型桥接（千问 + DeepSeek + Kimi + MiniMax + 智谱）

> 用 **Chrome DevTools Protocol** 驱动本机已登录的五个对话式 AI，
> 把网页/客户端变成可编程的本地服务。
> 不需要 API Key，不引入第三方依赖，调试端口只监听 `127.0.0.1`。

---

## 为什么做这个

想同时问五个模型、再对比它们的回答，最直接的办法是：开五个窗口、各粘贴一遍、
再人眼比对五份长文本。慢、容易漏看，也没法留档。

这些入口没有统一的 API：千问是本地客户端（Quark 定制的 Chromium），
DeepSeek / Kimi / MiniMax Code / 智谱清言是网页版。但它们都是 Chromium——
都有调试端口，都能用 CDP 接管。

于是这个项目做了三件事：

1. **只驱动已经登录的会话**：不碰账号密码，不读取、不外传 cookie；
2. **把站点差异收进一张表**：每个站点怎么找输入框、怎么发送、怎么读答案、怎么判断生成中，
   只写在 `bridge/lib/sites.mjs` 一处；
3. **并行提问 + 部分成功**：谁没答就跳过谁，答案原文留档，不因为一家限流就整轮失败。

---

## 五个模型

| 站点 | 入口 | 调试端口 | 默认等待 |
| --- | --- | --- | --- |
| 千问 | 本地客户端 `qianwen.exe` | 9223 | 180s |
| DeepSeek | `chat.deepseek.com` | 9222 | 180s |
| Kimi | `www.kimi.com` | 9222 | 420s |
| MiniMax Code | `agent.minimax.cn` | 9222 | 300s |
| 智谱清言 | `chatglm.cn` | 9222 | 180s |

**四个网页模型共用一个调试 Chrome（9222），千问客户端单独占 9223。**
端口和模型不是一一对应，别再按端口数模型。

> Kimi 的桌面客户端**接不了**：`Kimi.exe` 见到任何调试开关就 `exit 1`
> （`refusing to start with debug switch present`），拦截在 exe 本体里。
> 所以 Kimi 走网页版 `www.kimi.com`，同一个模型、同一个账号。

---

## 它是怎么工作的

```
                    cross-check.mjs
               并发 / 心跳 / 部分成功 / 留档
                           │
        ┌──────────┬───────┴───────┬──────────┐
        ▼          ▼               ▼          ▼
     ask.mjs    ask.mjs         ask.mjs    ask.mjs
   (qwen 9223) (deepseek)      (kimi)     (minimax)  (chatglm)
        │          └────────── 9222 ──────────┘
        ▼
   cdp.mjs  ──  WebSocket 说 CDP
        │
        ▼
   drive.mjs  ──  点击 / 输入 / 按键 / 可见性仿真
        │
        ├─ sites.mjs        每个站点的页面契约（唯一来源）
        ├─ answer.mjs       「哪一个块是答案」（跳过思考/工具块）
        └─ wait-policy.mjs  「算不算写完了」（纯函数，有单测）
```

**为什么是 CDP 而不是 API**：这些入口没有给个人用户开放 API。
CDP 驱动的是本机已登录的网页会话，等价于用户亲手打字。
代价是要伺候各家站点的 DOM——所以才需要 `sites.mjs` 和下面那些坑。

---

## 快速开始

### 环境要求

- Windows 10/11
- Node.js 18+（用到内置的全局 `WebSocket`）
- Chrome（桥接使用**独立 profile**，不碰日常那个）
- 千问客户端（可选；只用网页端也能跑）
- DeepSeek / Kimi / MiniMax / 智谱的账号（各自在调试浏览器里登录一次）

### 启动

```powershell
# 一键：缺哪个补哪个，约 6 秒
.\bridge\launch-bridge.bat

# 或分别启动
.\bridge\start-browser.ps1      # 调试 Chrome（9222，四个网页模型）
.\bridge\start-qwen-debug.ps1   # 千问客户端（9223）

# 查看状态
.\bridge\status.ps1
```

> 首次运行需要在弹出的浏览器/客户端里**登录一次**。
> 登录态保存在本地 profile 里，之后重启不用重新登录。

如果 PowerShell 拦未签名脚本，加 `-ExecutionPolicy Bypass`：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\bridge\status.ps1
```

### 交叉校对

```powershell
# 五路并行，原文留档
node bridge\lib\cross-check.mjs "你的问题" --out "cross-check\2026-10-28-主题.md"

# 只问其中几家
node bridge\lib\cross-check.mjs "你的问题" --sites deepseek,kimi

# 单侧提问
node bridge\lib\ask.mjs deepseek "你的问题" --new-chat
```

**等慢了不要重发。** 等待预算按站点自动分配；运行中每 15 秒有心跳。
真超时了先回读页面上的答案：

```powershell
node bridge\lib\read-last.mjs kimi
node bridge\lib\read-last.mjs kimi --wait 60
```

### 返回的 JSON 怎么读

| 字段 | 含义 |
| --- | --- |
| `ok` | **这一轮可用**（至少一家答了），决定退出码 |
| `allOk` | 是不是每一家都答了（一般 false，正常） |
| `answered[]` / `failed[]` | 谁答了 / 谁没答 + 原因 |
| `sides.<站点>.answer` | 该站原文，对比用 |
| `endReason` | `quiet` 正常收尾 / `stale` 标志卡死兜底 / `budget` 预算耗尽 |
| `truncated` / `staleCut` | 被预算或兜底截断，**不算完整答案** |
| `hint` | 失败或可疑时的下一步建议 |

---

## 设计上必须遵守的约束（都是踩出来的）

**这一节是这个项目最有价值的部分——每一条背后都是一次真实的失败。**

### 1. 任何等待都不能等「步骤脚本退出」

启动脚本会启动 Chrome，而 **Chrome 会继承其 stdout/stderr 句柄并一直持有到浏览器关闭**。
所以以下写法**全都会把调用方挂死**：

```powershell
Start-Process -Wait ...        # ❌ 挂死
& .\step.ps1 | ReadToEnd       # ❌ 挂死
```

**解法**：用 WMI 宿主（`Win32_Process.Create`）把步骤脚本**完全脱离本进程**启动，
并且**只以「端口是否监听」作为成功判据**，不等脚本退出。

### 2. 编码：.bat 与 .ps1 必须保持纯 ASCII

- `cmd` 用 **OEM 代码页**解析 `.bat` 字节 → 中文可能被搅乱成「找不到路径」
- Windows PowerShell 5.1 把**无 BOM 的 `.ps1`** 当 **ANSI** 读 → 中文乱码

**解法**：所有 `.bat` 与启动用 `.ps1` 保持**纯 ASCII**，中文提示统一放
`launcher-strings.json`，用**显式 UTF-8** 读取。
（`.mjs` 是 UTF-8，可以正常写中文注释。）

### 3. 未签名脚本会被执行策略拦

```powershell
.\script.ps1                                              # ❌ not digitally signed
powershell -ExecutionPolicy Bypass -File .\script.ps1     # ✅
```

### 4. 端口检查要有 TCP 兜底

`Get-NetTCPConnection` 在受限环境下会**静默返回空**，把健康的通道报成 DOWN
（启动器曾因此重启过没问题的千问）。`status.ps1` 和启动器都带 TCP 连接兜底，
**别改回单一检查**。

### 5. 不要因为慢就重发

重发不只是浪费——它会在用户的对话历史里留下两条一样的问题，让后面的对比变脏。
超时的那一刻，答案往往已经在页面上了。正确动作是 `read-last.mjs`，不是重问。

### 6. 站点选择器只写在 `sites.mjs`

以前这些选择器散落在 `ask.mjs`、`inspect-site.mjs`、`send-probe.mjs`、
`clear-composer.mjs` 四份拷贝里，加一个模型要改四处。现在加一个模型 =
在 `sites.mjs` 里加一个条目。每个选择器旁边的注释都写着它是**怎么试出来的**，
以及哪些看起来能用的写法实测失败——改之前请连注释一起读。

---

## 目录结构

```
bridge/
├── launch-bridge.bat        一键启动（纯 ASCII）
├── launch-bridge.ps1        启动编排（WMI 脱离宿主）
├── launcher-strings.json    启动器全部中文文案（唯一文案源）
├── start-browser.ps1        拉起调试 Chrome（9222）
├── start-qwen-debug.ps1     拉起千问客户端（9223）
├── open-web-tabs.ps1        缺哪个网页标签补哪个
├── status.ps1               端口 + 按模型检查标签
├── make-desktop-shortcut.ps1 重建桌面快捷方式
└── lib/
    ├── cdp.mjs              极简 CDP 客户端（零依赖）
    ├── drive.mjs            CDP 原语：点击 / 输入 / 按键 / 可见性
    ├── sites.mjs            站点契约（唯一来源）
    ├── ask.mjs              单侧提问全流程
    ├── cross-check.mjs      N 路并发 + 心跳 + 部分成功 + 留档
    ├── answer.mjs           「哪一个块是答案」
    ├── wait-policy.mjs      「算不算写完了」（纯函数）
    ├── wait-policy.test.mjs 8 个合成剧本（秒级，不碰浏览器）
    ├── read-last.mjs        只读回读最后答案
    ├── inspect-site.mjs     端口 / 标签 / 答案块 / 登录态
    └── probe-*.mjs          新站点侦察与选择器定位
```

`launcher-trace.log` 是运行时日志（含本机路径），已在 `.gitignore` 里挡住，不入库。

---

## 加第六个模型（约 20 分钟）

1. 在**调试 Chrome** 里打开并登录新站点（不是日常 Chrome）。
2. 侦察：`node bridge\lib\probe-new.mjs <url片段>` → 看输入框候选、按钮、容器。
3. 定位四样东西：输入框、发送键、答案容器、生成中标志
   （可用 `probe-type.mjs` / `probe-answer.mjs` / `probe-stream.mjs`）。
4. 写进 `sites.mjs`（照 kimi / minimax 的条目抄），填 `port`、`match`、`rank`、
   `timeoutSec`、`page{...}`。
5. 验证：`node bridge\lib\ask.mjs <新站点> "测试问题" --new-chat` 跑通，
   再跑一次多路交叉校对。

驱动层通常**一行都不用改**。2026-10-26 加 MiniMax 和智谱时，唯一的驱动改动是
补了一个 `pressEnter()`（智谱必须收完整 keyDown + char + keyUp）。

---

## 隐私与安全

- **这个仓库里没有密码、手机号、账号名或 API 密钥，也不需要填这些。**
  桥接只驱动浏览器里**已经登录**的会话；登录态在本地 profile
  （`%USERPROFILE%\.dsh-bridge\chrome-profile`、千问自己的 `User Data`），
  不会进 git。
- 代码里唯一需要按机器改的是**程序安装路径**。默认用 `%LOCALAPPDATA%\` 推断，
  装在别处时按脚本里的 `FILL IN` 注释改（Chrome / 千问各一处）。
- 提问会真实留在各站点的对话历史里；涉及隐私的问题请先用各站的临时会话/删除功能。
- 如果你 fork 这个项目：不要把本地路径、账号昵称、cookie、token 提交进仓库。
  `.gitignore` 已挡住 `.env`、`*.local.*`、日志与交叉校对留档。

### 需要按机器改的地方（脚本里都标了 `FILL IN`）

| 文件 | 这里填什么 |
| --- | --- |
| `bridge/start-browser.ps1` | Chrome 的安装路径（默认 `%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe`） |
| `bridge/make-desktop-shortcut.ps1` | 同上，只用于快捷方式图标 |
| `bridge/start-qwen-debug.ps1` | 千问客户端 `qianwen.exe` 的路径 |
| `bridge/qwen-debug-restart.ps1` | 千问 exe 与 `User Data` 目录 |
| `bridge/qwen-debug-force.ps1` | 同上 |

> `.ps1` 里的注释用英文 `FILL IN`，是因为这些脚本必须保持纯 ASCII
> （Windows PowerShell 5.1 会把无 BOM 的 `.ps1` 当 ANSI 读，中文会乱码）。
> 密码、手机号、账号、密钥**不需要填**，桥接只用浏览器里已登录的会话。

---

## 已知限制

- **仅 Windows**：路径、进程管理、编码处理都针对 Windows。
- **依赖已登录的本机会话**：不做自动登录，也不处理验证码。
- **站点选择器会失效**：站点改版后需要更新 `sites.mjs` 里的选择器。
- **Kimi 免费档会限流**：高峰排队/额度，不是桥接坏了；预算 420s 是刻意留的。
- **MiniMax 是 Agent**：会跑工具，回答里有「共执行 N 秒」；积分见底会发送失败。
- **不是官方 API**：这是对网页/客户端界面的自动化，受对方服务条款约束，请自行评估合规性。

---

## 验证

```powershell
node bridge\lib\wait-policy.test.mjs   # 8/8 通过，不碰浏览器
```

---

## 许可

个人项目，供学习参考。
