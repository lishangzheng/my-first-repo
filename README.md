# 本地双模型桥接（千问 + DeepSeek）

> 通过 **Chrome DevTools Protocol** 驱动本机已登录的千问客户端与 DeepSeek 网页版，
> 把两个对话式 AI 变成**可编程的本地服务**。

---

## 为什么做这个

想同时问两个模型、再对比它们的回答，最直接的办法是：开两个窗口、各粘贴一遍、再人眼比对两份长文本。**这个过程既慢又容易漏看差异。**

市面上没有现成工具能做到——因为两个入口一个是**本地客户端**（Quark 定制的 Chromium），一个是**网页版**，都没有开放 API。

于是换了个思路：**它们都是 Chromium，就有调试端口；有调试端口，就能用 CDP 接管。**

---

## 它是怎么工作的

```
┌──────────────────────────────────────────────────────────┐
│  Node.js 侧（bridge/lib/*.mjs，零第三方依赖）             │
│                                                           │
│   cdp.mjs          极简 CDP 客户端（Node 内置 WebSocket） │
│   sites.mjs        站点适配：选择器、输入框、发送按钮     │
│   ask.mjs          提问编排：写入 → 发送 → 等待 → 取回答  │
│   cross-check.mjs  交叉校对：并行问两边，取回两份原文     │
│   answer-diff.mjs  两份回答的差异对比                     │
└───────────────┬──────────────────────┬───────────────────┘
                │ CDP over WebSocket   │
        ┌───────▼────────┐     ┌───────▼────────┐
        │ 127.0.0.1:9222 │     │ 127.0.0.1:9223 │
        │ DeepSeek 调试   │     │ 千问客户端      │
        │ 浏览器          │     │（自带 Chromium）│
        └────────────────┘     └────────────────┘
```

**两个端口都只监听 `127.0.0.1`，不对外网开放。**

---

## 快速开始

### 环境要求

- Windows
- Node.js 18+（用到内置的全局 `WebSocket`）
- Chrome（桥接使用**独立 profile**，不碰日常那个）
- 千问客户端（可选，只用 DeepSeek 侧也能跑）

### 启动

```powershell
# 一键：缺哪个补哪个，约 6 秒
.\bridge\launch-bridge.bat

# 或分别启动
.\bridge\start-browser.ps1      # DeepSeek 调试浏览器 → 9222
.\bridge\start-qwen-debug.ps1   # 千问客户端 → 9223

# 查看状态
.\bridge\status.ps1
```

> 首次运行需要在弹出的浏览器/客户端里**登录一次**。登录态保存在独立 profile 里，之后重启不用重新登录。

### 用法

```powershell
# 看代理能看到什么
node bridge\lib\cdp-cli.mjs targets

# 在指定页面上求值
node bridge\lib\cdp-cli.mjs eval "document.title"

# 交叉校对：同一个问题问两边
node bridge\lib\cross-check.mjs "你的问题"
```

---

## 设计上必须遵守的约束（都是踩出来的）

**这一节是这个项目最有价值的部分——每一条背后都是一次真实的失败。**

### 1. 任何等待都不能等「步骤脚本退出」

启动脚本会启动 Chrome，而 **Chrome 会继承其 stdout/stderr 句柄并一直持有到浏览器关闭**。所以以下写法**全都会把调用方挂死**：

```powershell
Start-Process -Wait ...        # ❌ 挂死
& .\step.ps1 | ReadToEnd       # ❌ 挂死
```

**解法**：用 WMI 宿主（`Win32_Process.Create`）把步骤脚本**完全脱离本进程**启动，并且**只以「端口是否监听」作为成功判据**，不等脚本退出。

### 2. 编码：.bat 与 .ps1 必须保持纯 ASCII

- `cmd` 用 **OEM 代码页**解析 `.bat` 字节 → 中文可能被搅乱成「找不到路径」
- Windows PowerShell 5.1 把**无 BOM 的 `.ps1`** 当 **ANSI** 读 → 中文乱码

**解法**：所有 `.bat` 与启动用 `.ps1` 保持**纯 ASCII**，中文提示统一放 `launcher-strings.json`，用**显式 UTF-8** 读取。

### 3. 未签名脚本会被执行策略拦

```powershell
.\script.ps1                                              # ❌ not digitally signed
powershell -ExecutionPolicy Bypass -File .\script.ps1     # ✅
```

### 4. 只以端口作为成功判据

不要靠「脚本有没有输出成功字样」判断，**直接探端口**：

```powershell
Invoke-WebRequest 'http://127.0.0.1:9222/json/version' -UseBasicParsing
```

---

## 目录结构

```
bridge/
├── launch-bridge.bat        一键启动（纯 ASCII）
├── launch-bridge.ps1        启动编排（WMI 脱离宿主）
├── start-browser.ps1        拉起 DeepSeek 调试浏览器
├── start-qwen-debug.ps1     拉起千问客户端（带调试参数）
├── status.ps1               状态检查
├── launcher-strings.json    中文提示（显式 UTF-8）
└── lib/
    ├── cdp.mjs              极简 CDP 客户端
    ├── cdp-cli.mjs          命令行入口（可手工复现每一步）
    ├── sites.mjs            站点适配层
    ├── ask.mjs              提问编排
    ├── cross-check.mjs      交叉校对
    └── answer-diff.mjs      回答差异对比
```

---

## 设计取舍

**为什么用 CDP 而不是模拟点击（UI Automation / pyautogui）？**

| | CDP | 模拟点击 |
|---|---|---|
| 稳定性 | 高（直接读 DOM 与网络） | 低（受窗口位置、缩放、焦点影响） |
| 可观测 | 能拿到页面真实状态 | 只能靠截图猜 |
| 打扰用户 | 不抢焦点 | 会抢鼠标键盘 |

**为什么零第三方依赖？**

Node 18+ 内置全局 `WebSocket`，CDP 协议本身只是 JSON 帧。不引入 puppeteer 这类重型依赖，是为了**让每一步都能手工复现、可调试**。

---

## 已知限制

- **仅 Windows**：路径、进程管理、编码处理都针对 Windows
- **依赖已登录的本机会话**：不做自动登录，也不处理验证码
- **站点选择器会失效**：千问/DeepSeek 改版后需要更新 `sites.mjs` 里的选择器
- **不是官方 API**：这是对网页/客户端界面的自动化，受对方服务条款约束，请自行评估合规性

---

## 许可

个人项目，供学习参考。
