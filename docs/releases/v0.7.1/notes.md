平板接了蓝牙键盘，中文输入法就再也调不出来了——只能打英文。这一版修的就是它。

根因不在输入法，在我们自己的一个配置开关上：`captureInput: true` 让 WebView 告诉 Android
「这个控件不接受文本编辑」，中文组词引擎于是从来不会启动。手机之所以看起来正常，是因为屏幕
软键盘会把候选词直接塞进输入通道，绕过了这个判断。

修完之后在 Android 平板上、接着蓝牙键盘实测通过：不碰软键盘，中文输入法能直接调起来，拼音连续
输入、中途选词、汉字上屏都正常。

A tablet with a Bluetooth keyboard attached could no longer bring up a Chinese IME — English only. That is
what this release fixes.

The cause was not the IME but one of our own config switches: `captureInput: true` made the WebView tell
Android "this control does not accept text editing", so the composition engine never started. Phones looked
fine only because the on-screen keyboard commits candidates straight into the input channel, bypassing that
check.

Verified on a real Android tablet with a Bluetooth keyboard: no on-screen keyboard involved, Chinese IME opens
on demand, pinyin composition and candidate selection work end to end.

- 全部代码、样式、图标、译文自研，MIT 协议；不含任何第三方商业产品的代码或素材。
- 独立实现，与 Typora 及其开发者无关联；本项目只是对它的一次**拙劣模仿**（致敬见文末）。

---

## 下载 / Downloads

| 文件 / File | 平台 / Platform | 格式 / Format | 大小 / Size | SHA256 |
|---|---|---|---|---|
| `Lypora-0.7.1-android.apk` | Android 10+（API 29+） | APK（debug 签名，直接安装）<br>APK, debug-signed, sideload | {{APK_SIZE}} | `{{APK_SHA}}` |
| `lypora_0.7.1_amd64.deb` | Debian 11+ / Ubuntu 20.04+ / 深度 / 麒麟 | 系统包（`apt install`）<br>System package | {{DEB_SIZE}} | `{{DEB_SHA}}` |
| `lypora-0.7.1-1.x86_64.rpm` | Fedora 32+ / RHEL 9+ / openSUSE | 系统包（`dnf install`）<br>System package | {{RPM_SIZE}} | `{{RPM_SHA}}` |
| `Lypora-0.7.1-linux-x64.AppImage` | 任意 x86-64 发行版 | 单文件，免安装<br>Single file, no install | {{AI_SIZE}} | `{{AI_SHA}}` |
| `Lypora-0.7.1-linux-x64.tar.gz` | 任意 x86-64 发行版（glibc ≥ 2.31） | tar.gz + `install.sh`（per-user） | {{TG_SIZE}} | `{{TG_SHA}}` |
| `Lypora-0.7.1-win-x64.zip` | Windows 10/11 x64 | 便携版 ZIP（解压即用）<br>Portable ZIP — unzip and run | {{WIN_SIZE}} | `{{WIN_SHA}}` |
| `Lypora-0.7.1-macos-arm64.tar.gz` | macOS 11+ / Apple Silicon | `.app` bundle（ad-hoc 签名）<br>`.app` bundle, ad-hoc signed | {{ARM_SIZE}} | `{{ARM_SHA}}` |
| `Lypora-0.7.1-macos-x64.tar.gz` | macOS 11+ / Intel | `.app` bundle（ad-hoc 签名）<br>`.app` bundle, ad-hoc signed | {{X64_SIZE}} | `{{X64_SHA}}` |
| `SHA256SUMS.txt` | 任意 / any | 全部产物的校验清单<br>Checksums for every artefact | 8 条 / 8 entries | — |

**校验方法 / How to verify**

```bash
sha256sum -c SHA256SUMS.txt          # Linux
shasum -a 256 -c SHA256SUMS.txt      # macOS
```
```bat
certutil -hashfile Lypora-0.7.1-android.apk SHA256
certutil -hashfile Lypora-0.7.1-win-x64.zip SHA256
```

清单只校验**同时存在**的文件（`sha256sum -c` 缺文件会报 FAILED），所以可以先只下自己需要的那一个，
再手工比对那一行。

---

# 中文说明

## 版本信息

| 项 | 值 |
|---|---|
| 版本号 | `0.7.1` |
| 发布标签 | `v0.7.1` |
| 版本性质 | 补丁版（Android 输入链路修复），无新功能、无新依赖 |
| 相对版本 | `v0.7.0` |
| Android | `versionName 0.7.1` / `versionCode 9`（v0.7.0 是 8，可直接覆盖升级） |

## 本版修了什么

### 现象

平板（或任何接外接键盘的 Android 设备）连接蓝牙键盘后，点进正文不会弹出软键盘，输入法只能打出英文，
打不出汉字。拔掉键盘、改用屏幕软键盘则一切正常。手机端复现不了——这也是这个问题一直没被发现的原因。

### 根因

`core/capacitor.config.json` 里显式写着 `android.captureInput: true`（Capacitor 默认是 `false`，这一行是
我们自己加的）。它会改变 `CapacitorWebView.onCreateInputConnection()` 的行为：

```java
if (captureInput) {
    if (capInputConnection == null) capInputConnection = new BaseInputConnection(this, false);
    return capInputConnection;          // outAttrs 一个字段都没写
}
return super.onCreateInputConnection(outAttrs);
```

返回的 `BaseInputConnection` 没有填 `EditorInfo`，`inputType` 停在 `0`（`TYPE_NULL`）。输入法拿到这个信号
会判定控件「不可编辑」，中文的拼音组词引擎根本不启动；`fullEditor=false` 又让预编辑（拼音下划线）无处显示。

手机之所以看不出来：屏幕软键盘弹出后，输入法把候选词用 `commitText` 直接提交进输入通道，不经过组词引擎也能
上屏。平板接了物理键盘，系统默认不再弹软键盘，只剩按键直通——于是「只能打英文」。

### 改动

- `captureInput` 改回 `false`，`onCreateInputConnection` 走 `super`，由 Chromium 填
  `TYPE_CLASS_TEXT | TYPE_TEXT_FLAG_MULTI_LINE`。
- 新增 `ImePlugin`：`restartInput()` + `showSoftInput()`，`SHOW_IMPLICIT` 不生效再退 `SHOW_FORCED`，
  用于对付「物理键盘在位时系统拒绝弹软键盘」的 ROM。
- 新增菜单项 **显示 → 虚拟键盘**（仅 Android 出现），是应用内唯一的自救入口；叫不出来时 toast 会指明
  去系统设置 → 系统 → 语言和输入法 → 实体键盘 → 显示虚拟键盘。
- `AndroidManifest.xml` 显式写 `windowSoftInputMode="adjustResize|stateUnspecified"`，与前端用
  `visualViewport` 算 `--app-h` 的做法保持一致。
- 七种界面语言补 `view.virtualKeyboard` / `toast.imeBlocked` / `toast.imeUnavailable` 三个键。

### 验证

| 项 | 结果 |
|---|---|
| Android 平板 + 蓝牙键盘，中文连续输入与选词 | **真机实测通过**（2026-11-09） |
| 包内 `captureInput` | `false` |
| 包内 `ImePlugin` | 在 `classes*.dex` |
| 包内 `windowSoftInputMode` | `0x10`（`SOFT_INPUT_ADJUST_RESIZE`） |
| `tsc --noEmit` / `i18n-check` / `verify.mjs` | 全部通过（15 步 UI 断言无失败） |

取证链与踩坑记录见 `docs/04-验证方案.md` 的 V50；手工清单 H25 已标记为「已在 Android 平板实测通过」。

### 谁应该升级

- **Android 用户，尤其是接外接键盘 / 用平板的人**：强烈建议升级，这是本版唯一的目的。
- 其它平台：功能上没有变化（新菜单项只在 Android 上出现），升不升都行；升级的好处只是版本号对齐。
- 手机用户升级后请留意 H26：`captureInput` 关掉后输入链路和以前不同（改走原生 InputConnection），
  这一项**本次没有单独复验**。

## 安装方式

安装方式与 v0.7.0 完全一致，逐格式命令见 [v0.7.0 的说明](https://github.com/dr-bing-li/lypora/releases/tag/v0.7.0)，
这里只放最短路径：

```bash
# Debian / Ubuntu / 深度 / 麒麟
sudo apt install ./lypora_0.7.1_amd64.deb

# Fedora / RHEL 9+ / openSUSE
sudo dnf install ./lypora-0.7.1-1.x86_64.rpm

# 任意发行版，免安装
chmod +x Lypora-0.7.1-linux-x64.AppImage && ./Lypora-0.7.1-linux-x64.AppImage
tar xzf Lypora-0.7.1-linux-x64.tar.gz && cd Lypora && ./install.sh
```

```bat
:: Windows：解压后保持 Lypora\ 目录完整，运行 Lypora\Lypora.exe
```

```bash
# Android：覆盖安装即可保留数据
adb install -r Lypora-0.7.1-android.apk
```

## 已知限制

- Android 手机（纯屏幕软键盘路径）在本次修复后**没有单独复验**，属回归重点。
- Linux 包在容器里装过、跑过，但**没有在真实桌面会话里启动过**。
- macOS 包只有静态结构证据，**从未在真机上启动过**。
- deb / rpm 未签名，也没有软件仓库（不支持 `apt install lypora`）。
- 没有 arm64 Linux 包、没有 `dmg`、没有 Flatpak / Snap。

---

# English

## Version information

| Item | Value |
|---|---|
| Version | `0.7.1` |
| Tag | `v0.7.1` |
| Kind | Patch release (Android input fix) — no new features, no new dependencies |
| Previous | `v0.7.0` |
| Android | `versionName 0.7.1` / `versionCode 9` (v0.7.0 was 8, so it installs as an upgrade) |

## What changed

### Symptom

With a Bluetooth keyboard connected to a tablet (or any Android device with a physical keyboard), tapping into
the editor does not raise the on-screen keyboard, and the IME can only produce English — no Chinese. Unplug the
keyboard and use the on-screen keyboard and everything works. Phones do not reproduce it, which is exactly why
it went unnoticed for so long.

### Root cause

`core/capacitor.config.json` set `android.captureInput: true` (Capacitor's default is `false`; we added this
line ourselves). It changes what `CapacitorWebView.onCreateInputConnection()` returns:

```java
if (captureInput) {
    if (capInputConnection == null) capInputConnection = new BaseInputConnection(this, false);
    return capInputConnection;          // outAttrs is never filled in
}
return super.onCreateInputConnection(outAttrs);
```

The returned `BaseInputConnection` never populates `EditorInfo`, so `inputType` stays at `0` (`TYPE_NULL`). An
IME reads that as "this control is not editable" and never starts the Chinese composition engine; `fullEditor =
false` additionally leaves the pre-edit text (the pinyin underline) with nowhere to render.

Why phones looked fine: once the on-screen keyboard is up, the IME commits candidates with `commitText` straight
into the input channel — that path does not need the composition engine. A tablet with a physical keyboard gets
no on-screen keyboard at all, only raw key events, so English was all that got through.

### The fix

- `captureInput` back to `false`; `onCreateInputConnection` goes through `super`, so Chromium fills in
  `TYPE_CLASS_TEXT | TYPE_TEXT_FLAG_MULTI_LINE`.
- New `ImePlugin`: `restartInput()` plus `showSoftInput()`, falling back from `SHOW_IMPLICIT` to `SHOW_FORCED`
  for ROMs that refuse to raise the keyboard while a physical keyboard is attached.
- New menu item **View → Virtual keyboard** (Android only) as the in-app escape hatch; if it fails, a toast
  points at Settings → System → Languages & input → Physical keyboard → Show virtual keyboard.
- `AndroidManifest.xml` now states `windowSoftInputMode="adjustResize|stateUnspecified"` explicitly, matching the
  front end's `visualViewport`-based `--app-h` calculation.
- All seven UI languages gained `view.virtualKeyboard` / `toast.imeBlocked` / `toast.imeUnavailable`.

### Verification

| Item | Result |
|---|---|
| Android tablet + Bluetooth keyboard, continuous composition and candidate selection | **Passed on real hardware** (2026-11-09) |
| `captureInput` inside the APK | `false` |
| `ImePlugin` inside the APK | present in `classes*.dex` |
| `windowSoftInputMode` inside the APK | `0x10` (`SOFT_INPUT_ADJUST_RESIZE`) |
| `tsc --noEmit` / `i18n-check` / `verify.mjs` | all pass (15 UI assertions, no failures) |

The full evidence chain is in `docs/04-验证方案.md` (entry V50); manual checklist item H25 is now marked as
verified on an Android tablet.

### Who should upgrade

- **Android users, especially anyone using a tablet or an external keyboard**: yes, this release exists for you.
- Every other platform: no functional change (the new menu item only appears on Android). Upgrading is harmless,
  it just keeps the version number in step.
- Phone users: please watch H26 after upgrading. With `captureInput` off, input now goes through the native
  InputConnection instead of the old path, and that specific case **was not re-tested** in this release.

## Installation

Identical to v0.7.0 — per-format commands are in the
[v0.7.0 notes](https://github.com/dr-bing-li/lypora/releases/tag/v0.7.0). Shortest paths:

```bash
# Debian / Ubuntu
sudo apt install ./lypora_0.7.1_amd64.deb
# Fedora / RHEL 9+ / openSUSE
sudo dnf install ./lypora-0.7.1-1.x86_64.rpm
# Any distribution, no install
chmod +x Lypora-0.7.1-linux-x64.AppImage && ./Lypora-0.7.1-linux-x64.AppImage
tar xzf Lypora-0.7.1-linux-x64.tar.gz && cd Lypora && ./install.sh
```

```bat
:: Windows: unzip, keep the Lypora\ folder intact, run Lypora\Lypora.exe
```

```bash
# Android: installs over the previous build, keeps your data
adb install -r Lypora-0.7.1-android.apk
```

## Known limitations

- The Android **phone** path (on-screen keyboard only) was **not re-tested** after the fix — it is the one
  regression risk in this release.
- The Linux packages were installed and executed in containers, but **never launched in a real desktop session**.
- The macOS builds have never been launched on real hardware — structural evidence only.
- The deb and rpm are unsigned and there is no repository, so `apt install lypora` is not a thing.
- No arm64 Linux package, no `.dmg`, no Flatpak/Snap.

---

## 平台矩阵 / Platform matrix

| 能力 / Capability | Windows x64 | macOS arm64 / x64 | Linux deb/rpm | Linux AppImage | Android 10+ |
|---|---|---|---|---|---|
| 实时预览 / 源代码模式 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 6 套内置主题 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 导入第三方主题 CSS | ✅ | ✅ | ✅ | ✅ | ⛔ 置灰 |
| 导出 HTML / PDF | ✅ | ✅ | ✅ | ✅ | ⛔ 置灰 |
| 打开文件夹 / 文件树 | ✅ | ✅ | ✅ | ✅ | ⛔ 置灰 |
| 7 种界面语言，运行时切换 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 数学公式（KaTeX）/ Mermaid | ✅ | ✅ | ✅ | ✅ | ✅ |
| 「打开方式」接收 `.md` | ✅ | ✅ | ✅ | ⛔ | ✅ |
| 外接键盘中文输入<br>Chinese IME with a physical keyboard | — | — | — | — | ✅ 平板实测 |
| 真机运行验证<br>Verified on real hardware | ✅ | ❌ 仅结构校验 | ⚠️ 仅容器安装 | ⚠️ 仅结构校验 | ⚠️ 仅输入法场景 |

## 许可证 / License

MIT — 见 [`LICENSE`](https://github.com/dr-bing-li/lypora/blob/main/LICENSE)。
第三方组件与许可证清单见 [`THIRD-PARTY-NOTICES.md`](https://github.com/dr-bing-li/lypora/blob/main/THIRD-PARTY-NOTICES.md)。
See `LICENSE` (MIT). Third-party components and their licences are listed in `THIRD-PARTY-NOTICES.md`.

## 致敬 / A tribute

Lypora 是对 [Typora](https://typora.io) 的一次**拙劣模仿**，出于学习目的重写，与 Typora 及其开发者
**没有任何关联**，也未获得其任何授权或背书。Typora 是 Typora 公司的商标。如果你需要一款成熟稳定的
Markdown 编辑器，请购买正版 Typora。

Lypora is a **deliberately amateurish reimplementation** of [Typora](https://typora.io), written for study.
It is **not affiliated with** Typora or its developers, and carries no endorsement or authorisation from them.
Typora is a trademark of its respective owner. If you want a mature, reliable Markdown editor, please buy Typora.
