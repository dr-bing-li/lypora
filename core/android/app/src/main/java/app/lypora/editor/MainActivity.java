package app.lypora.editor;

import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.JSObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * Lypora 主活动 —— 在 Capacitor 空壳基础上增加「打开方式 / 分享」接收能力：
 *
 *   ACTION_VIEW：文件管理器点击 .md/.txt（content:// 或 file://），读流交给前端；
 *   ACTION_SEND：分享面板发来的文本（EXTRA_TEXT，含链接）或文件流（EXTRA_STREAM）。
 *
 * 内容统一包装成 {action,name,content,source} JSON：
 *   冷启动 → IntentPipePlugin 暂存，前端 boot 时 getPending() 领取；
 *   热启动 → 直接向 WebView 派发 window 'lyporaIntent' 事件。
 */
public class MainActivity extends BridgeActivity {

    /** 超过 4MB 的文件只读前 4MB（Markdown 场景足够，防 OOM） */
    private static final long MAX_READ = 4L * 1024 * 1024;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 必须在 super.onCreate 之前注册，Capacitor 才会把插件挂上 bridge
        registerPlugin(IntentPipePlugin.class);
        super.onCreate(savedInstanceState);
        handleIntent(getIntent(), true);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent, false);
    }

    private void handleIntent(Intent intent, boolean coldStart) {
        if (intent == null) return;
        String action = intent.getAction();
        if (action == null) return;

        String name = null;
        String content = null;
        String source = "";

        if (Intent.ACTION_VIEW.equals(action)) {
            Uri uri = intent.getData();
            if (uri != null) {
                name = queryDisplayName(uri);
                content = readUri(uri);
                source = uri.toString();
            }
        } else if (Intent.ACTION_SEND.equals(action)) {
            Uri stream = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            String text = intent.getStringExtra(Intent.EXTRA_TEXT);
            if (stream != null) {
                name = queryDisplayName(stream);
                content = readUri(stream);
                source = stream.toString();
            } else if (text != null && !text.isEmpty()) {
                content = text;
                name = "shared.md";
            }
        } else {
            return;
        }

        if (content == null) return;
        if (name == null || name.trim().isEmpty()) name = "未命名.md";

        JSObject payload = new JSObject();
        payload.put("action", action);
        payload.put("name", name);
        payload.put("content", content);
        payload.put("source", source);
        String json = payload.toString();

        // 暂存：前端任何时刻调 getPending() 都能领到（冷启动兜底）
        IntentPipePlugin.setPending(json);

        if (!coldStart && bridge != null && bridge.getWebView() != null) {
            // 热启动：页面已就绪，直接推事件
            bridge.getWebView().post(() -> {
                if (bridge != null && bridge.getWebView() != null) {
                    bridge.getWebView().evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('lyporaIntent',{detail:" + json + "}));",
                        null);
                }
            });
        }
    }

    /** 取展示文件名：优先 content provider 的 DISPLAY_NAME，退化为路径末段 */
    private String queryDisplayName(Uri uri) {
        if (uri == null) return null;
        if ("file".equals(uri.getScheme()) && uri.getPath() != null) {
            String p = uri.getPath();
            return p.substring(p.lastIndexOf('/') + 1);
        }
        try (Cursor c = getContentResolver().query(uri, null, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0 && !c.isNull(idx)) return c.getString(idx);
            }
        } catch (Exception ignored) {
            // provider 不给名字就走兜底
        }
        String p = uri.getLastPathSegment();
        return p == null ? null : p.substring(p.lastIndexOf('/') + 1);
    }

    /** 读 URI 内容为 UTF-8 字符串；失败返回 null（前端不加载） */
    private String readUri(Uri uri) {
        try (InputStream in = getContentResolver().openInputStream(uri)) {
            if (in == null) return null;
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            long total = 0;
            int n;
            while ((n = in.read(chunk)) > 0) {
                total += n;
                if (total > MAX_READ) break;
                buf.write(chunk, 0, n);
            }
            return new String(buf.toByteArray(), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return null;
        }
    }
}
