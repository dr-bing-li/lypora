# Windows 桌面版

Electron 二进制已就位（33.4.11），现在是**三条**路径，按用途选。

---

## 路线 A：便携包（推荐，可直接分发）★

```bash
cd ..                     # 回到 lypora/
node tools/pack-win.mjs --zip
```

产物：

| 路径 | 说明 |
|---|---|
| `release/Lypora/Lypora.exe` | 双击即用，图标/版本信息已写入，**不依赖 Node** |
| `release/Lypora-0.3.0-win-x64.zip` | 111MB，可直接发给别人 |

整个 `Lypora` 文件夹可以拷到 U 盘，保持目录结构即可运行；卸载 = 删文件夹
（配置在 `%APPDATA%\Lypora`）。

**自动化验收（不用人工点）**：

```bash
# ① 页面能不能正常加载：采 18 项指标 + 自截图 + 控制台报错检查
env -u ELECTRON_RUN_AS_NODE ./release/Lypora/Lypora.exe --selftest --shot=shot.png
#   退出码：0 全绿 / 1 加载失败 / 2 有控制台错误

# ② 点叉号能不能正常关：四个场景，靠退出码与磁盘内容判定
node tools/closetest.mjs --exe

# ③ 交互能不能用：CDP 连上真进程，用真实鼠标事件跑 Ctrl+滚轮与表格列宽拖拽
node tools/interacttest.mjs

# ④ 滚起来卡不卡：基线 / 派发对照 / 逐帧改字号 三段帧间隔 + longtask 计数
node tools/zoomperf.mjs

# ⑤ 输出 PDF 时公式对不对：抓打印 iframe，断言 KaTeX 字体已加载、版面没被压成一行
node tools/pdfexporttest.mjs
```

`--selftest` 会加载页面、采集 18 项指标、自己截图，然后按结果设退出码：
`0` 全绿 / `1` 加载失败 / `2` 有控制台错误。

### 关窗流程（点右上角叉号）

叉号 = 窗口收到 WM_CLOSE，主进程在 `win.on('close')` 里统一处理：

1. 问渲染层 `__lyporaCloseState()` 是否还有未保存修改；
2. 干净 → 直接退出；
3. 有修改 → 原生对话框「保存并退出 / 不保存 / 取消」；
4. 选保存 → 调 `__lyporaSaveAndClose()`，写盘成功才退出；
   用户取消「另存为」或写盘失败 → **留在窗口**，什么都不丢。

> 之前渲染层的 `beforeunload` 在 Electron 里是**静默取消**（不像浏览器会弹确认框），
> 表现就是"点叉号关不掉"。现在渲染层不再自己拦，关窗只走主进程一条路。

`--closetest=clean|dirty-discard|dirty-cancel|dirty-save` 加 `--close-choice=` 是给
`tools/closetest.mjs` 用的测试旁路（跳过系统对话框直接选一个分支），正常启动不受影响。

> `env -u ELECTRON_RUN_AS_NODE` 不是可选：宿主（WorkBuddy 本身是 Electron 应用）会把
> `ELECTRON_RUN_AS_NODE=1` 传给子进程，此时 Electron 退化成纯 Node，`ipcMain` 会是 undefined。

---

## 路线 B：源码态开发

```bash
npm install
npm start           # 生产路径（加载 ../core/dist）
npm run start:dev   # 开发路径（加载 http://127.0.0.1:5183，需先 cd ../core && npx vite dev --port 5183）
```

相比便携包，多了热更新调试能力；功能完全一致。

能力：原生 `dialog.showOpenDialog/showSaveDialog`、完整目录树（递归 2 层）、
单实例锁 + 文件参数转发（`second-instance`）、`app:open-path` 双击关联。

---

## 路线 C：Edge app 模式（没有 Electron 时的兜底）

双击 **`Lypora.cmd`**。

1. 起一个只监听 `127.0.0.1` 的本地静态服务（端口从 47821 起自动找空位）；
2. 用系统 Edge 的 `--app=` 模式打开 —— 无地址栏、无标签页，是一个独立窗口；
3. 使用独立浏览器配置目录 `%LOCALAPPDATA%\Lypora-App`，不干扰日常 Edge。

**为什么用本地服务而不是 `file://`？**
`file://` 下 File System Access API 与 Service Worker 都受限；`http://127.0.0.1` 是安全上下文，两者都能用。

限制：工作区目录树不可用（浏览器沙盒）；无文件关联/单实例。

自检：`node app.cjs --check`（输出端口、HTTP 状态码、首页字节数、挂载点与脚本引用）。

---

## 三条路线对比

| | A 便携包 | B 源码态 | C Edge app |
|---|---|---|---|
| 需要 Node | ❌ | ✅ | ✅ |
| 需要 Electron | 内置 | ✅ | ❌ |
| 原生文件对话框 | ✅ 主进程 dialog | ✅ | ✅ FSA API |
| 工作区目录树 | ✅ | ✅ | ❌ |
| 文件关联 / 单实例 | ✅ | ✅ | ❌ |
| 可分发 | ✅ zip | 需自行打包 | 需自建快捷方式 |
| 包体 | 270MB（zip 111MB） | — | ~2MB |

---

## Electron 二进制装不上时

本机实测（2026-10-24）：`npm i electron` 的下载脚本会超时，但镜像可直连。
**手动路径**（已验证可行）：

```bash
curl -L -o electron.zip \
  https://mirrors.huaweicloud.com/electron/33.4.11/electron-v33.4.11-win32-x64.zip

# 注意：Git Bash 自带的 GNU tar 不认 zip，必须用系统 bsdtar
"/c/Windows/System32/tar.exe" -xf electron.zip -C node_modules/electron/dist
printf 'electron.exe' > node_modules/electron/path.txt
```

可选镜像：`cdn.npmmirror.com/binaries/electron/<ver>/`、`registry.npmmirror.com/-/binary/electron/<ver>/`、
`mirrors.huaweicloud.com/electron/<ver>/`、GitHub Releases（最后一个最慢但也能通）。

## 前置条件

- 路线 A/B：Windows 10+ x64
- 路线 C：Node 18+，系统有 Microsoft Edge
- 构建前先出前端产物：`cd ../core && npx vite build`
