# Android 打包说明

本目录是 Capacitor 工程配置模板。**核心代码零改动**即可打包成 APK —— 这是"一套核心、多端外壳"的直接体现。

## 两条路，按需选

### 路线 A：PWA（零安装，立即可用）★ 推荐先用这条

#### A-1 同一 WiFi 内先试用（1 分钟，无需部署）

```bash
cd core
npx vite build
npx vite preview --host 0.0.0.0 --port 4173
# 记下输出里的局域网地址，例如 http://192.168.1.23:4173
```

手机连同一个 WiFi，Chrome 打开该地址即可编辑。
**注意**：`http://192.168.x.x` 不是安全上下文，**Service Worker 不会注册**，因此这一条只能"浏览+编辑"，不能离线、不能装到主屏。要装主屏必须走 A-2。

#### A-2 部署到 HTTPS 后安装到主屏

把 `core/dist` 整个目录传到任意 HTTPS 静态托管（对象存储 / 静态站点 / 自有域名均可），然后：

1. 手机 Chrome 打开链接
2. 菜单 → **添加到主屏幕**
3. 从桌面图标启动 → 全屏、无地址栏、离线可用（Service Worker 缓存）

能力：编辑、渲染、打开/保存单个文件（File System Access API）、导出 HTML/PDF、主题、专注/打字机模式。
限制：**无法访问任意目录树**（浏览器沙盒），文件树降级为"最近文件 + 单文件打开"。

### 路线 B：Capacitor APK（可上架 / 可访问目录树）

#### 环境要求（本机当前缺第 2、3 项）

| 需求 | 状态 |
|---|---|
| Node 18+ | ✅ 已有 22.22.2 |
| JDK 17 或 21 | ⚠️ 本机是 **JDK 25**，AGP 8.x 可能报错，建议装 JDK 21 |
| Android SDK（`ANDROID_HOME` + build-tools + platform-tools） | ❌ **未安装** |
| Gradle | 由 wrapper 自带，无需单独装 |

#### 步骤

```bash
# 1. 先构建核心
cd ../core && npm install && npx vite build

# 2. 在 core/ 里装 Capacitor
cd ../core
npm i @capacitor/core
npm i -D @capacitor/cli @capacitor/android

# 3. 用本目录的配置初始化（webDir 已指向 ../core/dist，无需复制产物）
cp ../android/capacitor.config.json ./capacitor.config.json
npx cap add android
npx cap sync android

# 4. 设置 SDK 路径（Windows 示例）
export ANDROID_HOME="$HOME/AppData/Local/Android/Sdk"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"

# 5. 出包
cd android
./gradlew assembleDebug          # 产物：app/build/outputs/apk/debug/app-debug.apk
# 正式包（需签名配置）：
./gradlew assembleRelease
```

#### 每次改完核心代码

```bash
cd core && npx vite build && cd ../core && npx cap sync android
```

#### 可选增强：原生文件访问

APK 里浏览器沙盒限制依然存在（WebView 一样受限）。若要让文件树在 Android 上也能用完整目录，装官方插件：

```bash
npm i @capacitor/filesystem @capacitor/share
npx cap sync android
```

然后在 `core/src/io/files.ts` 的 `openWorkspace()` 里增加第 5 条分支：

```ts
const cap = (window as any).Capacitor
if (cap?.Plugins?.Filesystem) {
  // Filesystem.readdir({ path: 'Documents', directory: 'DOCUMENTS' })
  // → 映射成 WorkspaceEntry[]
}
```

接口签名不用变 —— 这正是 `03-架构与技术规格.md` §4.3 把 IO 抽成适配层的目的。

#### APK 图标与启动图

```bash
npm i -D @capacitor/assets
mkdir resources && cp ../core/public/icons/icon-512.png resources/icon.png
npx capacitor-assets generate --android
```

#### 文件关联（双击 .md 用本应用打开）

编辑 `android/app/src/main/AndroidManifest.xml`，在主 Activity 内加：

```xml
<intent-filter>
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="content" android:mimeType="text/markdown" />
  <data android:scheme="file" android:mimeType="text/markdown" />
</intent-filter>
```

并在 JS 侧读 `App.getLaunchUrl()` 取路径后调用 `Filesystem.readFile`。

---

## 为什么不在本机直接出 APK

本机工具链实测结果（`docs/04` 同源）：

```
ANDROID_HOME = (空)
Android SDK → 未安装
JDK 25（AGP 8.x 官方支持 17/21）
Rust/MSVC → 未安装（Tauri 路线因此也不可行）
```

出 APK 需要约 2.5GB 的 SDK 下载 + 许可证确认，属于环境准备而非代码工作。工程侧已经准备好了，装完 SDK 即可一条命令出包。
