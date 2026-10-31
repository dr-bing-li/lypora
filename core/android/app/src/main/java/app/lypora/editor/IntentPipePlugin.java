package app.lypora.editor;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * IntentPipe —— 把系统「打开方式 / 分享」送进来的内容交给前端的暂存通道。
 *
 * 为什么需要它：
 *   冷启动时（点击文件图标唤起 Lypora），WebView 页面还没加载完，
 *   原生此刻向 JS 派发事件会石沉大海。所以原生侧先把 payload 存进静态字段，
 *   前端 boot 时主动调 getPending() 领走；热启动（应用在前台再次收到 VIEW/SEND）
 *   则由 MainActivity 直接 evaluateJavascript 派发 window 事件，双保险。
 */
@CapacitorPlugin(name = "IntentPipe")
public class IntentPipePlugin extends Plugin {

    private static volatile String pending = null;

    /** MainActivity 收到 VIEW/SEND 后调用；同一时刻只保留最新一条 */
    static void setPending(String json) {
        pending = json;
    }

    @PluginMethod
    public void getPending(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("payload", pending);
        pending = null;
        call.resolve(ret);
    }
}
