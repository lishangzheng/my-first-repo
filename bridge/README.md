# 桥接运行时管理

这个目录负责本地双模型桥接（千问客户端 + DeepSeek 网页版）。

## 一键启动（推荐）

桌面上双击 **「启动双模型桥接（千问+DeepSeek）」** 即可。它等价于：

```
bridge\launch-bridge.bat
```

会检查两个模型、缺谁补谁、打印状态报告、自动退出（约 6 秒）。
已经就绪的一方会跳过，所以重复双击无害。

> `.bat` 文件名保持 ASCII 是刻意的：cmd 用 OEM 代码页解析 .bat 字节，
> 中文文件名或正文可能被搅乱成「找不到路径」。中文名放在桌面快捷方式上。
> 启动器自身也是纯 ASCII 源码，所有中文提示都在 `launcher-strings.json` 里。

## 状态

```
pwsh -File bridge\status.ps1
```

会依次报告：

1. 两个调试端点是否在监听（9222 = DeepSeek 调试浏览器，9223 = 千问客户端）
2. 各自的页面标题与 URL（确认登录态没掉）
3. 浏览器与客户端进程是否存活

## 重新拉起

**情况 A：调试浏览器被关掉了（DeepSeek 侧）**

```
pwsh -File bridge\start-browser.ps1
```

会用同一个独立 profile 重新启动，登录态保留在
`%USERPROFILE%\.dsh-bridge\chrome-profile`，不需要重新登录。

**情况 B：千问客户端被关掉了（千问侧）**

按平常方式打开千问即可，但**调试口只有带参数启动才有**。带参数启动：

```
pwsh -File bridge\start-qwen-debug.ps1
```

如果千问已经在运行，需要先退出它（脚本会礼貌请求退出，失败才强制），
登录态在 `%LOCALAPPDATA%\Qianwen\User Data`，重启后仍在。

## 排查启动器卡住

启动器带阶段日志：

```
pwsh -File bridge\launch-bridge.ps1 -Trace
```

日志落在 `bridge\launcher-trace.log`，每行一个时间戳加阶段名。

设计上有一个必须遵守的约束：**任何等待都不能等「步骤脚本退出」**。
步骤脚本启动 Chrome，而 Chrome 会继承其 stdout/stderr 句柄并一直持有到浏览器关闭，
所以 `Start-Process -Wait`、管道、对重定向管道做 `ReadToEnd` 都会挂住。
启动器因此用 WMI 宿主（`Win32_Process.Create`）把步骤脚本完全脱离本进程启动，
并且**只以端口是否监听作为成功判据**。

## 端口约定

| 端口 | 归属 | 说明 |
| --- | --- | --- |
| 9222 | DeepSeek 调试浏览器 | 独立 Chrome profile，只用于桥接 |
| 9223 | 千问客户端 | 客户端自带的 Chromium 调试口 |

两个端口都只监听 `127.0.0.1`，不对外网开放。
