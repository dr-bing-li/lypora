# v0.9.0 决策记录

日期：2026-11-10 · 前置版本：v0.8.2

## 0. 这次发布做了什么

把 `Lypora-NEXT` 分支的「美化输出」板块**整体搬进主仓库**，升次版本位到 `0.9.0`。

来源提交（`Lypora-NEXT` 仓库，公共基线 `8583d5a`，与本仓库当时的 `HEAD` 一致）：

| 提交 | 内容 |
|---|---|
| `ed55355` | `feat(lypora-next): 独立项目 + 美化输出板块（12 套模板引擎）` |
| `64d16fa` | `docs: Lypora-NEXT 项目结构、模板机制与离线条件说明` |

合并方式：`git fetch next main` → `git cherry-pick -n` 两个提交 → 逐处还原身份标识 → 一次性提交。
用 `-n` 而不是直接 cherry-pick，是为了不让「叫 Lypora-NEXT 的中间态」单独占一个提交。

## 1. 为什么是"合并"而不是"照抄功能重写一遍"

`Lypora-NEXT` 不是从零写的另一个产品，它是本仓库 `8583d5a` 分出去的实验分支：同一份 TypeScript 核心、
同一套验收脚本、同一份打包工具链。代码是这条线上的增量，不是外部实现。

所以：
- **不重写**。重写等于把 `beautify-check.mjs` 里那 12 套模板的像素结果、`compile.ts` 里「只能改变量」的
  约束、`io.ts` 里那套语法形态白名单再推一遍，风险比合并大。
- **保留出处**。两个提交号写进发布说明与本文，一年后能查清这堆代码是谁、在什么前提下写的。
- **不保留身份**。分支叫 NEXT 是分支管理的事，产品只叫 Lypora。

## 2. 关键取舍

### 2.1 身份标识全部还原为 Lypora（这是本次最琐碎、也最容易漏的一步）

cherry-pick 报**零冲突**。零冲突只说明代码能拼在一起，不说明拼对了：NEXT 把「另一个名字」写进了
25 处，`tsc` 不会红、功能不会坏，但装出来的应用会自称 Lypora-NEXT、设置会写到另一个前缀下。

| 类别 | 位置 | 处理 |
|---|---|---|
| 应用标识 | `capacitor.config.json` 的 `appId` / `appName`、`build.gradle` 的 `applicationId`、`strings.xml` 的 `app_name` / `title_activity_main` | 全部还原 `app.lypora.editor` / `Lypora` |
| 窗口与页面 | `core/index.html` 的 `<title>`、`desktop/main.js` 的窗口标题与关窗文案 | 还原 `Lypora` |
| 包与产物 | 两个 `package.json` 的 `name` / `productName` / 描述 / 仓库地址，`pack-win.mjs` 的产物名与 `release/` 目录、`build-android.mjs` 的 APK 名 | 还原 `lypora-core` / `lypora-desktop` / `Lypora` / `Lypora-<ver>-*` |
| 源码里的品牌串 | `card-themes.ts` 的 `BRAND`、`card-layout.ts` 的兜底、`builtin.ts` 的 `metrics.brand`、`io.ts` 的导出元信息、`beautify-panel.ts` 的默认文件名 | 还原 `Lypora` / `lypora-card` |
| 词表 | 7 份 `about` / `aboutText` | 还原「关于 Lypora」 |

方法：合并后先按四种形态全量 `grep`（`Lypora-NEXT` / `lypora-next` / `app.lypora.next` / `lypora:next:`），
再逐处判定归属。这件事不能靠人眼扫——30 个文件里散着 25 处，漏一处就是一个错的应用名。
这条已作为 **V55** 写进 `docs/04`。

`pack-win.mjs` 的改动**全部是重命名**，没有一处功能改动，所以直接 `git checkout HEAD -- tools/pack-win.mjs`
整份退回，比逐行改更不容易错。

### 2.2 localStorage 前缀：`lypora:next:*` → `lypora:beautify:*`

NEXT 原型里的三个键是 `lypora:next:template` / `:userTemplates` / `:beautify-layout`。

**改名而不是照抄**，理由：
1. 产品里不该出现另一个项目的名字——用户打开 devtools 看到 `lypora:next:` 会以为是遗留物；
2. `lypora:next:*` 会长期误导维护者去 `Lypora-NEXT` 仓库找对应代码；
3. **改名零成本**：这三个键在 v0.8.2 的任何产物里都不存在，没有用户的旧数据会被落在旧前缀下。

反过来，如果这三个键已经在某个已发布版本里用过，就必须保留旧名并写迁移——所以这个决定现在做，比以后做便宜。

### 2.3 菜单入口叫「美化输出」，id 叫 `file-beautify`

旧入口是「导出卡片」（`file-export-card`）。改名理由：这一版除了出图，还能存模板、调参数、导模板，
"导出卡片"描述不了它；而"美化输出"是原功能的上位概念。位置、快捷键、产物种类都没变，
用户只是看到一个新名字（已写进发布说明的迁移表）。

菜单项总数仍是 9 个 → `i18n-check.mjs` 的 `MENU_IDS` 不需要改，这也是一处**故意保持不动**的地方：
能不动验收脚本，说明改动确实落在"同一位置的一等公民"里。

### 2.4 版本号：0.8.2 → 0.9.0

仓库的既有规矩（`docs/05`、历次 `release(...)` 提交）是「改 bug 升补丁位，加功能升次版本位」：

- 新增一个功能板块 + 9 个源文件 + 7 语言各约 80 条词条；
- 旧入口被上位概念取代（不是行为修正）；
- 用户可见的默认界面变了（8 个风格按钮 → 12 套模板画廊 + 参数面板）。

按 0.7.0（图片策略）、0.8.0（路径解析）的先例，功能级新增升次版本位。`0.8.2 → 0.9.0`。

Android 侧 `versionCode 12 → 13`（同一 `applicationId`、同一签名，可覆盖安装）。

### 2.5 PWA 缓存名 `lypora-v2` → `lypora-v3`

`sw.js` 是 cache-first。前端产物变了但缓存名不变，老用户会一直命中旧 JS——**这是换资源时的固定动作**，
不是可选优化。`activate` 里会删除除当前 CACHE 之外的所有缓存，所以旧缓存不会堆积。

### 2.6 没有动的东西（有意为之）

| 项 | 为什么不动 |
|---|---|
| `verify.mjs` / `i18n-check.mjs` / `export-check.mjs` / `image-check.mjs` | 一件不改全部通过，才说明"继承成立"。这也是 NEXT 文档自己给的判定标准 |
| `desktop/main.js` 的 `saveBinary` IPC | v0.8.2 的卡片导出已经加了，本次只换面板，不需要新的原生能力 |
| `toolchain` / `packaging/` / CI 工作流 | 产物命名规则不变，版本号是变量 |
| 依赖树 | 模板引擎零依赖，PDF / ZIP 写入器自研 |

### 2.7 文档：把 08 改写成"合并后的状态"，09 作为引擎深挖

NEXT 的 `docs/09-Lypora-NEXT-项目结构与美化输出.md` 有一半篇幅在讲"我们是独立项目、应用 id 不同、
设置前缀不同"——这些内容在本仓库里**全部是错的**。所以不是复制，是改写：

- `docs/08-卡片导出与输出风格.md` → `docs/08-美化输出与卡片模板.md`：保留 md2card 调研与第一版的踩坑，
  重写模块表、功能对应表、验收数字与未完成项；
- `docs/09-Lypora-NEXT-项目结构与美化输出.md` → `docs/09-美化输出与模板引擎.md`：删掉"独立项目"一节，
  换成"与 v0.8.2 的差异 / 升级须知"，其余机制（37 字段契约、编译器的三条硬约束、校验白名单、
  离线七条件）原样保留——这些是 NEXT 真正的产出，不该因为换了个仓库就丢掉。

## 3. 合并过程中发现并修掉的问题

| 问题 | 处置 |
|---|---|
| `docs/09` 里写着 `app.lypora.next`、`lypora_0.9.0-android.apk` 等 NEXT 专属事实 | 整篇改写，不保留 |
| NEXT 的 `strings.xml` 里 `package_name` 还是 `app.lypora.editor`（与它自己的 `appId` 不一致） | 本仓库不存在这个矛盾（都还原成 `app.lypora.editor`），记录在案不必修 |
| NEXT 的 README 只改了顶部宣言与一行功能表，其余 1200 行是 CRLF/LF 抖动 | **不整份取用**：只手工改本仓库的那一行 + 两处验收命令 |
| `beautify-check.mjs` 的样本文档标题写着 `Lypora-NEXT 美化输出验收` | 改成 `Lypora`（测试数据不该带别的产品名） |

## 4. 合并后的验证（同一台机器，2026-11-10）

```
tsc --noEmit            通过
npm run build           4.1s，产出 index-*.js 1.39 MB / css 61.4 KB
beautify-check          pass，12 模板 / 字号 15→21 ⇒ 4→5 页 / 模板进出 / 外部请求 0
verify                  15 步无 error
export-check            pass（HTML / 打印 PDF / iframe）
i18n-check              pass（7 语言）
pack-win --zip          release/Lypora-0.9.0-win-x64.zip  111.8 MiB / 147 文件
--selftest              ok:true / 0.9.0 / 9 菜单 / bridgeApi 含 saveBinary / consoleErrors []
build-android           release/Lypora-0.9.0-android.apk  13.6 MiB
aapt2 dump badging      app.lypora.editor / versionCode 13 / versionName 0.9.0 / minSdk 29
APK 内 assets/public    含 lypora:beautify 与 .lyt.json 相关代码
```

## 5. 遗留

- macOS / Linux 四件产物由 CI 在打 tag 时构建，本机未重封（前端产物通用，`docs/04` §6 已如实标注）。
- 桌面「另存为」对话框、Android 真机导出、Intel mac 与 deb/rpm/AppImage 的运行，仍属未验证项（H32）。
- 发布正文里 macOS / Linux 四件的体积与 SHA256 要在 `backfill` 阶段回填；本地只填了 Windows 与 APK 两件。
