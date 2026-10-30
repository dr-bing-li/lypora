# Android 打包说明

两条路都能用，按场景选：

| 路线 | 产物 | 谁适合 |
|---|---|---|
| **A. APK（Capacitor）** | `release/Lypora-0.4.0-android.apk`（10.6 MiB） | 想在手机上像正常应用一样打开 `.md`、离线写作 |
| **B. PWA** | `core/dist` 静态托管 | 不想装包、手机浏览器直接用 |

工程位置：**Capacitor 工程在 `core/android/`**，配置是 `core/capacitor.config.json`，触屏界面在
`core/src/ui/mobile.ts`，原生文件与分享桥在 `core/src/io/native.ts`。本目录只放说明文档。

---

## A. APK

### 一条命令

```bash
node tools/build-android.mjs
# [android] JDK 21 → C:\...\jdk-21.0.2
# [android] SDK → C:\...\sdk
# [android] 构建核心（vite build）…
# [android] 已清空 assets/public（旧 hash 文件不清会残留上一版样式）
# [android] 资源比对通过（63 个文件，逐字节一致）
# [android] gradle assembleDebug …
# [android] 产物 release/Lypora-0.4.0-android.apk  10.6 MiB
# [android] sha256 9b6e4d72…
```

脚本做四件事，顺序不能换：

1. `npm run build`（core）
2. **删掉** `core/android/app/src/main/assets/public` 再 `cap copy` —— 这步是关键，见下面的坑
3. 逐文件比对 `core/dist/assets` 与 `assets/public/assets` 的 SHA256，不一致直接失败
4. `gradlew assembleDebug`，把 APK 改名复制到 `release/`

### 环境要求

| 需求 | 版本 | 说明 |
|---|---|---|
| JDK | **21** | Capacitor 7 的插件在 `build.gradle` 里声明 `toolchain languageVersion=21`；JDK 17 会报 `Cannot find a Java installation … languageVersion=21`，JDK 25 则连 Gradle 8.11 都起不来 |
| Android SDK | platform **35** + build-tools **35.0.0** + platform-tools | `sdkmanager` 安装；`minSdk` 29、`targetSdk` 35 |
| Gradle | 8.11.1（wrapper 自带） | `distributionUrl` 已指向国内镜像，见 `core/android/gradle/wrapper/gradle-wrapper.properties` |
| Node | ≥ 20 | 构建 Web 资源 |

第一次构建要下 Gradle 分发包与 AGP 依赖（约 5–10 分钟，看网络），之后增量构建约 35 秒。

### 生成的包是什么

| 项 | 值 |
|---|---|
| 包名 | `app.lypora.editor` |
| 版本 | `versionName 0.4.0` / `versionCode 4` |
| minSdk / targetSdk | **29（Android 10）/ 35** |
| 权限 | 仅 `INTERNET`（应用专属目录不需要存储权限） |
| 签名 | Android Debug（`CN=Android Debug`），可直接安装，**不能上架 Google Play** |
| 组成 | WebView 壳 + `assets/public` 里的完整前端（CM6 / KaTeX / 主题全在本机，离线可用） |
| 图标 | 自有素材，从 `core/public/icons/icon-512.png` 生成；Capacitor 默认图标已删除 |

### 图标与启动图

`npx cap add android` 生成的是 Capacitor 自带的默认图标，跟本项目无关，也不适合分发。现在整套图标是
脚本从 `core/public/icons/icon-512.png`（渐变圆角方块 + 三条白色圆角横条）重新生成的：

```bash
python tools/gen-android-assets.py     # 需要 Pillow
```

| 产物 | 说明 |
|---|---|
| `mipmap-{m,h,xh,xxh,xxxh}dpi/ic_launcher.png` | 传统方形图标，48/72/96/144/192px，保留源图圆角 |
| `mipmap-*/ic_launcher_round.png` | 圆形图标，渐变满铺后圆形裁切 |
| `mipmap-*/ic_launcher_foreground.png` | 自适应图标前景（108dp 网格，白条块宽 40dp，落在 72dp 安全区内，圆形遮罩下不切边） |
| `drawable/ic_launcher_background.xml` | 自适应图标背景：线性渐变 `#2F6FEB → #1748A8`，矢量绘制，任意密度精确 |
| `drawable{,-port-,-land-}*/splash.png` | 启动图：白底 + 居中图标（短边 26%） |

脚本不是硬编码坐标，而是从源图实测白条位置与渐变首尾色再重排，所以换图标只需重跑脚本。
实测数字：源图三条白条 `x133..379 y155..194 / x133..308 y237..276 / x133..379 y318..357`，
外框圆角半径 ≈ 0.199 × 边长。

### 安装到手机

```bash
adb install -r release/Lypora-0.4.0-android.apk
```

或者把 APK 传到手机（微信/网盘/数据线），点开安装，首次需要允许「安装未知来源应用」。

### 出 release 包（可选）

```bash
keytool -genkeypair -v -keystore lypora.jks -alias lypora -keyalg RSA -keysize 2048 -validity 10000
```

在 `core/android/app/build.gradle` 里补 `signingConfigs` 与 `buildTypes.release.signingConfig`，
然后 `node tools/build-android.mjs --release`，产物是 `release/Lypora-<ver>-android-unsigned.apk`。
脚本本身**不签名**：没配 `signingConfigs` 时就是未签名包，Android 装不上，需要再用
`apksigner sign --ks lypora.jks …` 补签，别把 unsigned 包直接发给别人。

### 三个踩过的坑

**1. `cap copy` 不会清理旧的 hash 文件名。**
改完前端重新构建后 `dist` 里的文件名会变（`index-CadlbVGF.js` → `index-DCmq_ejv.js`），但
`assets/public/assets/` 下的旧文件可能还在，而 `index.html` 已指向新名字。如果 copy 中途异常（文件被 Gradle
进程占用等），APK 里就会打包进**上一版的 CSS/JS**：本地预览完全正常，装到手机上是旧界面。
所以脚本强制先 `rm -rf assets/public` 再 copy，并做逐文件哈希比对。

**2. JDK 25 不行，JDK 17 也不行。** 必须 21。

**3. 第一次 `gradlew` 用 `--no-daemon` 构建完会留下 `build/` 与 Gradle 缓存，占 2–3 GB。**
想清掉：`core/android/gradlew clean`，或直接删 `core/android/build`、`core/android/app/build`。

---

## B. PWA（不装包）

```bash
cd core && npm run build
# 把 dist/ 整个目录传到任意 HTTPS 静态托管
```

手机 Chrome 打开链接 → 菜单 → **添加到主屏幕**，从桌面图标启动即全屏无地址栏，Service Worker 缓存可离线。

限制：浏览器沙盒拿不到任意目录，文件树降级为「最近文件 + 单文件打开」；导出走浏览器下载。

同一 WiFi 想先试一下：`npx vite preview --host 0.0.0.0 --port 4173`，手机访问局域网地址即可
（`http://192.168.x.x` 不是安全上下文，Service Worker 不注册，只能编辑不能离线）。

---

## 手机版与桌面版的差异

触屏版（`< 860px`）不是把桌面布局压窄，而是换了一套外壳：

| 桌面 | 手机 |
|---|---|
| 顶部 7 个菜单按钮 | 收进「菜单」底部面板（分区展示，每行 ≥48px） |
| 左侧栏常驻 | 抽屉 + 半透明遮罩，点遮罩收起 |
| 底栏只有格式化条 | 两行：格式化条 + 6 个主操作（打开/保存/大纲/导出/主题/菜单） |
| 表格列分隔线靠 hover 出现 | 常显、命中区 24px（`@media (pointer: coarse)`） |
| 导出 PDF（打印） | 置灰，提示先导出 HTML |
| 打开文件夹 / 导入主题 CSS | 置灰，Android WebView 上不可靠 |

外壳高度用 `visualViewport` 写入 `--app-h`，软键盘弹出时工具栏自动贴到键盘上沿，不会把正文顶掉。

文件落到哪：`/storage/emulated/0/Android/data/app.lypora.editor/files/Documents/Lypora/`。
卸载应用会一并删除；要交出去（存到「文件」、发微信、传网盘）走系统分享面板。
