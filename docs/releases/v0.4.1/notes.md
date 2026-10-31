# Lypora v0.4.1

Android 修复版：系统能正确唤起 Lypora 了——文件管理器里点 `.md` / `.txt` 可选「打开方式」，
任意应用「分享」文本或文件时，分享面板里会出现 Lypora。

**Android fix release:** Lypora now shows up in the system "Open with" and "Share" sheets —
tap a `.md`/`.txt` in any file manager, or share text/files from any app, straight into the editor.

## 变更内容 / What changed

- **AndroidManifest**：新增 4 组 Intent 过滤器（`ACTION_VIEW` / `ACTION_SEND` × 文本类 MIME
  `text/plain`、`text/markdown`、`text/x-markdown`，外加 `application/octet-stream` 兜底——
  不少文件管理器把 `.md` 上报成这个类型）。scheme 覆盖 `content://` 与 `file://`。
- **IntentPipe 原生插件**（新增）：接收 VIEW/SEND 后读取 `content://` 文件流或 `EXTRA_TEXT` /
  `EXTRA_STREAM`，包装为 `{action, name, content, source}` 交给 WebView。
  冷启动时 WebView 尚未就绪，payload 先暂存，前端启动后经 `getPending()` 领取；
  热启动（应用在前台再次接收）直接向 WebView 派发 `lyporaIntent` 事件，双保险。
- **前端接入**：收到内容直接载入编辑器并 toast 提示文件名；超过 4MB 的文件只读前 4MB，防 OOM。
- Windows 便携版无变化，与 v0.4.0 相同（`Lypora-0.4.0-win-x64.zip` 仍是当前 Windows 构建）。

## 已知边界 / Known limits

- APK 仍是 **debug 签名**（直接侧载，覆盖升级数据不丢）。
- 被「打开方式」唤起时文件只会读入编辑器，不会回写到原路径——保存仍走应用内导出/分享。
  这是应用专属目录存储模型的既定边界，不是本次回归。
- 部分国产文件管理器会缓存应用列表，安装后若列表里没出现，重启文件管理器即可。

## 下载 / Downloads

| 文件 / File | 平台 / Platform | 大小 / Size | SHA256 |
|---|---|---|---|
| `Lypora-0.4.1-android.apk` | Android 10+（API 29+） | 10.6 MiB | `18e3b2759a15dea419288954db0dd4b84c4c0ee95ed63fad87e803aa03491ebb` |
| `SHA256SUMS.txt` | 任意 / any | 见文件 / see file | — |

Windows 10/11 请继续使用 [`v0.4.0` 的 `Lypora-0.4.0-win-x64.zip`](https://github.com/dr-bing-li/lypora/releases/download/v0.4.0/Lypora-0.4.0-win-x64.zip)。

校验 / Verify:

```bat
certutil -hashfile Lypora-0.4.1-android.apk SHA256
```
