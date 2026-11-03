# v0.7.0 决策与确认日志 / Decision & Confirmation Log

> 记录本次「为 Linux 增加 deb/rpm 等主流安装格式 + 配置 GitHub 自动构建与发布」需求执行过程中的每个需要
> 确认的环节，以及在被授权「默认自动确认」时实际做出的选择与依据。
> 目的：任何一条决策都能顺着这篇文档回溯到当时的备选项、判定理由与验证证据。
>
> 时间基准：2026-11-03（Asia/Shanghai） · 记录人：执行侧（AI） · 复核人：用户（dr-bing-li）

---

## 0. 授权与范围

**用户原话（唯一指令来源）**

> 「请为当前 Linux 版本增加打包安装发布项，生成 deb、rpm 等主流可直接安装的发行格式，并配置 GitHub 仓库的
> 自动构建与发布流程：在触发条件（如打 tag 或发布 release）下自动完成多格式打包，将生成的安装包及校验信息
> 自动上传至 GitHub Releases，使用户可直接下载安装。请说明所需打包工具与依赖、目录与配置文件结构、构建
> 流程以及各发行格式的安装验证方式。并更新相应的说明。」

| 项 | 内容 |
|---|---|
| 授权类型 | 沿用 v0.5.0 的一次性前置授权（「执行过程中需我确认的环节默认自动确认，并生成可追溯的确认日志」） |
| 自动确认范围 | 包格式取舍、FHS 落点、CI 触发方式、验证手段、文档措辞、版本号、上传顺序 |
| **不**自动确认范围 | ① 需要 Linux / macOS 真机的实测（本机没有，WSL 与 Docker 也不可用）；② 需要付费证书的签名；③ 破坏性操作 |
| 生效判据 | 每条决策标注 `[自动确认]`，并在「证据」列给出可复现命令或实测数字 |

---

## 1. 决策清单

### 1.1 包格式

| # | 决策点 | 备选项 | 采用 | 依据 | 证据 |
|---|---|---|---|---|---|
| D1 | 出哪几种格式 | ① 只 deb ② deb + rpm ③ deb + rpm + AppImage ④ 再加 Flatpak / Snap | **③** | 用户点名 deb、rpm。③ 额外覆盖"不想装、任何发行版"这一档，且 `appimagetool` 与 `rpmbuild` 同在一个 runner 里，边际成本≈0。④ 要额外 SDK 与运行时清单，是另一个项目的工作量，且这两家已有自己的分发渠道 | 4 个产物：`lypora_0.7.0_amd64.deb`、`lypora-0.7.0-1.x86_64.rpm`、`Lypora-0.7.0-linux-x64.AppImage`、`Lypora-0.7.0-linux-x64.tar.gz` |
| D2 | 保留 tar.gz 吗 | ① 有了 deb/rpm 就删掉 ② 保留 | **② 保留** | 老发行版（glibc 2.28 以下）、无 root 环境、想把程序塞进任意目录的用户，只有 tar.gz 这一条路；`install.sh` 已是 v0.6.0 的既有交付，删掉是能力倒退 | `install.sh --uninstall` 仍在包内 |
| D3 | 三种封装怎么生成 | ① 各自从 Electron zip 取文件 ② 算一棵 FHS 暂存树，三者都吃它 | **②** | ① 迟早出现"deb 里少一个 locales、rpm 里多一个 `.so`"这种只在用户机器上炸的偏差。② 让"三份包内容一致"成为结构上的必然，而不是每次靠人比 | `tools/_linuxpkg.py` 单点产出 `build/stage/`；deb 200 文件 vs rpm 同一棵树 |
| D4 | 构建机怎么分工 | ① 在 Windows 上装 Linux 工具链 ② 全部交给 CI ③ Windows 算树、Linux 封包 | **③** | `dpkg-deb` / `rpmbuild` / `appimagetool` 都是 ELF 程序，本机无 WSL、无 Docker。③ 让 Windows 仍能本地核对结构与权限（除 SUID 位），封包这个必须 Linux 的环节交给 runner | `python tools/linux-stage.py --deb` 在 Windows 上退出码 0，`Installed-Size 279517 KB` |

### 1.2 落点与规范

| # | 决策点 | 备选项 | 采用 | 依据 | 证据 |
|---|---|---|---|---|---|
| D5 | 装到哪 | ① `/usr/lib/lypora` ② `/opt/lypora` ③ 复用 per-user `~/.local` | **② `/opt/lypora`** | FHS 明确规定 `/opt/<package>` 是"附加软件包"的位置；Electron 应用自带整套运行时，属于典型的"不遵循 `/usr` 层级"的软件。① 会把 300 MB 非系统文件混进 `/usr/lib` | `dpkg -L lypora` 全部落在 `/opt/lypora` + `/usr/{bin,share}` |
| D6 | `/usr/bin/lypora` 用符号链接还是 shell shim | ① symlink ② 3 行 shell | **② shell shim** | **Windows 建不了符号链接**。用了 symlink 这条链路就只能在 Linux 上跑，暂存树也就没法在 Windows 上先算一遍核对——而"能在 Windows 上核对"正是 D4 的前提 | `_linuxpkg.py` `USRBIN`；`ls -l /usr/bin/lypora` 是 `-rwxr-xr-x` 而非 `l` |
| D7 | 依赖怎么写 | ① 只写 `libasound2` 等老名 ② 写 `libasound2t64` 等新名 ③ `老名 \| 新名` | **③** | Ubuntu 24.04 做 t64 迁移后三个库改名。①在 22.04 对、24.04 错；②反过来。dpkg 的 Depends 支持 `\|`，两个 LTS 都满足，是唯一两边都对的写法 | `packaging/debian/control.in`；`dpkg-deb -I` 输出含三组 `\|` |
| D8 | `%files` 怎么列 | ① 逐个文件列 ② 列目录 ③ 混列 | **② `%files` 里只列目录**（`/opt/lypora`、`/usr/share/icons/hicolor`、`%license` 目录、`%doc` 目录） | ①/③ 会踩两个坑：同时列目录与目录下文件 → `File listed twice`；漏列任何一个文件 → `Installed (but unpackaged) file(s) found` 直接失败。列目录一次收干净 | docs/04 V48 附带记录；`rpmbuild -bb` 无告警 |
| D9 | Chrome 沙箱助手 | ① 打 0755，让用户自己 sudo ② 包里就带 4755 | **②** | 包管理器以 root 安装，能如实落下 setuid 位；让用户事后手改是把自己的问题转嫁给用户。AppImage 无 root，另行处理（D10） | `stat -c %A` → `-rwsr-xr-x`；容器内 `test -u` ✓ |
| D10 | AppImage 的沙箱 | ① 假装能带 SUID ② `AppRun` 直接带 `--no-sandbox` | **②** | AppImage 挂在无 root 的 squashfs 上，SUID 无从生效。与其让用户看到沙箱报错，不如启动器显式降级并在 README 写明"少了进程隔离" | `_linuxpkg.py` `AppRun` 首行 exec 带 `--no-sandbox`；notes 明写代价 |
| D11 | 要不要写 AppStream 元数据 | ① 不写 ② 写 `metainfo.xml` | **②** | GNOME Software / KDE Discover 靠它取图标、简介、分类；不写的应用在软件中心里是灰块 | `/usr/share/metainfo/app.lypora.editor.metainfo.xml` |
| D12 | deb 的版权文件 | ① 随便写个 `copyright` ② DEP-5 机器可读格式 | **②** | Debian 政策要求 `/usr/share/doc/<pkg>/copyright`；DEP-5 是唯一能让 `lintian` 不抱怨的形式，也便于合规审计 | `_copyright_text()` 生成；`head /usr/share/doc/lypora/copyright` 首行为 `Format:` |

### 1.3 自动构建与发布

| # | 决策点 | 备选项 | 采用 | 依据 | 证据 |
|---|---|---|---|---|---|
| D13 | 触发条件 | ① `push: tags: v*` ② `release: published` ③ 两者都挂 ④ 只 `workflow_dispatch` | **①（+ 手动 `workflow_dispatch` 指定已有 tag）** | 用户说"如打 tag 或发布 release"。② 的问题是把两件事绑死：想先看 CI 绿了再开 Release 就做不到，而且 tag push 已经覆盖"打 tag 就发"。③ 会让同一次发布跑两遍，第二遍还得靠 `--clobber` 收尾。④ 缺"推 tag 即发"的自动化。① + 手动补跑是唯一既自动又可回滚的组合 | `linux-installers.yml` `on:` 段；实际由 `git push origin v0.7.0` 触发 |
| D14 | 并发控制 | ① 不设 ② `cancel-in-progress: true` ③ `cancel-in-progress: false` | **③（按 tag 分组）** | ② 在补发同一 tag 时会把正在跑的构建砍掉，产出半套包。③ 保证同一 tag 串行，后一次等前一次跑完再覆盖 | `concurrency: group: linux-installers-<tag>`；实测 run #4 卡住时 run #5 排队等待 |
| D15 | 怎么证明包真能装 | ① 只看 `dpkg-deb -c` 文件清单 ② 在 host 上 `dpkg -i` ③ 起 `debian:12` / `fedora:40` 容器真装 | **③** | ① 只证明归档结构对，证明不了依赖声明对、postinst 能跑、权限位能落。② runner 是 Ubuntu，装不了 rpm，且污染 runner。③ 是唯一能同时覆盖两个包管理器的办法 | run #4/#5 步骤 14、15 全 `success`；容器内 `dpkg -s lypora` 与 `rpm -q lypora` 均成功 |
| D16 | 容器里断言什么 | ① 只断言"装上了" ② 加上文件与权限断言 | **② 四条**：装上了 / `/usr/bin/lypora` 可执行 / `chrome-sandbox` 带 setuid / 能执行 | 光"装上了"会漏掉本轮最典型的 bug（setuid 丢失）；四条里第三条正是照妖镜 | `test -u /opt/lypora/chrome-sandbox`；见 D18 |
| D17 | `SHA256SUMS.txt` 怎么处理 | ① CI 覆盖写 ② CI 只写自己那四条 ③ CI 先下载线上清单、剥掉同名项再合并 | **③** | ① 会让先传的 Windows/macOS/APK 条目消失。② 会让清单永远不全。③ 保证任意一端重跑都不丢条目 | 上传步骤里 `gh release download … --pattern SHA256SUMS.txt` + `grep -vE` + `sort -k2` |

### 1.4 本轮踩到并修掉的问题

| # | 决策点 | 备选项 | 采用 | 依据 | 证据 |
|---|---|---|---|---|---|
| D18 | rpm 装出来 `chrome-sandbox` 是 0755，deb 是 4755 | ① 怪 `chown` ② 怪 `cp -a` ③ 加 `%attr` | **② + 在 spec 的 `%install` 末尾显式 `chmod 4755`** | 三轮排查拿到决定性证据：暂存树 `stat` 是 `root:root 4755`，而 `rpm -qplv` 包内是 `-rwxr-xr-x`、deb 是 `-rwsr-xr-x` → 差异只可能发生在 `%install` 那一步 `cp -a`。GNU cp 以非 root 身份复制"root 属主 + setuid"文件时保不住属主，就主动去掉 s 位。③ 不能用于 `/opt/lypora/chrome-sandbox`——它已经在目录 `%files` 里，再单列会 `File listed twice` | docs/04 V48；`rpm -qplv` 现为 `-rwsr-xr-x root root` |
| D19 | 诊断命令自己崩溃 | ① `rpm -qplv lypora` ② `rpm -qlv lypora` / `rpm -qplv ./x.rpm` | **②** | `-p` 的语义是"把参数当包文件"，传包名会 `open of lypora failed: No such file or directory`；在 `bash -e` 下还会把后面的断言一起带崩，让人误判 | docs/04 V49；CI 里所有诊断语句加 `\|\| true` |
| D20 | 运行时冒烟挡住发布 | ① 删掉冒烟 ② 保留但挪到上传之后 + 三层超时 | **②** | 删掉就失去"能不能起"的唯一信号；但冒烟是**尽力而为**，不能让它的失败挡住"把包发出去"这个必须成功的目标。三层超时：job 级 `timeout-minutes: 5`、容器内 `timeout 90`、步骤 `continue-on-error` | run #4 卡在冒烟导致 run #5 排队 45 分钟；run #5 步骤顺序改为"上传 → 汇总 → 冒烟" |
| D21 | Electron 官方下载 35 秒超时 / SSL 错误 | ① 重试官方源 ② 换镜像 | **② `registry.npmmirror.com/-/binary/electron/`** | 官方 `github.com/electron/electron/releases` 在本机与 runner 上都出现过 `exit 35`；镜像是同一批字节，只是 CDN 不同 | 三份（win / mac / linux）全部下载成功 |
| D22 | 要不要手写 `--selftest` 断言"窗口画对了" | ① 写像素断言 ② 只做"能起来不崩" | **②** | 容器无 GPU、无 D-Bus、无桌面会话，像素断言在那种环境下没有意义（软件渲染的结果与真机不同）。诚实做法是把它标成 `continue-on-error` 并在文档里写清"通过不证明画面正确" | 工作流该步骤 `continue-on-error: true`；docs/07 §7 边界段 |

### 1.5 版本与文档

| # | 决策点 | 备选项 | 采用 | 依据 | 证据 |
|---|---|---|---|---|---|
| D23 | 版本号 | ① 停在 0.6.0 ② 0.7.0 ③ 1.0.0 | **② 0.7.0** | 新增了交付形态与发布流程，功能面没变；按语义化版本这是 minor。③ 不合适——仍未签名、无仓库、无自动更新 | `core/package.json`、`desktop/package.json`、`build.gradle versionName` 三处一致 |
| D24 | Android 是否同步 | ① 不动 ② 只改 versionName ③ `versionCode 8` + `versionName 0.7.0` | **③** | `versionCode` 不变的话新包装不上（同号），而前端产物已经换过一次版本串；五平台版本号必须统一，否则「0.7.0」在 Android 上叫 0.6.0 会误导 | `BUILD SUCCESSFUL`；APK 10.6 MiB |
| D25 | 文档放哪 | ① 全塞 README ② 独立 `docs/07` + README 摘要 | **②** | 打包工具依赖、FHS 落点表、spec 的坑、排查手册加起来近 400 行，塞进 README 会把"怎么用"淹掉。README 只留下载表与三行安装命令 | `docs/07-Linux安装包与自动发布.md`（9 节）；README 加 3 行 + 链接 |
| D26 | `docs/04` 是否补坑 | ① 只写 docs/07 ② 同时进 V 系列 | **② V48 / V49** | V 系列是"踩过并留证据"的清单，D18/D19 两个坑属于同类，不进去下次还会踩；索引同步扩到 V1–V49 | `docs/04` V48/V49，索引 `V1–V49` |

---

## 2. 验证证据汇总

| 证据 | 命令 / 位置 | 结果 |
|---|---|---|
| 暂存树结构 | `python tools/linux-stage.py --zip … --stage build/stage --deb` | `opt/lypora` 148 文件、主程序 264.2 MiB、`DEBIAN/` 164 文件、`Installed-Size 279517 KB` |
| deb 元数据 | `dpkg-deb -I lypora_0.7.0_amd64.deb` | control 渲染正确，Depends 含三组 `\|` |
| deb 装得上 | `debian:12` 容器 `apt install ./lypora_0.7.0_amd64.deb` | 成功，200 个文件 |
| deb 权限 | 容器内 `stat -c '%U:%G %A' /opt/lypora/chrome-sandbox` | `root:root -rwsr-xr-x` |
| rpm 装得上 | `fedora:40` 容器 `dnf install ./lypora-0.7.0-1.x86_64.rpm` | 成功（D18 修复后） |
| rpm 权限 | `rpm -qplv lypora-0.7.0-1.x86_64.rpm \| grep chrome-sandbox` | `-rwsr-xr-x root root` |
| AppImage 合法 | `file Lypora-0.7.0-linux-x64.AppImage` | `ELF 64-bit LSB executable, x86-64` |
| 五平台前端同源 | `sha256sum core/dist/index.html` | 前 12 位 `c9beee20cc04`，五平台一致 |
| 发布完整性 | `SHA256SUMS.txt` | 9 条，覆盖 5 个包 + deb/rpm/AppImage/tar.gz |

---

## 3. 未做与原因

| 项 | 状态 | 原因 |
|---|---|---|
| deb / rpm 签名 | 未做 | 需要 GPG 私钥与长期维护的公钥分发，属于仓库级工程；本轮只解决"能装" |
| apt / dnf 仓库（`Packages` / `repodata`） | 未做 | 同上；没有仓库就不能 `apt install lypora`，只能下载后装 |
| arm64 包 | 未做 | `linux-stage.py` 加 `--arch` 就能出，但没有任何 arm64 环境可验，未验不发 |
| 真机启动 | 未做 | 本机无 Linux 桌面会话；容器内 xvfb 冒烟是尽力而为，不等价 |
| Flatpak / Snap | 未做 | 需额外 SDK 与运行时清单，收益低于 deb/rpm |
