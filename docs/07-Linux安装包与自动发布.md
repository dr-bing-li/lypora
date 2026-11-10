# Linux 安装包与自动发布

> 适用版本：v0.7.0 起 · 对应代码：`packaging/`、`tools/_linuxpkg.py`、`tools/linux-stage.py`、
> `.github/workflows/linux-installers.yml`
>
> 本文只讲**怎么装、怎么打、怎么验**。Linux 平台本身的规范（`.desktop`、图标、沙箱三层兜底）
> 见 [`docs/06-跨平台构建与平台规范.md`](06-跨平台构建与平台规范.md)。

---

## 1. 交付物

同一个应用，五种 Linux 落法。选哪个取决于你想怎么管它：

| 格式 | 文件 | 适用 | 安装方式 | 装到哪 |
|---|---|---|---|---|
| deb | `lypora_<ver>_amd64.deb` | Debian 11+ / Ubuntu 20.04+ / 深度 / 麒麟 | `sudo apt install ./lypora_<ver>_amd64.deb` | `/opt/lypora` + `/usr/bin/lypora` |
| rpm | `lypora-<ver>-1.x86_64.rpm` | Fedora 32+ / RHEL 9+ / openSUSE | `sudo dnf install ./lypora-<ver>-1.x86_64.rpm` | 同上 |
| AppImage | `Lypora-<ver>-linux-x64.AppImage` | 任何发行版，不想装 | `chmod +x` 后直接跑 | 不安装 |
| tar.gz | `Lypora-<ver>-linux-x64.tar.gz` | 老系统 / 想自己控制 | `./install.sh`（per-user，不需要 root） | `~/.local/share/lypora` |
| 源码 / PWA | 仓库 `core/` | 开发者、浏览器 | `npm ci && npm run dev` | — |

deb 与 rpm **走系统包管理器**：文件进 `/opt`、`/usr/bin`、`/usr/share`，装完在应用菜单里能搜到，
`apt remove` / `dnf remove` 删得干净。tar.gz 是"解压即用 + 自己装"，AppImage 是"单文件、不落系统目录"。

两者功能完全一致——同一份 `core/dist`、同一份 `desktop/` 主进程脚本，连 `resources/app` 的
文件数都一样。

---

## 2. 打包工具与依赖

deb / rpm / AppImage 的封包工具都是 **ELF 程序**，Windows 上跑不了（本机也没有 WSL / Docker）。
所以职责是拆开的：

| 环节 | 在哪跑 | 工具 | 版本要求 |
|---|---|---|---|
| 算文件树（哪些文件、什么权限、放哪） | **任何平台**，含 Windows | Python 3.9+ + Pillow（缩图标） | `pip install pillow` |
| 封 deb | Linux | `dpkg-deb`（`dpkg-dev` 包） | ≥ 1.19（要 `--root-owner-group`） |
| 封 rpm | Linux | `rpmbuild`（`rpm` 包） | 4.14+ |
| 封 AppImage | Linux | `appimagetool`（官方 AppImage） | continuous 版 |
| 前端产物 | 任何平台 | Node 20+ / vite | 见 `core/package.json` |
| 安装验证 | Linux 容器 | `docker` + `debian:12` / `fedora:40` | — |

Ubuntu / Debian 上装齐：

```bash
sudo apt-get install -y rpm python3-pil xz-utils file docker.io
```

Fedora 上：

```bash
sudo dnf install -y rpm-build python3-pillow xz file docker
```

**Windows 上能做什么、不能做什么**：`python tools/linux-stage.py` 能完整跑通并产出目录树
（这是 `docs/06` 里"交叉构建"的老路子），但 `dpkg-deb` / `rpmbuild` / `appimagetool` 一步都跑不了。
所以 Windows 上的正确姿势是：**算树、看结构**，封包交给 CI。`os.chmod` 在 Windows 上也只认只读位，
`chrome-sandbox` 的 4755 在那里是拿不到的——这棵树只用于结构核对，不能直接当发布物。

---

## 3. 目录与配置文件结构

```
packaging/
  debian/
    control.in        # dpkg 元数据模板，@VERSION@ / @INSTALLED_SIZE@ 占位
    postinst          # 装完刷新桌面数据库与图标缓存
    prerm             # 卸载/升级前摘菜单项
    postrm            # 卸干净后清缓存
  lypora.spec         # rpmbuild 用；%install 直接吃暂存树
tools/
  _linuxpkg.py        # 共用件：FHS 布局、.desktop、启动器、AppStream、DEBIAN/ 生成
  linux-stage.py      # CLI：--zip 摊树 / --deb 写控制目录 / --appdir 出 AppDir
.github/workflows/
  linux-installers.yml  # tag 触发 → 构建 → 容器安装验证 → 上传 Release
```

三者的关系是**一棵树、两种封装**：

```
electron-v33.4.11-linux-x64.zip ─┐
core/dist（vite 产物）──────────┼→ tools/linux-stage.py → build/stage（FHS 树）
desktop/{main,preload}.js ──────┘                              │
                                                               ├→ dpkg-deb --build   → *.deb
                                                               ├→ rpmbuild -bb       → *.rpm
                                                               └→ tools/linux-stage.py --appdir → appimagetool → *.AppImage
```

树只算一次，三种格式吃的是**同一份字节**。这条是有意的：如果各自去 zip 里取文件，
迟早出现"deb 里少了一个 locales、rpm 里多了个 .so"这种只在用户机器上炸的问题。

### `control.in` 里几个非显然的点

- **依赖写成 `a | b`**：Ubuntu 24.04 做 t64 迁移后 `libasound2` 变成 `libasound2t64`，
  只写老名字的 deb 在 24.04 上会报缺依赖、装不上。写成 `libasound2 | libasound2t64`
  两边都能满足（dpkg 的 Depends 支持 `|`）。
- **`Installed-Size` 必须真实**：由 `linux-stage.py` 遍历暂存树算出来，不是手填。
- **`Description` 的长描述每行缩进一个空格，空行写 ` .`**，这是 Debian 控制文件的硬格式。

### `lypora.spec` 里几个非显然的点

- `%global __os_install_post %{nil}` + `%global debug_package %{nil}`：关掉 brp-strip 与
  debuginfo。Electron 的二进制本来就已经 strip 过，再处理一遍纯属浪费几分钟。
- `%files` 里 `/opt/lypora` 是**整个目录**，所以不能在下面再单独列
  `/opt/lypora/chrome-sandbox`——那会变成 "File listed twice"。
- `%license` / `%doc` 用**目录形式**：漏列任何一个文件，rpmbuild 就报
  "Installed (but unpackaged) file(s) found" 并直接失败。列目录一次收干净。
- `%install` 除了 `cp -a` 还要 `rm -rf %{buildroot}/DEBIAN`——那个目录是给 `dpkg-deb` 用的。

---

## 4. 落点与权限

| 路径 | 内容 | 权限 | 谁要求 |
|---|---|---|---|
| `/opt/lypora/` | 主程序、`resources/app`、locales、`.so` | 目录 755，`.so`/`.pak` 644 | FHS：附加软件包放 `/opt/<pkg>` |
| `/opt/lypora/lypora` | ELF 主程序（原名 `electron`） | 755 | — |
| `/opt/lypora/chrome-sandbox` | Chromium 沙箱助手 | **4755 root:root** | 不然 Electron 拒绝启动 |
| `/opt/lypora/lypora.sh` | 启动包装（沙箱不合格才降级 `--no-sandbox`） | 755 | — |
| `/usr/bin/lypora` | 命令行入口（3 行 shell，转发给 `lypora.sh`） | 755 | 用户敲 `lypora` |
| `/usr/share/applications/lypora.desktop` | 菜单项，`Exec=/opt/lypora/lypora.sh %F` | 644 | 桌面环境 |
| `/usr/share/icons/hicolor/<n>x<n>/apps/lypora.png` | 16/24/32/48/64/128/256/512 八档 | 644 | 图标主题 |
| `/usr/share/metainfo/app.lypora.editor.metainfo.xml` | AppStream 元数据 | 644 | 软件中心取图标与简介 |
| `/usr/share/licenses/lypora/` | `LICENSE`、`LICENSES.chromium.html`、`LICENSE.lypora` | 644 | rpm 的 `%license` 要求这个路径 |
| `/usr/share/doc/lypora/` | `copyright`（DEP-5 格式）、`README.md` | 644 | Debian 政策要求 |

`/usr/bin/lypora` 刻意用 **shell 脚本**而不是符号链接：符号链接在 Windows 上建不了，
用了它这条链路就只能在 Linux 上跑，树也就没法在 Windows 上先算一遍核对。

---

## 5. 构建流程

### 5.1 本地（Windows 或 Linux 都行，但封包需要 Linux）

```bash
# 1) 前端
cd core && npm ci && npm run build && cd ..

# 2) 拿 Electron 预编译包（官方分发包，与宿主无关）
curl -LO https://github.com/electron/electron/releases/download/v33.4.11/electron-v33.4.11-linux-x64.zip

# 3) 摊树 + 写 DEBIAN/（这一步不需要 Linux 工具链）
python tools/linux-stage.py --zip electron-v33.4.11-linux-x64.zip --stage build/stage --deb

# 4) 封包（以下三行必须 Linux）
#    deb：--root-owner-group 让归档里记 root:root，不需要事先 chown
dpkg-deb --build --root-owner-group build/stage release/lypora_0.8.1_amd64.deb

#    rpm：%install 里 cp -a 会抹掉 setuid（见 §9），spec 末尾自己 chmod，这里不用预先处理
mkdir -p build/rpm/{BUILD,BUILDROOT,RPMS,SOURCES,SPECS,SRPMS}
rpmbuild -bb --define "_version 0.8.1" --define "_stage_root $PWD/build/stage" \
         --define "_topdir $PWD/build/rpm" packaging/lypora.spec

#    AppImage：AppDir 里的 appimagetool 需要 ELF 环境
python tools/linux-stage.py --stage build/stage --appdir build/AppDir
ARCH=x86_64 ./appimagetool --appimage-extract-and-run --no-appstream build/AppDir \
     release/Lypora-0.8.1-linux-x64.AppImage
```

> 若你坚持用 `sudo chown -R root:root build/stage` 让树"看起来像安装了"，**必须在 chown 之后重新
> `sudo chmod 4755 build/stage/opt/lypora/chrome-sandbox`**——`chown` 按 POSIX 规定会清掉 setuid。
> 但本项目不需要这一步：deb 走 `--root-owner-group`，rpm 走 spec 自己的 chmod。

### 5.2 CI（正常路径）

打 tag 就够：

```bash
git tag -a v0.8.1 -m "…" && git push origin v0.8.1
```

`linux-installers.yml` 会在 `ubuntu-latest` 上依次做：

1. 检出（`ref` = 触发它的 tag）
2. `npm ci` + `npm run build`
3. 下 Electron 预编译包
4. `linux-stage.py --deb` 摊树
5. `pack-linux.py` 出 tar.gz
6. `dpkg-deb` 出 deb
7. `rpmbuild` 出 rpm
8. `appimagetool` 出 AppImage
9. 结构检查（`dpkg-deb -I/-c`、`rpm -qip/-qplv`、`file`）
10. `debian:12` 与 `fedora:40` 容器里**真装一遍**
11. 生成/合并 `SHA256SUMS.txt` 并 `gh release upload --clobber`
12. xvfb 下跑一次 `--selftest`（**放在最后**，尽力而为，失败不阻断）

第 11 步排在第 12 步之前是有意的：冒烟只在容器里验"能不能起"，它失败或卡住不应该挡住"把包发出去"这个
必须成功的目标。该步骤同时有三层兜底（job 级 `timeout-minutes: 5`、容器内 `timeout 90`、
`continue-on-error: true`）——第一版把冒烟放在上传之前，结果 Electron 起得来却不退出，把整个 job 拖到
超时，包一个都没传。

手动补跑：`Actions → Linux installers → Run workflow`，输入一个**已存在**的 tag。
（注意：fine-grained PAT 需要 `Actions: write` 才能用 API 触发，只有 `Contents: write` 会返回 403。）

### 5.3 发布顺序为什么这么排

CI 与本地 `publish-release.mjs` 都会往同一个 Release 传东西，谁先谁后都行，因为：

- `publish-release.mjs` 发现 Release 已存在会 PATCH，同名附件先删再传；
- CI 的 `gh release upload --clobber` 同理；
- `SHA256SUMS.txt` 在 CI 侧是**合并**（保留线上已有的其他平台条目），不会被冲掉。

唯一要注意的是**最后一步上传的 `SHA256SUMS.txt` 要覆盖全部产物**。本轮的做法是：
CI 先出 Linux 四件，本地再出 Windows / macOS×2 / APK，最后由 `publish-release.mjs`
用完整的 8 条校验记录收尾（deb / rpm / AppImage / linux tar.gz / win zip / macos ×2 / apk）。

发布说明（`docs/releases/v0.8.0/notes.md`）里 Linux 四件的体积与哈希是**回填**的，不是手抄的：
先写 `{{DEB_SIZE}}` / `{{DEB_SHA}}` 这类占位符，等 CI 把包传上去之后跑

```bash
python tools/backfill-v071.py      # 读 Release API，回填 notes.md + README 双语表，并落一份 SHA256SUMS.txt
```

手抄 64 位十六进制是必错的（V47），而且 CI 每次重打都会变。

---

## 6. 各发行格式的安装与验证

### 6.1 deb

```bash
sudo apt install ./lypora_0.8.1_amd64.deb      # 推荐：apt 会顺带把依赖装上
# 或 sudo dpkg -i ./lypora_0.8.1_amd64.deb && sudo apt -f install
```

验证：

```bash
dpkg -s lypora | head -6                       # Status: install ok installed
dpkg -L lypora | wc -l                         # 文件数（本轮实测 200）
stat -c '%U:%G %A %n' /opt/lypora/chrome-sandbox   # root:root -rwsr-xr-x
which lypora && lypora --help                  # /usr/bin/lypora
```

卸载：`sudo apt remove lypora`。`postrm` 会清掉菜单与图标缓存。

### 6.2 rpm

```bash
sudo dnf install ./lypora-0.8.1-1.x86_64.rpm   # Fedora / RHEL 9+
sudo zypper install ./lypora-0.8.1-1.x86_64.rpm # openSUSE
```

验证：

```bash
rpm -q lypora                                  # lypora-0.8.1-1.x86_64
rpm -qplv lypora | grep -E 'chrome-sandbox|/usr/bin/lypora'
#   -rwsr-xr-x  root root  /opt/lypora/chrome-sandbox
#   -rwxr-xr-x  root root  /usr/bin/lypora
rpm -V lypora                                  # 无输出 = 文件完好
```

卸载：`sudo dnf remove lypora`。

### 6.3 AppImage

```bash
chmod +x Lypora-0.8.1-linux-x64.AppImage
./Lypora-0.8.1-linux-x64.AppImage
```

验证：`./Lypora-*.AppImage --appimage-extract > /dev/null && ls squashfs-root/usr/lib/lypora | head`
能解出目录树就说明镜像完整。AppImage 没有 root，**沙箱必然降级**（`AppRun` 直接带 `--no-sandbox`），
这是 Electron 打 AppImage 的固有代价，不是配置错误。

### 6.4 tar.gz

```bash
tar xzf Lypora-0.8.1-linux-x64.tar.gz && cd Lypora && ./lypora.sh
./install.sh        # 可选：装进 ~/.local，不需要 root
```

---

## 7. CI 到底验了什么

| 断言 | 手段 | 失败意味着 |
|---|---|---|
| deb 元数据完整 | `dpkg-deb -I` 打印 control | control.in 渲染错了 |
| deb 文件清单与权限 | `dpkg-deb -c` | 树算错了，或封包丢了 s 位 |
| rpm 头可解析 | `rpm -qip` | spec 头字段不全 |
| rpm 文件权限 | `rpm -qplv` | `%files` 或 chmod 有问题 |
| **deb 能装** | `debian:12` 容器 `apt install ./x.deb` | 依赖声明不对 / 归档损坏 |
| **rpm 能装** | `fedora:40` 容器 `dnf install ./x.rpm` | 同上 |
| **装完能执行** | 容器里 `test -x /usr/bin/lypora` | 权限位错 |
| **沙箱位还在** | 容器里 `test -u /opt/lypora/chrome-sandbox` | setuid 丢了（见 §9） |
| AppImage 是合法 ELF | `file` | appimagetool 没跑完 |
| 真能启动（尽力） | `xvfb-run … --selftest` | 只说明容器里跑不起来，不代表包坏 |

**边界**：容器里没有 GPU、没有 D-Bus、没有真实桌面会话，所以"能装、能执行、权限对"是硬断言，
"能弹出窗口画对像素"不是。真机观感仍要人工看一眼。

**v0.8.2 的人工确认**：用户在 **Linux Mint** 上解开 `Lypora-0.8.2-linux-x64.tar.gz` 直跑，窗口、菜单、
编辑保存、图片与图标均正常（`docs/04` §3.9 / H31）。注意这条只覆盖 **tar.gz 解压运行**这一种形态——
`deb` / `rpm` / `AppImage` 仍只有上面那张表的容器证据，装完能否正常打开仍需在真机上再验一次。

---

## 8. 已知限制

| 项 | 状态 | 说明 |
|---|---|---|
| 签名 | **未做** | deb / rpm 都没签名。装了 `rpm-gpg` 或 `apt` 强制校验的环境会警告 |
| 软件仓库 | **未做** | 没有 `Packages` / `repodata`，不能 `apt install lypora` 直接装；要下 deb 再装 |
| 自动更新 | **未做** | 应用内没有 updater |
| arm64 | **未做** | 只有 x86_64 包；Electron 有 linux-arm64 分发包，加一份 `--arch` 就能出，但没验过 |
| Flatpak / Snap | **未做** | 都要额外 SDK 与打包清单，收益不如 deb/rpm 直接 |
| AppImage 沙箱 | 降级 | 无 root，只能 `--no-sandbox` |

---

## 9. 排查手册

**`test -u` 失败 / chrome-sandbox 权限是 755**
先看**暂存树**里那个位还在不在：`stat -c '%U:%G %A' build/stage/opt/lypora/chrome-sandbox`。

- 树里就是 755 → 上游（`ln`/`cp`/`chown`）已经把它弄丢了。`chown` 确实会按 POSIX 规定清掉 setuid，
  但本项目的真凶不是它：`rpmbuild` 的 `%install` 里那句 `cp -a` 才是。GNU `cp` 以**非 root 身份**
  复制"root 属主 + setuid"的文件时保不住属主，就不肯造 setuid 文件，会主动去掉 s 位。
- 树里是 4755、**包内**是 0755 → 问题在封装环节。用 `dpkg-deb -c` / `rpm -qplv ./x.rpm` 分别看归档里
  记录的权限（注意 `rpm -qplv lypora` 是错的，`-p` 要求参数是包文件）。

对症下药只有一条：`lypora.spec` 的 `%install` 末尾显式 `chmod 4755 %{buildroot}/opt/lypora/chrome-sandbox`。
不要试图用 `%attr(4755,root,root)` 单列这个文件——它已经包含在 `%files` 的 `/opt/lypora` 目录里，
再列一次会得到 `File listed twice`。

排查记录见 `docs/04` V48（`cp -a` 抹 s 位）与 V49（`rpm -qplv` 的 `-p` 语义）。

**`dpkg-deb: error: control directory has bad permissions`**
`DEBIAN/` 必须是 755，且里面的 `control` 是 644。`linux-stage.py` 已经设好，手动改过就会踩。

**`rpmbuild: Installed (but unpackaged) file(s) found`**
`%files` 漏了文件。加路径，或把整个目录列进去（本项目就是这么做的）。

**`dnf install` 报一堆 not found**
大多是自动生成的 soname 依赖在目标发行版里没有对应包。用
`rpm -qpR lypora-*.rpm` 看具体缺哪个，再决定补 `Requires:` 还是拆出可选依赖。

**AppImage 报 `AppImages require FUSE`**
装 `libfuse2`，或临时用 `APPIMAGE_EXTRACT_AND_RUN=1 ./Lypora-*.AppImage`。
