package app.lypora.editor;

import android.content.Context;
import android.content.res.Configuration;
import android.view.inputmethod.InputMethodManager;
import android.webkit.WebView;

import androidx.appcompat.app.AppCompatActivity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Ime —— 在「平板 + 蓝牙键盘」这种系统不给弹软键盘的场景下，把输入法请回来。
 *
 * 为什么需要它：
 *   Android 一旦探测到物理键盘（hardKeyboardHidden == NO），默认就不让软键盘弹出。
 *   手机输入法这时会切到「物理键盘直通」模式：按下 a 就送一个 KEYCODE_A 给应用，
 *   中文组词引擎根本不启动。可平板用户想要的是「键盘归键盘，输入法候选条还在」，
 *   或者干脆临时调软键盘打几个汉字 —— 系统设置里的「显示虚拟键盘」开关藏得太深，
 *   应用内没有入口的话，用户就卡在「只能打英文」。
 *
 * 关键点：showSoftInput 必须在主线程、且 WebView 持有焦点时调用；
 *   调之前先 restartInput，否则输入法还挂着切换前的 composable 状态，
 *   中文候选不会刷新（实测表现为「弹了键盘但打不出字」）。
 *
 * SHOW_IMPLICIT 在物理键盘存在时经常被系统忽略，所以要退到 SHOW_FORCED
 *   （API 28 起标记 deprecated，但仍是唯一能压过该策略的 flag）。
 */
@CapacitorPlugin(name = "Ime")
public class ImePlugin extends Plugin {

    /**
     * 请出软键盘。返回的 visible 是延迟 260ms 后回采的真实状态
     * —— showSoftInput 只表示「请求发出去了」，IME 起没起来要等它 bind 完才知道。
     */
    @PluginMethod
    @SuppressWarnings("deprecation")
    public void show(PluginCall call) {
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView == null) {
            call.reject("webview not ready");
            return;
        }
        // Activity 已销毁时 runOnUiThread 会 NPE，先挡一道（比如恰好在切后台时点了菜单）
        AppCompatActivity act = getActivity();
        if (act == null) {
            call.reject("activity not available");
            return;
        }
        final Context ctx = getContext();
        act.runOnUiThread(() -> {
            InputMethodManager imm = (InputMethodManager) ctx.getSystemService(Context.INPUT_METHOD_SERVICE);
            if (imm == null) {
                call.reject("INPUT_METHOD_SERVICE unavailable");
                return;
            }

            webView.requestFocus();
            imm.restartInput(webView);

            boolean requested = imm.showSoftInput(webView, InputMethodManager.SHOW_IMPLICIT);
            if (!requested) {
                requested = imm.showSoftInput(webView, InputMethodManager.SHOW_FORCED);
            }

            final boolean req = requested;
            // 等输入法真正 bind 完再回采，否则 visible 恒为 false 会把「已弹出」误报成失败
            webView.postDelayed(() -> {
                JSObject ret = new JSObject();
                ret.put("requested", req);
                ret.put("visible", imm.isAcceptingText());
                ret.put("hardwareKeyboard", hasHardwareKeyboard(ctx));
                call.resolve(ret);
            }, 260);
        });
    }

    /** 当前输入环境快照：有没有物理键盘、输入法是否处于接受文本的状态 */
    @PluginMethod
    public void info(PluginCall call) {
        Context ctx = getContext();
        InputMethodManager imm = (InputMethodManager) ctx.getSystemService(Context.INPUT_METHOD_SERVICE);
        JSObject ret = new JSObject();
        ret.put("hardwareKeyboard", hasHardwareKeyboard(ctx));
        ret.put("visible", imm != null && imm.isAcceptingText());
        call.resolve(ret);
    }

    /**
     * 物理键盘是否在位。
     * keyboard != NOKEYS 说明配了键盘设备；hardKeyboardHidden == NO 说明它没被收起。
     * 两个条件都满足才算「真的在用外接键盘」，避免蓝牙键盘断开后误判。
     */
    private boolean hasHardwareKeyboard(Context ctx) {
        Configuration cfg = ctx.getResources().getConfiguration();
        return cfg.keyboard != Configuration.KEYBOARD_NOKEYS
                && cfg.hardKeyboardHidden == Configuration.HARDKEYBOARDHIDDEN_NO;
    }
}
