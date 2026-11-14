这一版**没有新模板、没有新按钮**。它修的是一个在安卓上看起来像死机的 bug：排版面板里导出 PDF 或 PNG，
状态栏停在「正在渲染…」不动，或者直接甩一句「渲染失败」。桌面版从没出现过这个问题——所以 0.14.0 发出去时
没人发现它**只在 WebView 里成气候**。

一句话概括这一版的价值：**同一个渲染函数，在浏览器里"通常能跑"，在手机上必须按"会失败的外部服务"来写。**

**四个成因，四个都得堵。** 它们各自独立，任何一个没修都会复现同样的症状：

1. **唯一的等待没有超时。** 整个光栅化只有 `img.onload` 一个等待点。WebView 撞上超长 data URI
   （一张带公式的卡，SVG 约 400KB、URI 约 500KB）时，行为是**既不 load 也不 error**，Promise 永不 settle。
   于是状态栏永远停在「正在渲染…」，而 `busy` 一直是 `true` —— 之后每次点导出都在 `if (busy) return`
   处静默返回。用户看到的是"按钮死了"，实际是第一次就没回来。
2. **取图同样无限等。** `fetch(src)` 与 `img.decode()` 都没有上限，移动网络卡一次就再也不继续。
3. **失败不收拾现场。** 离屏宿主（一整张卡 + 一份全量 CSS）和临时改写的 `img.src` 只在成功路径还原。
   手机内存本来就紧，失败一次泄漏一次，越试越糟。
4. **"取消"被当成"失败"。** `@capacitor/share` 在分享面板被划走时会 `reject("Share canceled")`，
   而文件**已经写进 `Documents/Lypora`**。旧代码一律显示「导出失败」，于是用户去重试，方向全错。

**改法是一条降级链，不是一个新方案。** `base64 data URI → blob URL → percent data URI → 0.65 倍重画`，
每条路 6 秒上限，失败就换下一条；四条都失败才报错，并且把试过的路一起写出来
（`card-render-failed [data@2:… | blob@2:… | percent@2:… | data@1.3:…]`）。桌面永远走第一条，
所以桌面输出与 0.14.0 **逐字节相同**——C6 用 sha256 比的，不是"看起来一样"。

**验收在这一版抓到一个真坑。** `blob:` 作为 `<img>` 源时，Chromium 会把画布标记为 tainted，
`toBlob` 抛 SecurityError。而 PDF 那条路底色不透明，原来的空白检测只在透明底时做——**脏画布会一路走到
编码阶段才炸**，降级链等于白设。现在污染检查每条路都做：9 点 `getImageData` 采样，同时判"全透明空图"
与"画布被污染"。

**顺手修的两个小瑕疵。** 一是项目符号里的「星点」在面板上直接显示裸键名 `tpl.bullet.star`（七个语言包
都缺这条，词条 480 → 486）；二是上一版改过的两页帮助（`help/*/layout.md` 的「样式层」与背景/纹理拆分）
只落在源码里，这次构建才真正进 bundle。

**说实话的部分：这一版没有真机证据。** 开发机上没有安卓设备（`adb devices` 为空、无模拟器），
所有结论来自读码定位 + 在 Chromium 里用 localStorage 探针注入故障逐条复现（`lypora:capture-probe`，
产品里没有任何全局开关）。真机仍要人工点一次 PNG 与 PDF。好消息是：如果再失败，状态栏那行会直接告诉你
是**哪条路、什么原因**，把那一句发给我们就够定位——不再是一句无信息量的"导出失败"。

**升级注意。** 桌面三条平台覆盖即可，无配置迁移。安卓 versionCode 20 → 21，直接覆盖安装；
导出的文件仍在 `Documents/Lypora`，行为不变，只是"你划走分享面板"不再被算作失败。

---

This release ships **no new templates and no new buttons**. It fixes an Android bug that looks like a hang:
export PDF or PNG from the layout panel and the status bar sits on "Rendering…" forever, or throws "Rendering
failed". Desktop never had the problem, which is exactly why 0.14.0 shipped without anyone noticing that it
**only flourished inside a WebView**.

The value in one line: **the same rasteriser that "usually works" in a browser has to be written as if it were a
fallible external service once it runs on a phone.**

**Four causes, all of them independent.** Any one left unfixed reproduces the same symptom:

1. **The only wait had no timeout.** Rasterisation awaited `img.onload` and nothing else. Given a very long data
   URI (a card with formulas: ~400KB of SVG, ~500KB of URI), a WebView may **neither load nor error**, so the
   promise never settles. The status bar stays on "Rendering…" and `busy` stays `true` — every later tap on
   export returns silently at `if (busy) return`. The button looks dead; in fact the first attempt never came back.
2. **Image fetching could hang the same way.** `fetch(src)` and `img.decode()` had no ceiling either.
3. **Failures left litter behind.** The offscreen host (a whole card plus the full stylesheet) and the rewritten
   `img.src` values were only restored on the success path.
4. **"Cancelled" was reported as "failed".** Dismissing the share sheet makes `@capacitor/share` reject with
   "Share canceled" while the file **has already been written** to `Documents/Lypora`. The old code showed
   "Export failed", sending the user off to retry something that had actually succeeded.

**The fix is a degradation chain, not a second code path.** `base64 data URI → blob URL → percent data URI →
redraw at 0.65×`, six seconds each, moving on at the first failure; only when all four fail does it throw, and
the error lists the attempts (`card-render-failed [data@2:… | blob@2:… | …]`). Desktop always takes the first
route, so its output is **byte-identical to 0.14.0** — asserted with sha256, not eyeballed.

**Acceptance caught a real trap this time.** A `blob:` URL as an `<img>` source taints the canvas in Chromium and
`toBlob` throws SecurityError. The PDF route paints an opaque backdrop, and the old blank-check only ran for
transparent backgrounds — so a tainted canvas would have travelled all the way to the encoder before exploding,
making the whole chain pointless. Contamination is now checked on **every** route: nine `getImageData` probes
that distinguish "fully transparent" from "tainted".

**Two small blemishes fixed on the way.** The "star" bullet style displayed the raw key `tpl.bullet.star` in the
panel (the key was missing from all seven locales; 480 → 486 entries), and the two help pages rewritten last
release (`help/*/layout.md`, the style layer plus the background/texture split) had only existed in the source —
this build is the first one that actually bundles them.

**The honest part: there is no device evidence in this release.** The build machine has no Android device
(`adb devices` is empty, no emulator), so every conclusion comes from reading the code and reproducing each
failure in Chromium via a localStorage fault-injection probe (`lypora:capture-probe`; there is no global switch
in the product). Someone still has to tap PNG and PDF once on a real phone. The good news: if it fails again the
status line now names the route and the reason, and that one line is enough for us to locate it.

**Upgrading.** Overwrite on all three desktop platforms; no config migration. Android versionCode 20 → 21,
side-load over the old build. Exports still land in `Documents/Lypora`; the only behavioural change is that
dismissing the share sheet no longer counts as a failure.
