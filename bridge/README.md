# 桥接运行时管理

这个目录负责本地多模型桥接：**五个模型**——千问客户端（9223）+ 一个调试 Chrome 里的
四个网页标签（DeepSeek / Kimi / MiniMax Code / 智谱清言，都在 9222）。

## 一键启动（推荐）

桌面上双击 **「启动模型桥接」** 即可。它等价于：

`bridge\launch-bridge.bat`

会检查五个模型、缺谁补谁、打印状态报告、自动退出（约 6 秒）。
已经就绪的一方会跳过，所以重复双击无害。

**缺几个也能用**：交叉校对会用答了的那些；没答的（限流/超时/没登录）会被自动跳过，
不影响结论。

> 快捷方式 2026-10-25 从「启动双模型桥接（千问+DeepSeek）」改名为「启动模型桥接」：
> 名字里刻意不带数字，再加模型就不用再改一次名字。改名字只改
> `launcher-strings.json` 的 `shortcutName` 再跑 `make-desktop-shortcut.ps1` 即可。
>
> **悬停提示会自愈**：启动器每次非 `-Quiet` 启动时，会比对 `.lnk` 里的 Description 与
> `launcher-strings.json` 的 `shortcutTooltip`，不一致就重写。加这个是因为
> Agent 会话的沙箱写不了桌面（桌面在会话工作区之外），而用户双击时是正常权限。
> 重写失败只记 trace，**绝不影响启动**。
> `.bat` 文件名保持 ASCII 是刻意的：cmd 用 OEM 代码页解析 .bat 字节，
> 中文文件名或正文可能被搅乱成「找不到路径」。中文名放在桌面快捷方式上。
> 启动器自身也是纯 ASCII 源码，所有中文提示都在 `launcher-strings.json` 里。

## 状态

`pwsh -File bridge\status.ps1`

会报告两件事：

1. **监听端点**：9222（四个网页模型共用的调试浏览器）、9223（千问客户端），各自的页面标题与 URL
2. **按模型检查**：`deepseek` / `kimi` / `minimax` / `chatglm` / `qwen` 各自的标签在不在

> 端口和模型**不是一一对应**的：9222 上同时挂着四个标签页。
>
> 端口检查带 **TCP 连接兜底**：`Get-NetTCPConnection` 在受限环境下会静默返回空，
> 把健康的通道报成 DOWN（启动器曾因此重启过没问题的千问）。别把兜底删了。

## 重新拉起

**情况 A：调试浏览器被关掉了（DeepSeek 与 Kimi 一起没）**

`pwsh -File bridge\start-browser.ps1`

会用同一个独立 profile 重新启动，登录态保留在
`%USERPROFILE%\.dsh-bridge\chrome-profile`，不需要重新登录。

**情况 B：浏览器在，但某个网页标签被关掉了（或从没开过）**

`pwsh -File bridge\open-web-tabs.ps1`

按 DeepSeek / Kimi / MiniMax / 智谱 四个站点逐个检查，缺哪个开哪个，
**不启动浏览器**。9222 没在监听时它会直接说"先起浏览器"。
每个站点第一次用需要在那个窗口里手动登录一次（profile 会记住）。

**情况 C：千问客户端被关掉了（千问侧）**

按平常方式打开千问即可，但**调试口只有带参数启动才有**。带参数启动：

`pwsh -File bridge\start-qwen-debug.ps1`

如果千问已经在运行，需要先退出它（脚本会礼貌请求退出，失败才强制），
登录态在 `%LOCALAPPDATA%\Qianwen\User Data`，重启后仍在。

## Kimi 为什么是网页版，不是客户端

Kimi 的桌面客户端**故意封了调试口**：只要命令行里出现调试开关，`Kimi.exe` 就直接
退出（exit 1），stderr 明说：

`[kimi] refusing to start with debug switch present: --remote-debugging-port=9224`

`--remote-debugging-pipe`、`--inspect`、`--inspect-brk` 同样是这条拦截；
而 `--foo=bar`、`--disable-gpu` 这类无关参数不影响启动——说明是**专门针对调试开关**。
拦截在 `Kimi.exe` 本体里（整个 `app.asar` 里没有 `remote-debugging` 字样），
也不写日志，进程在初始化之前就退了。

**所以不要改二进制**：会被客户端自动更新覆盖、破坏签名，也违反使用条款。
桥接改走 `www.kimi.com`——同一个模型、同一个账号，只是开在浏览器里。
你电脑上的 Kimi 客户端不受任何影响，桥接也不碰它。

## 排查启动器卡住

启动器带阶段日志：

`pwsh -File bridge\launch-bridge.ps1 -Trace`

日志落在 `bridge\launcher-trace.log`，每行一个时间戳加阶段名。

设计上有一个必须遵守的约束：**任何等待都不能等「步骤脚本退出」**。
步骤脚本启动 Chrome，而 Chrome 会继承其 stdout/stderr 句柄并一直持有到浏览器关闭，
所以 `Start-Process -Wait`、管道、对重定向管道做 `ReadToEnd` 都会挂住。
启动器因此用 WMI 宿主（`Win32_Process.Create`）把步骤脚本完全脱离本进程启动，
并且**只以端口是否监听作为成功判据**。

（`open-web-tabs.ps1` 是例外：它只通过 HTTP 和 CDP 说话，不启动任何进程，
所以启动器可以直接等它跑完。）

## 端口约定

| 端口 | 归属 | 说明 |
| --- | --- | --- |
| 9222 | DeepSeek + Kimi + MiniMax Code + 智谱清言 | 独立 Chrome profile，只用于桥接；四个模型各占一个标签页 |
| 9223 | 千问客户端 | 客户端自带的 Chromium 调试口 |

端口都只监听 `127.0.0.1`，不对外网开放。

## 站点契约在哪

每个站点"怎么找输入框 / 怎么发送 / 怎么读答案 / 怎么判断在生成"**只写在
`lib\sites.mjs` 一处**。以前这些选择器散落在 `ask.mjs`、`inspect-site.mjs`、
`send-probe.mjs`、`clear-composer.mjs` 四份拷贝里，加第三个模型时要改四处；
现在加一个模型 = 在 `sites.mjs` 里加一个条目（2026-10-26 加 MiniMax 和智谱就是这么做的，
驱动层一行没改，只补了 `pressEnter()` 这一个按键序列）。

每个选择器旁边的注释都写着它是**怎么试出来的**（以及哪些看起来能用的写法实测失败），
改之前请连注释一起读。
