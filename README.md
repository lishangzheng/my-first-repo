<!-- markdownlint-disable first-line-h1 -->
<!-- markdownlint-disable html -->

<div align="center">
  <img src="assets/logo.svg" width="96" height="96" alt="Multi-Model Bridge">
  <h1>Multi-Model Bridge</h1>
  <p><b>Five locally authenticated models. One programmable local service.</b></p>
  <p>千问 · DeepSeek · Kimi · MiniMax Code · 智谱清言</p>
  <p>
    <img alt="Platform" src="https://img.shields.io/badge/platform-Windows-0078D4?logo=windows&logoColor=white">
    <img alt="Node" src="https://img.shields.io/badge/node-%E2%89%A518-339933?logo=node.js&logoColor=white">
    <img alt="Protocol" src="https://img.shields.io/badge/protocol-CDP-536af5">
    <img alt="API Key" src="https://img.shields.io/badge/API%20key-not%20required-536af5">
  </p>
</div>

<hr>

## Table of Contents

1. [简介](#1-简介)
2. [模型清单](#2-模型清单)
3. [架构](#3-架构)
4. [快速开始](#4-快速开始)
5. [使用](#5-使用)
6. [设计约束](#6-设计约束)
7. [添加第六个模型](#7-添加第六个模型)
8. [安全与隐私](#8-安全与隐私)
9. [已知限制](#9-已知限制)
10. [验证](#10-验证)
11. [许可](#11-许可)
12. [联系](#12-联系)

## 1. 简介

本项目提出一种不依赖 API Key 的多模型接入方式：以 **Chrome DevTools Protocol（CDP）** 驱动本机已登录的五个对话式模型，将它们统一为一个可编程的本地服务。系统不保存账号凭据，也不修改用户日常使用的浏览器配置。当前实现覆盖 5 个模型、2 个调试端口（9222 / 9223），Node.js 侧零第三方依赖。

与需要 API Key 的聚合网关不同，本项目复用用户已经建立的登录态。CDP 只负责四件事：定位输入框、写入问题、触发发送、读取答案。请求仍发生在模型厂商自己的网页或客户端内，调试端口只监听 `127.0.0.1`。

五个端点分别是：千问本地客户端（`9223`），以及同一个调试 Chrome 中的 DeepSeek、Kimi、MiniMax Code、智谱清言四个标签页（`9222`）。端口与模型不是一一对应。

### 设计目标

---

**零 API Key**

- 不申请、不保存任何模型厂商的密钥。
- 登录态保存在本地浏览器/客户端 profile 中，不进入仓库。

---

**零第三方依赖**

- Node.js 18+ 内置的全局 `WebSocket` 足以完成 CDP 握手。
- 不引入 Puppeteer 等重型运行时，每一步都可以手工复现。

---

**部分成功**

- N 路并发提问，谁没答就跳过谁。
- `ok` 表示本轮至少一家可用；`allOk` 才表示每一家都作答。
- 限流、超时、掉登录都不会让整轮失败。

## 2. 模型清单

| 模型 | 入口 | 端口 | 默认等待 | 说明 |
| --- | --- | --- | --- | --- |
| 千问 | 本地客户端 `qianwen.exe` | 9223 | 180s | Slate 编辑器，输入依赖 `execCommand('insertText')` |
| DeepSeek | `chat.deepseek.com` | 9222 | 180s | 纯 textarea，输入与提交都最直接 |
| Kimi | `www.kimi.com` | 9222 | 420s | 推理模式会长时间停顿；免费额度会限流 |
| MiniMax Code | `agent.minimax.cn` | 9222 | 300s | Agent 形态，会执行工具后汇总 |
| 智谱清言 | `chatglm.cn` | 9222 | 180s | 提交必须收完整 keyDown + char + keyUp |

> Kimi 的桌面客户端无法接入：`Kimi.exe` 检测到任何调试开关即 `exit 1`，拦截位于可执行文件内部。因此 Kimi 使用网页版，登录态与客户端一致。

## 3. 架构

```text
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

---

**驱动层**

- `cdp.mjs`：零依赖 CDP 客户端，负责 WebSocket 握手与 JSON 帧。
- `drive.mjs`：点击、插入文字、按键序列、可见性仿真等原语。
- `ask.mjs`：单侧提问全流程——登录检查、写入、发送、等待、清洗。

---

**站点层**

- `sites.mjs`：每个站点的输入框、发送键、答案容器、生成标志、等待预算，只写在这一处。
- `answer.mjs`：判断哪一个块是最终答案，跳过思考块与工具调用块。
- `wait-policy.mjs`：判断回答是否写完；quiet / stale / budget 三种收尾原因。

---

**编排层**

- `cross-check.mjs`：N 路并发、15 秒心跳、部分成功语义、原文留档。
- `read-last.mjs`：只读回读页面上的最后答案，用于超时后的正确恢复。

## 4. 快速开始

### 4.1 环境要求

- Windows 10/11
- Node.js 18+（使用内置全局 `WebSocket`）
- Chrome（桥接使用独立 profile，不碰日常配置）
- 千问客户端（可选；只用网页端也能运行）
- DeepSeek / Kimi / MiniMax / 智谱账号（各自在调试浏览器中登录一次）

### 4.2 启动

```powershell
# 一键：缺哪个补哪个，约 6 秒
.\bridge\launch-bridge.bat

# 或分别启动
.\bridge\start-browser.ps1      # 调试 Chrome（9222，四个网页模型）
.\bridge\start-qwen-debug.ps1   # 千问客户端（9223）

# 查看状态
.\bridge\status.ps1
```

如果 PowerShell 拦截未签名脚本：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\bridge\status.ps1
```

### 4.3 首次登录

首次运行需要在弹出的浏览器/客户端中登录一次。登录态保存在独立 profile 中，之后重启不需要重新登录。桥接不会自动登录，也不处理验证码。

## 5. 使用

### 5.1 交叉校对

```powershell
# 五路并行，原文留档
node bridge\lib\cross-check.mjs "你的问题" --out "cross-check\2026-10-28-主题.md"

# 只问其中几家
node bridge\lib\cross-check.mjs "你的问题" --sites deepseek,kimi

# 单侧提问
node bridge\lib\ask.mjs deepseek "你的问题" --new-chat
```

### 5.2 超时回读

等待预算按站点自动分配，运行中每 15 秒输出心跳。超时后不要重发问题——答案通常已经在页面上：

```powershell
node bridge\lib\read-last.mjs kimi
node bridge\lib\read-last.mjs kimi --wait 60
```

### 5.3 返回结构

| 字段 | 含义 |
| --- | --- |
| `ok` | 本轮可用（至少一家作答），决定退出码 |
| `allOk` | 是否每一家都作答（通常为 false） |
| `answered[]` / `failed[]` | 谁答了 / 谁没答及原因 |
| `sides.<站点>.answer` | 该站原文，用于对比 |
| `endReason` | `quiet` 正常收尾 / `stale` 标志卡死兜底 / `budget` 预算耗尽 |
| `truncated` / `staleCut` | 被预算或兜底截断，不算完整答案 |
| `hint` | 失败或可疑时的下一步建议 |

## 6. 设计约束

### 6.1 任何等待都不能等「步骤脚本退出」

启动脚本会启动 Chrome，而 Chrome 会继承其 stdout/stderr 句柄并一直持有到浏览器关闭。以下写法都会把调用方挂死：

```powershell
Start-Process -Wait ...        # 挂死
& .\step.ps1 | ReadToEnd       # 挂死
```

解法：用 WMI 宿主（`Win32_Process.Create`）把步骤脚本完全脱离本进程启动，并且只以「端口是否监听」作为成功判据，不等脚本退出。

### 6.2 编码：.bat 与 .ps1 必须保持纯 ASCII

- `cmd` 用 OEM 代码页解析 `.bat` 字节，中文可能被搅乱成「找不到路径」。
- Windows PowerShell 5.1 把无 BOM 的 `.ps1` 当 ANSI 读，中文会乱码。

解法：所有 `.bat` 与启动用 `.ps1` 保持纯 ASCII，中文提示统一放 `launcher-strings.json`，用显式 UTF-8 读取。`.mjs` 是 UTF-8，可以正常写中文注释。

### 6.3 未签名脚本会被执行策略拦截

```powershell
.\script.ps1                                              # not digitally signed
powershell -ExecutionPolicy Bypass -File .\script.ps1     # ok
```

### 6.4 端口检查要有 TCP 兜底

`Get-NetTCPConnection` 在受限环境下会静默返回空，把健康的通道报成 DOWN。`status.ps1` 和启动器都带 TCP 连接兜底，不要改回单一检查。

### 6.5 不要因为慢就重发

重发会在对话历史里留下两条相同的问题，让后续对比失真。超时的那一刻，答案往往已经在页面上。正确动作是 `read-last.mjs`，不是重问。

### 6.6 站点选择器只写在 sites.mjs

每个选择器旁边的注释都记录了它是怎么试出来的，以及哪些看起来能用的写法实测失败。加一个模型 = 在 `sites.mjs` 中加一个条目，驱动层通常不需要改动。

## 7. 添加第六个模型

1. 在调试 Chrome 中打开并登录新站点（不是日常 Chrome）。
2. 侦察：`node bridge\lib\probe-new.mjs <url片段>`，查看输入框候选、按钮、容器。
3. 定位四样东西：输入框、发送键、答案容器、生成中标志。
4. 写进 `sites.mjs`，填写 `port`、`match`、`rank`、`timeoutSec`、`page{...}`。
5. 验证：`node bridge\lib\ask.mjs <新站点> "测试问题" --new-chat`，再跑一次多路交叉校对。

2026-10-26 添加 MiniMax 和智谱时，唯一的驱动改动是补了一个 `pressEnter()`——智谱必须收完整 keyDown + char + keyUp。

## 8. 安全与隐私

- **仓库中没有密码、手机号、账号名或 API 密钥，也不需要填这些。** 桥接只驱动浏览器中已经登录的会话；登录态在本地 profile（`%USERPROFILE%\.dsh-bridge\chrome-profile`、千问自己的 `User Data`），不会进入 git。
- 代码中唯一需要按机器修改的是程序安装路径。默认使用 `%LOCALAPPDATA%\` 推断，安装在别处时按脚本中的 `FILL IN` 注释修改。
- 提问会真实留在各站点的对话历史中；涉及隐私的问题请先使用各站的临时会话或删除功能。
- 如果 fork 本项目：不要把本地路径、账号昵称、cookie、token 提交进仓库。`.gitignore` 已挡住 `.env`、`*.local.*`、日志与交叉校对留档。

### 需要按机器改的地方

| 文件 | 这里填什么 |
| --- | --- |
| `bridge/start-browser.ps1` | Chrome 的安装路径（默认 `%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe`） |
| `bridge/make-desktop-shortcut.ps1` | 同上，只用于快捷方式图标 |
| `bridge/start-qwen-debug.ps1` | 千问客户端 `qianwen.exe` 的路径 |
| `bridge/qwen-debug-restart.ps1` | 千问 exe 与 `User Data` 目录 |
| `bridge/qwen-debug-force.ps1` | 同上 |

> `.ps1` 中的注释使用英文 `FILL IN`，是因为这些脚本必须保持纯 ASCII（Windows PowerShell 5.1 会把无 BOM 的 `.ps1` 当 ANSI 读，中文会乱码）。密码、手机号、账号、密钥不需要填。

## 9. 已知限制

- **仅 Windows**：路径、进程管理、编码处理都针对 Windows。
- **依赖已登录的本机会话**：不做自动登录，也不处理验证码。
- **站点选择器会失效**：站点改版后需要更新 `sites.mjs`。
- **Kimi 免费档会限流**：高峰排队或额度耗尽，不是桥接故障；420s 预算为推理停顿刻意保留。
- **MiniMax 是 Agent**：会执行工具，回答中包含「共执行 N 秒」；积分见底会发送失败。
- **不是官方 API**：这是对网页/客户端界面的自动化，受各模型服务商服务条款约束，请自行评估合规性。

## 10. 验证

| 项目 | 结果 |
| --- | --- |
| 等待判定单测 | 8/8 通过（`node bridge\lib\wait-policy.test.mjs`） |
| 五路并发（2026-10-26） | 4/5 作答；Kimi 报 `LIMIT_QUEUE` 被跳过；13.9s |
| 回读一致性 | `read-last deepseek` 读出 2753 字，与驱动返回一致 |

## 11. 许可

个人项目，仅供学习与研究。使用本项目即表示你同意遵守各模型服务商的服务条款。

## 12. 联系

如有问题或建议，请在 [Issues](https://github.com/lishangzheng/my-first-repo/issues) 中提出。
