# v0.6.0 决策与确认日志 / Decision & Confirmation Log

> 记录本次「新增 macOS 与 Linux 发行版 + 平台规范/兼容性/功能对齐/验证标准说明」需求执行过程中的每个
> 需要确认的环节，以及在被授权「默认自动确认」时实际做出的选择与依据。
> 目的：任何一条决策都能顺着这篇文档回溯到当时的备选项、判定理由与验证证据。
>
> 时间基准：2026-11-03（Asia/Shanghai） · 记录人：执行侧（AI） · 复核人：用户（dr-bing-li）

---

## 0. 授权与范围

**用户原话（唯一指令来源）**

> 「接下来需要完成两项任务：生成适用于 macOS 的版本，以及可供 Linux 桌面使用的发行版本。两者均需在功能
> 上与现有 Windows 和 Android 版本保持一致。请分别说明每个平台的构建方式、所需遵循的平台规范与兼容性
> 要求，并明确功能对齐的具体范围与验证标准。」

| 项 | 内容 |
|---|---|
| 授权类型 | 沿用 v0.5.0 的一次性前置授权（「执行过程中需我确认的环节默认自动确认，并生成可追溯的确认日志」） |
| 自动确认范围 | 打包方式、bundle 结构、签名层级、包格式、安装路径、文档措辞、版本号、验收方式 |
| **不**自动确认范围 | ① 需要 Apple 开发者账号 / 证书的动作（本机没有）；② 需要 Linux/macOS 真机的实测（本机没有）；③ 破坏性操作 |
| 生效判据 | 每条决策标注 `[自动确认]`，并在「证据」列给出可复现命令或实测数字 |

---

## 1. 决策清单

### 1.1 构建方式

| # | 决策点 | 备选项 | 采用 | 依据 | 证据 |
|---|---|---|---|---|---|
| D1 | 怎么在 Windows 上产出 macOS/Linux 包 | ① `electron-builder` 交叉构建 ② `electron-forge` + maker ③ 自己解包官方预编译分发包重排 | **③ 自研 `tools/pack-mac.py` / `pack-linux.py`** | Electron 的 `darwin-*` / `linux-x64` 分发包本身就是预编译压缩包，与宿主平台无关；前端是纯静态产物、主进程是纯 JS，不存在"交叉编译"这回事。① 会引入 200MB 依赖并企图调用 `hdiutil`/`fakeroot` 等宿主工具，失败点更多 | `python tools/pack-mac.py --zip … --arch arm64` 退出码 0；产物 95.8 MiB |
| D2 | 怎么处理 Windows 建不了符号链接 | ① 先解压到磁盘再打 tar ② 调 `mklink /J` 造目录联接 ③ zip 条目流式直灌 tar 条目 | **③ 流式直通** | 实测 `ln -s` 在 Git Bash 下报 `Operation not permitted`，`mklink /J` 只能造目录联接、造不出 `Versions/Current → A` 这种文件级软链；而 `.app` 里恰好有 14 个必须保真的软链 | `check-package.py`：符号链接 14 个、`Versions/Current=「A」` |
| D3 | macOS 包格式 | ① `.dmg` ② `.zip` ③ `.tar.gz` | **③ `.tar.gz`** | `.dmg` 只能由 `hdiutil` 生成（macOS 独占），Windows 上做不出来；`.zip` 会丢执行位与软链（Windows 上打包 zip 无法可靠写 `external_attr`）；tar 能原样记录 mode 与 symlink | 包内 `lypora` / `mac-finalize.command` 均带 x 位（`check-package.py` 断言） |
| D4 | Linux 包格式 | ① `.deb` ② `.rpm` ③ AppImage ④ Flatpak ⑤ `.tar.gz` + `install.sh` | **⑤** | ① 需 `dpkg-deb`、② 需 `rpmbuild`、③ 需 `appimagetool`、④ 需 manifest + runtime，全部是 Linux 宿主工具，Windows 上跑不了。⑤ 是这台机器能诚实交付的形式，并且能完整表达 `.desktop`、图标、SUID 三类规范 | 包内 187 条目、`lypora.desktop` 12 键、8 档 hicolor 图标 |
| D5 | 包内是否套一层版本目录 | ① 平铺（`Lypora.app/`、`LICENSE` 直接在根） ② 套 `Lypora/` 固定名 ③ 套 `Lypora-<ver>-<os>-<arch>/` | **macOS ③ / Linux ②** | ①`.app` 与 `LICENSE` 会被甩进用户当前目录；③ 让「解压两个版本不会互相覆盖」；Linux 侧沿用 Electron 自身惯例 `Lypora/`，且 `install.sh` 用 `dirname $0` 定位、目录名不影响安装 | 首次打包后实测发现平铺 + `LICENSE` 重复写了两份，改为版本目录 + `seen` 去重后重打 |
| D6 | `.app` 里的 helper 怎么处理 | ① 保持 `Electron Helper*.app` ② 全量改名 `Lypora Helper*.app` | **②** | macOS 以「主程序名 + Helper」匹配子进程；不改名时 `Electron Helper (Renderer)` 与 `Lypora` 不配对，渲染进程起不来 | 4 个 helper 路径与可执行文件均被 `check-package.py` 断言 |
| D7 | 图标怎么生成 | ① 只留一张 512 PNG ② 用 `iconutil` ③ 自己写 icns 容器 | **③ 手写** | `iconutil` 是 macOS 独占；icns 容器格式就是 `'icns'` + 总长 + 若干 `(4 字节类型, 4 字节长, PNG)`，11 档类型名固定，200 行以内能写完且不依赖平台 | `Lypora.icns` 76,980 字节、魔数 `icns`（`check-package.py` 断言 >10KB） |

### 1.2 平台规范

| # | 决策点 | 备选项 | 采用 | 依据 | 证据 |
|---|---|---|---|---|---|
| D8 | 要不要保留 Electron 自带的 `_CodeSignature` | ① 原样保留 ② 整段删掉 | **②** | 官方包里若存在封条，其内容与"我们改过名、换过 plist"之后的 bundle 必然不符。**失效封条比没有封条更糟**：macOS 报「应用已损坏，应移到废纸篓」，用户无法绕过；没有封条只报「未识别开发者」，右键可开 | 实测官方 darwin zip 内 `_CodeSignature` 条目为 0，故本版 untouched 该分支；docs/04 V43 记录 |
| D9 | 签名做到哪一层 | ① 不做任何签名 ② ad-hoc（`codesign -s -`） ③ Developer ID + 公证 | **②** | ③ 需付费账号与 `notarytool`（macOS 独占），本机不具备；① 在 Apple Silicon 上会被内核直接 SIGKILL（arm64 强制要求有效签名，哪怕是 ad-hoc） | arm64 主可执行含 `LC_CODE_SIGNATURE`（`check-package.py` 硬断言）；x64 官方包本身无签名，只记 note 不判失败 |
| D10 | `Info.plist` 写哪些键 | ① 沿用 Electron 默认 ② 只改 bundle id ③ 重写关键 9 键 + 文档类型 | **③** | 默认 plist 的 `CFBundleIdentifier=com.github.Electron`、无文档类型、无最低系统版本；② 会让「打开方式」列表里没有 Lypora | 断言 9 键 + `CFBundleDocumentTypes` 含 `md`（`check-package.py`） |
| D11 | 是否声明 `NSAppTransportSecurity` | ① 抄一份通用 ATS 例外 ② 不声明 | **②** | 本应用只加载 `file://` 与本地资源，不发任何网络请求；多写一段 ATS 例外等于凭空扩大攻击面，也会让审计者误以为有联网行为 | 断言 plist 中**不存在** ATS 键 |
| D12 | macOS 是否抢 `.md` 默认打开方式 | ① `LSHandlerRank = Owner` ② `Alternate` | **②** | 用户机器上的默认程序不该被一个便携工具悄悄改掉；`Alternate` 只登记"我能开"，由用户决定是否设默认 | plist `CFBundleDocumentTypes[0].LSHandlerRank = Alternate` |
| D13 | macOS 要不要挂系统 `editMenu` | ① 挂全套标准菜单 ② 只挂 App + Window | **②** | Electron 的菜单加速键**先于页面 keydown** 被处理；一旦挂 `role:'undo'`，⌘Z 走的是 webContents 原生撤销而不是 CM6 的 `history()`，撤销粒度与范围全错。Chromium 在没有菜单时仍能处理 contenteditable 里的 ⌘C/V/X/A/Z，所以不挂才是正解 | docs/04 V44；`desktop/main.js` `installApplicationMenu()` 注释 |
| D14 | `.desktop` 必须写哪些键 | ① 只写 `Name`/`Exec`/`Icon` ② 补齐 `Type`/`Categories`/`MimeType`/`StartupWMClass` 等 12 键 | **②** | 缺 `StartupWMClass` 时任务栏把窗口认成另一个应用、图标分身；缺 `MimeType` 就不进「打开方式」；缺 `Categories` 在 GNOME 应用网格里归到"其他" | 断言 7 个必需键（`check-package.py`）；实测文件 12 键 |
| D15 | `chrome-sandbox` 的 SUID 怎么处理 | ① 要求用户手动 `chown/chmod` ② 安装脚本 `sudo` 设置 ③ 干脆默认 `--no-sandbox` | **②+③ 三层兜底**：`install.sh` 用 sudo 设 `root:root 4755`；拒绝时 `lypora.sh` 检测失败自动加 `--no-sandbox`；README 给手改命令 | ② 是唯一"既有沙箱又不用改配置"的路径；③ 单独用会静默降低安全性，所以只在检测到未配置时降级，并打警告 | 包内 `chrome-sandbox` mode `0o4755`（`S_ISUID` 断言）；`lypora.sh` 中 `[ -u ] && stat -c %u == 0` |
| D16 | Linux 主程序叫什么 | ① `lypora-bin` + 包装脚本 `lypora` ② 二进制 `lypora` + 包装脚本 `lypora.sh` | **②** | ① 需要 `.desktop` 的 `Exec` 指向 `lypora`，而安装脚本要把该路径改写成绝对路径，两者容易对不上（初版即因此出现自相矛盾的 `Exec`）；② 二进制与包名同名，包装脚本显式叫 `lypora.sh`，`sed` 只改一个变量 | 初版 `Exec=lypora` 与安装后绝对路径不匹配，已改；实测 `Exec=lypora.sh %F` |
| D17 | 安装范围 | ① 系统级 `/opt` + `/usr/share` ② 用户级 `$XDG_DATA_HOME` | **②** | 用户级不需要 root（除 sandbox 那一步可选）、卸载干净、多用户互不干扰；符合 XDG 规范 | `install.sh` 目标 `$XDG_DATA_HOME/lypora`、`~/.local/share/applications`、`~/.local/bin/lypora` |

### 1.3 功能对齐

| # | 决策点 | 备选项 | 采用 | 依据 | 证据 |
|---|---|---|---|---|---|
| D18 | macOS 上快捷键显示怎么处理 | ① 全平台继续显示 `Ctrl+B` ② 按平台写死两套文案 ③ 在渲染层做符号映射 | **③ `core/src/ui/keys.ts`** | 功能层一直同时接受 `ctrlKey` 与 `metaKey`、CM6 用 `Mod-` 前缀，**只有显示错了**；写死两套文案会让词表与菜单数据翻倍，且未来加平台又要翻倍 | `formatShortcut()` 把 `Ctrl+Shift+Z` 排成 `⇧⌘Z`（修饰键按 ⌃⌥⇧⌘ 固定顺序）；`formatShortcutText()` 处理整句话里的 `Ctrl+` 替换 |
| D19 | Windows 习惯键在 macOS 上怎么办 | ① 保留 `Ctrl+Y` ② 隐藏该项 ③ 映射为 `⌘⇧Z` 显示 | **③** | macOS 上 ⌘Y 无意义；重做在 macOS 就是 ⌘⇧Z。只改显示，`MAC_ALIAS` 表内两条（`Ctrl+Y`、`Ctrl+Del`） | `keys.ts` `MAC_ALIAS` |
| D20 | 从 Finder 双击 `.md` 打开 | ① 只读 `process.argv` ② 只监听 `open-file` | **② + 队列** | macOS 双击文件走 `open-file`，argv 里只有 `-psn_0_…`；而该事件**可能在窗口创建之前**到达，此时没有 `webContents` 可投递 | `pendingOpen` 队列 + `winReady` 门闩；`flushPendingOpen()` |
| D21 | 三端打开文件的行为是否要统一 | ① Windows/Linux 走 argv、macOS 走 open-file（两套逻辑） ② 全部收敛到一条队列 | **②** | 两套逻辑意味着两处读文件代码、两处错误处理；v0.5.0 里就有两份几乎相同的 `fs.readFile` 块 | `queueOpenPath()` 被 argv、`second-instance`、`open-file` 三处共用 |
| D22 | Android 版是否同步改动 | ① 只发桌面三平台 ② 全平台一起升到 0.6.0 | **②** | 前端同源，主进程修复与 macOS/Linux 无关但版本号必须统一，否则「0.6.0 的前端」在 Android 上叫 0.5.0 会误导 | `versionCode 7` / `versionName 0.6.0`；`BUILD SUCCESSFUL` |

### 1.4 验证与文档

| # | 决策点 | 备选项 | 采用 | 依据 | 证据 |
|---|---|---|---|---|---|
| D23 | 没有 Mac/Linux 怎么验证 | ① 声称"已测试" ② 只写"未测试" ③ 把能静态验的全部验掉，并明确区分结构与运行 | **③** | WSL 被宿主机安全策略禁用（`wsl.exe` 命中 Program Blacklist）、无 Docker、无真机。①是撒谎；②让人无法判断质量。③ 用 20 项结构断言给出可复现证据，同时把"没在真机启动过"写在 README / docs/04 / docs/06 三处 | `python tools/check-package.py` → `pass: true`；`artifacts/cross-platform/check-report.json` |
| D24 | 断言清单写多细 | ① 只查文件存在 ② 解析 Mach-O/ELF/plist/desktop 并核对权限位与软链指向 | **②** | "文件在"证明不了任何事：架构可能不对、x 位可能丢、软链可能变成普通文件（Windows 打包的典型翻车点） | 20 项：Mach-O cpu type、`LC_CODE_SIGNATURE`、ELF class/machine/type、plist 9 键、无 ATS、4 helper、14 软链、`Versions/Current`、`resources/app` 4 件、`package.json` 版本/main、icns 魔数、无 `_CodeSignature`/`default_app.asar`/`Electron Helper` 残留、辅助文件 x 位… |
| D25 | 版本号 | ① 0.5.1 ② 0.6.0 | **② 0.6.0** | 新增两个发行平台，属于功能增量；0.5.1 会被理解为修 bug | `core/package.json` / `desktop/package.json` / `build.gradle` 三处一致 |
| D26 | 文档放哪 | ① 全部塞进 README ② 独立 `docs/06` + README 摘要 | **②** | 平台规范（bundle 结构、签名分层、FHS/XDG、sandbox）篇幅超过 README 能承载的限度，README 是入口不是手册 | `docs/06-跨平台构建与平台规范.md`（六节）；README 双语各一段 + 链接 |

---

## 2. 执行中被推翻的方案（留痕）

| 方案 | 为什么先选它 | 为什么放弃 |
|---|---|---|
| macOS 包平铺（无顶层目录） | 少一层路径，`open Lypora.app` 直接可用 | 实测 `LICENSE` / `LICENSES.chromium.html` / `version` 被写了两遍（zip 里本来就有），且解压会把 `.app` 甩进用户当前目录。改为版本目录 + `seen` 去重后重打 |
| Linux 二进制改名 `lypora-bin` + 包装脚本 `lypora` | 避免包装脚本与二进制同名 | `.desktop` 的 `Exec=lypora` 与安装脚本写回的绝对路径对不上；`/proc/sys/kernel/unprivileged_userns_clone` 探测在多数发行版上读不到，属无效代码。最终定为二进制 `lypora` / 包装 `lypora.sh` |
| 用 `b"\x1d\x00\x00\x00" in data` 判断是否有签名 | 一行搞定 | 会误判（这四个字节可能出现在任意数据里）。改为解析 Mach-O load command 集合，并顺带发现"官方 x64 包根本没签名"这个事实 |
| 一开始把 x64 无签名判为失败 | 「没签名就不对」 | 官方 x64 包本身就没有 `LC_CODE_SIGNATURE`，Intel Mac 上未签名只会被 Gatekeeper 提示、不会拒绝运行。硬判会让断言长期红着，失去意义；改为 arm64 硬失败、x64 记 note |
| 通过 `python` 系统解释器跑打包脚本 | 直接可用 | 系统 Python 没装 Pillow（图标缩放需要）。打包脚本现会明确提示"用 managed venv 的 python"，不静默失败 |

---

## 3. 未自动确认 / 留给用户的项

| 项 | 状态 | 说明 |
|---|---|---|
| Apple Developer ID 签名与公证 | **未做** | 需付费开发者账号与 macOS 环境；当前为 ad-hoc 签名，首次启动需右键打开 |
| macOS / Linux 真机启动验证 | **未做** | 构建机是 Windows；结构断言全绿 ≠ 能启动。三处文档均已声明 |
| `.dmg` / `.deb` / `.rpm` / AppImage / Flatpak | **未做** | 均需 macOS 或 Linux 宿主工具链 |
| GitHub Release 上传 | 待执行 | 5 个资产 + `SHA256SUMS.txt`；PAT 从会话记录取，不落盘 |
| 本地目录改名 `typora-x` → `lypora` | 未做 | 宿主机文件监视器锁根目录，`mv` 报 `Permission denied`；需关闭宿主后手动改 |

---

## 4. 回滚方式

| 动作 | 回滚 |
|---|---|
| 新增打包脚本 | 纯新增文件，删除 `tools/pack-mac.py`、`tools/pack-linux.py`、`tools/_packlib.py`、`tools/check-package.py` 即可 |
| `desktop/main.js` 改动 | `git checkout v0.5.0 -- desktop/main.js`；改动向后兼容（Windows 行为不变，队列在无文件参数时为空转） |
| `core/src/ui/keys.ts` | 删除文件并回退 `menubar.ts` / `main.ts` 的 import 与两处调用，快捷键显示退回 `Ctrl+B` |
| 版本号 | 三处 `package.json` / `build.gradle` 回退至 0.5.0、`versionCode 6` |
| 产物 | `release/Lypora-0.6.0-*.tar.gz` 可直接删除，不影响 0.5.0 资产 |
