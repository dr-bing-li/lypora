/**
 * 模板编译器 —— 把 CardTemplate 编译成一段 CSS。
 *
 * 核心取舍：**共用一份骨架 + 模板只输出变量**。
 *
 * 另一种做法是每个模板写一整段 CSS（v0.8.2 就是这样）。它的问题是：模板一多，
 * 规则就开始互相抄、改一个排版细节要改 12 遍、分页与截图的测量基准也会漂。
 * 这里改成 12 套模板共用骨架，差异全部压缩到 30 来个 CSS 变量 + 4 个 data 属性上：
 *
 *   .ly-card[data-tpl="note"] { --c-paper: #fff8c9; --c-size: 15px; ... }
 *   .ly-card[data-tex="grid"]::before { ...纹理... }      ← 8 种纹理，全局一份
 *   .ly-card[data-acc="left"]::after { ...强调条... }      ← 4 种强调位，全局一份
 *
 * 于是"新增一套模板"= 加一条 JSON 常量，0 行 CSS；"用户调参数"= 改变量值重新编译。
 */

import { MONO_STACK, HEAD_LEVELS, type CardTemplate, type HeadSpec } from './types'
import { BG_PREVIEW, BG_PREVIEW_SIZE } from './params'

/** 纹理 / 强调位 / 折角：全局唯一实现，靠 data 属性命中 */
const DECOR_CSS = `
/* ---- 背景层（底纹预设或自定义图）：最底下，压不到正文 ---- */
.ly-card .ly-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background-image: var(--c-bg-img, none);
  background-size: var(--c-bg-size, auto);
  background-position: center;
  background-repeat: var(--c-bg-repeat, repeat);
  opacity: var(--c-bg-opacity, 1);
}

.ly-card::before { content: ""; position: absolute; inset: 0; pointer-events: none; z-index: 1; }
.ly-card::after { content: ""; position: absolute; pointer-events: none; z-index: 3; }
.ly-card .ly-inner::after { content: ""; position: absolute; pointer-events: none; z-index: 3; }

/* ---- 纹理 ---- */
.ly-card[data-tex="grain"]::before {
  background-image: radial-gradient(rgba(0, 0, 0, 0.055) 0.5px, transparent 0.5px);
  background-size: 3px 3px;
}
.ly-card[data-tex="grid"]::before {
  background-image:
    linear-gradient(to right, var(--c-tex-line) 1px, transparent 1px),
    linear-gradient(to bottom, var(--c-tex-line) 1px, transparent 1px);
  background-size: 24px 24px;
}
.ly-card[data-tex="dots"]::before {
  background-image: radial-gradient(var(--c-tex-line) 1.2px, transparent 1.2px);
  background-size: 18px 18px;
}
.ly-card[data-tex="ruled"]::before {
  background-image: repeating-linear-gradient(
    to bottom,
    transparent 0 27px,
    var(--c-tex-line) 27px 28px
  );
}
.ly-card[data-tex="fiber"]::before {
  background-image:
    repeating-linear-gradient(94deg, transparent 0 3px, var(--c-tex-line) 3px 4px),
    repeating-linear-gradient(4deg, transparent 0 5px, var(--c-tex-line) 5px 6px);
  opacity: 0.55;
}
.ly-card[data-tex="halo"]::before {
  background:
    radial-gradient(ellipse at 22% -8%, var(--c-halo) 0%, transparent 58%),
    radial-gradient(ellipse at 92% 108%, var(--c-halo) 0%, transparent 52%);
}
.ly-card[data-tex="stripe"]::before {
  background-image: repeating-linear-gradient(
    135deg,
    var(--c-tex-line) 0 2px,
    transparent 2px 16px
  );
  opacity: 0.7;
}
/* 胶片齿孔：上下各一排小方块。用两层 no-repeat 渐变定位，不占额外元素。 */
.ly-card[data-tex="perf"]::before {
  background-image:
    repeating-linear-gradient(to right, var(--c-tex-line) 0 12px, transparent 12px 30px),
    repeating-linear-gradient(to right, var(--c-tex-line) 0 12px, transparent 12px 30px);
  background-size: 100% 11px, 100% 11px;
  background-repeat: no-repeat;
  background-position: 0 8px, 0 calc(100% - 8px);
}

/* ---- 强调条 ---- */
.ly-card[data-acc="top"]::after { top: 0; left: 0; right: 0; height: 5px; background: var(--c-accent); }
.ly-card[data-acc="left"]::after { top: 0; bottom: 0; left: 0; width: 6px; background: var(--c-accent); }
.ly-card[data-acc="corner"]::after {
  top: 0; right: 0; width: 46px; height: 46px;
  background: linear-gradient(225deg, var(--c-accent) 0 50%, transparent 50%);
  opacity: 0.9;
}

/* ---- 折角 / 圆切角（右上） ----
 * schema 3 只剩 [data-corner="fold"] 一条实现，"round" 是空选项：选了什么都不发生。
 * schema 4 把它做成"明显的大圆角"：与 radius 滑块叠加（radius 决定小圆角的手感，
 * round 在此基础上再加 16px），这样即使 radius=0 也能一眼看出变化。
 * 预览与导出都必须保留这个圆角 —— 见 card-capture.ts 的 keepRadius。 */
.ly-card[data-corner="fold"] .ly-inner::after {
  top: 0; right: 0; width: 46px; height: 46px;
  background: linear-gradient(225deg, var(--c-fold) 0 50%, var(--c-paper-solid) 50%);
  box-shadow: -2px 2px 4px rgba(0, 0, 0, 0.12);
}
.ly-card[data-corner="round"] { border-radius: calc(var(--c-radius) + 16px); }

/* ---- 整卡外边框（真实元素 .ly-frame，绝对定位，不参与布局） ---- */
.ly-card .ly-frame { position: absolute; pointer-events: none; z-index: 3; border-radius: inherit; }
.ly-card[data-frame="thin"] .ly-frame { inset: 0; border: 1px solid var(--c-frame); }
.ly-card[data-frame="double"] .ly-frame { inset: 9px; border: 3px double var(--c-frame); border-radius: calc(var(--c-radius) * 0.6); }
.ly-card[data-frame="dashed"] .ly-frame { inset: 7px; border: 1.5px dashed var(--c-frame); border-radius: calc(var(--c-radius) * 0.6); }
.ly-card[data-frame="inset"] .ly-frame { inset: 0; box-shadow: inset 0 0 0 1px var(--c-frame), inset 0 0 22px rgba(0, 0, 0, 0.06); }

/* ---- 胶带 ---- */
.ly-card .ly-tape {
  position: absolute;
  top: -8px; left: 50%;
  transform: translateX(-50%) rotate(-2.2deg);
  width: 96px; height: 26px;
  background: var(--c-tape);
  border-left: 1px dashed rgba(160, 150, 120, 0.4);
  border-right: 1px dashed rgba(160, 150, 120, 0.4);
  z-index: 4;
}

/* ---- 印章 ----
 * 老实现是一个 34×34 的纯色方块 + 内描边，用户原话"不像印章"。
 * 现在是四种用 HTML+CSS 画出来的预设（朱文圆印 / 白文方印 / 已阅长条 / 手写签名），
 * 零文件零请求；也可以换成用户上传的透明 PNG。位置与大小都是变量。 */
.ly-card .ly-stamp {
  position: absolute;
  z-index: 4;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  color: var(--c-accent);
  opacity: 0.84;
  transform: rotate(-7deg);
  pointer-events: none;
  line-height: 1;
}
.ly-card .ly-stamp[data-pos="br"] { right: 22px; bottom: 20px; }
.ly-card .ly-stamp[data-pos="bl"] { left: 22px; bottom: 20px; transform: rotate(6deg); }
.ly-card .ly-stamp[data-pos="tr"] { right: 22px; top: 20px; transform: rotate(5deg); }
.ly-card .ly-stamp[data-pos="tl"] { left: 22px; top: 20px; transform: rotate(-5deg); }
.ly-card .ly-stamp b { font-weight: 700; line-height: 1; }

/* 朱文圆印：双环 + 一个楷体字 */
.ly-card .ly-stamp[data-stamp="seal"] {
  width: var(--c-stamp-size); height: var(--c-stamp-size);
  border: calc(var(--c-stamp-size) * 0.05) solid currentColor;
  border-radius: 50%;
}
.ly-card .ly-stamp[data-stamp="seal"]::after {
  content: ""; position: absolute; inset: calc(var(--c-stamp-size) * 0.085);
  border: 1px solid currentColor; border-radius: 50%;
}
.ly-card .ly-stamp[data-stamp="seal"] b {
  font-family: 'Kaiti SC', 'KaiTi', 'STKaiti', 'Songti SC', serif;
  font-size: calc(var(--c-stamp-size) * 0.46);
}
/* 白文方印：实底反白，竖排两字 */
.ly-card .ly-stamp[data-stamp="square"] {
  width: var(--c-stamp-size); height: var(--c-stamp-size);
  background: currentColor; border-radius: 3px;
}
.ly-card .ly-stamp[data-stamp="square"] b {
  color: var(--c-paper-solid);
  font-family: 'Kaiti SC', 'KaiTi', 'STKaiti', 'Songti SC', serif;
  font-size: calc(var(--c-stamp-size) * 0.40);
  letter-spacing: 0.06em;
  writing-mode: vertical-rl;
  text-orientation: upright;
}
/* 长条印：椭圆双线 + 横排小字 */
.ly-card .ly-stamp[data-stamp="strip"] {
  width: calc(var(--c-stamp-size) * 2.15); height: calc(var(--c-stamp-size) * 0.54);
  border: calc(var(--c-stamp-size) * 0.035) solid currentColor;
  border-radius: 999px;
}
.ly-card .ly-stamp[data-stamp="strip"] b {
  font-family: 'Kaiti SC', 'KaiTi', 'STKaiti', 'Songti SC', serif;
  font-size: calc(var(--c-stamp-size) * 0.30);
  letter-spacing: 0.30em;
  text-indent: 0.30em;
}
/* 手写签名：楷体斜体 + 一道下划线 */
.ly-card .ly-stamp[data-stamp="signature"] {
  width: calc(var(--c-stamp-size) * 1.75); height: calc(var(--c-stamp-size) * 0.70);
  border-bottom: 1.5px solid currentColor;
  transform: rotate(-4deg);
}
.ly-card .ly-stamp[data-stamp="signature"] b {
  font-family: 'Kaiti SC', 'KaiTi', 'STKaiti', 'Songti SC', serif;
  font-style: italic;
  font-size: calc(var(--c-stamp-size) * 0.52);
  letter-spacing: 0.04em;
  padding-bottom: 0.08em;
}
/* 自定义上传：透明 PNG，按宽高比缩放进 stampSize 的方框 */
.ly-card .ly-stamp-img { object-fit: contain; object-position: center; }
.ly-card .ly-stamp[data-pos="br"] .ly-stamp-img, .ly-card .ly-stamp[data-pos="bl"] .ly-stamp-img { max-height: calc(var(--c-stamp-size) * 1.1); }

/* ---- 装订位（真实元素，绝对定位，不参与布局） ----
 * 回形针与订书钉原来是"三个 CSS 边框拼出来的"，形状与位置都不对（用户能一眼看出）。
 * 现在改成内联 SVG：形状是画出来的，缩放不糊，随卡片一起进 foreignObject。 */
.ly-card .ly-bind { position: absolute; z-index: 5; pointer-events: none; }
.ly-card .ly-bind svg { display: block; width: 100%; height: 100%; overflow: visible; }
.ly-card[data-bind="spiral"] .ly-bind {
  top: 0; bottom: 0; left: 6px; width: 22px;
  background-image: radial-gradient(
    circle at 11px 14px,
    var(--c-paper-solid) 0 4.4px,
    rgba(0, 0, 0, 0.26) 4.4px 5.8px,
    transparent 5.8px
  );
  background-size: 22px 32px;
  background-repeat: repeat-y;
}
.ly-card[data-bind="clip"] .ly-bind {
  top: 2px; left: 50%; width: 30px; height: 78px;
  transform: translateX(-50%) rotate(-13deg);
  filter: drop-shadow(1.2px 2.2px 1.6px rgba(0, 0, 0, 0.3));
}
.ly-card[data-bind="staple"] .ly-bind {
  top: 10px; left: 50%; width: 44px; height: 24px;
  transform: translateX(-50%) rotate(-6deg);
  filter: drop-shadow(0.8px 1.6px 1.2px rgba(0, 0, 0, 0.28));
}

/* ---- 角饰贴纸（schema 5）----
 * 用真实元素 + 内联 SVG，不用 ::before/::after —— 那两个名额已经被纹理和强调条占了，
 * 而且一张卡要能贴多枚（星标 + 徽标），伪元素根本不够用。
 * 位置与出血都走变量，四个角各一条规则（不靠 inset 简写，因为它无法表达"负值出血"）。 */
.ly-card .ly-orn {
  position: absolute;
  z-index: 6;
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--o-size, 64px);
  height: var(--o-size, 64px);
  transform: rotate(var(--o-rot, 0deg));
  pointer-events: none;
}
.ly-card .ly-orn[data-pos="tl"] { top: calc(var(--o-bleed, 0px) * -1); left: calc(var(--o-bleed, 0px) * -1); }
.ly-card .ly-orn[data-pos="tr"] { top: calc(var(--o-bleed, 0px) * -1); right: calc(var(--o-bleed, 0px) * -1); }
.ly-card .ly-orn[data-pos="bl"] { bottom: calc(var(--o-bleed, 0px) * -1); left: calc(var(--o-bleed, 0px) * -1); }
.ly-card .ly-orn[data-pos="br"] { bottom: calc(var(--o-bleed, 0px) * -1); right: calc(var(--o-bleed, 0px) * -1); }
.ly-card .ly-orn svg { display: block; width: 100%; height: 100%; overflow: visible; }
/* 徽标上的字：字号跟着贴纸大小走，写死 px 在 40px 的小徽标上会溢出 */
.ly-card .ly-orn b {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: calc(var(--o-size, 64px) * 0.25);
  font-weight: 800;
  line-height: 1;
  letter-spacing: 0.01em;
  color: var(--o-text, #ffffff);
  transform: rotate(var(--o-text-rot, 0deg));
}

/* ---- 支撑面三态（schema 5）----
 * 只调"包裹感"，不改字号与行高 —— 后者属于 metrics，混在一起会让分页算不准。 */
.ly-card[data-tbl="boxed"] .ly-body table { border: 1.5px solid var(--c-ink); }
.ly-card[data-tbl="boxed"] .ly-body th,
.ly-card[data-tbl="boxed"] .ly-body td { border-color: var(--c-ink); }
.ly-card[data-tbl="pop"] .ly-body table {
  border: 2px solid var(--c-ink);
  box-shadow: 4px 4px 0 var(--c-accent);
  background: var(--c-panel-bg, transparent);
}
.ly-card[data-tbl="pop"] .ly-body th,
.ly-card[data-tbl="pop"] .ly-body td { border-color: var(--c-ink); }
.ly-card[data-tbl="pop"] .ly-body th { background: var(--c-accent); color: var(--c-on-accent); }

.ly-card[data-pre="boxed"] .ly-body pre.ly-code { border: 1.5px solid var(--c-rule); }
.ly-card[data-pre="pop"] .ly-body pre.ly-code {
  border: 2px solid var(--c-ink);
  box-shadow: 4px 4px 0 var(--c-accent);
  border-radius: 0;
}
.ly-card[data-pic="framed"] .ly-body img {
  border: 2px solid var(--c-ink);
  padding: 4px;
  background: var(--c-panel-bg, #ffffff);
  border-radius: 0;
}
.ly-card[data-pic="taped"] .ly-body img {
  border: 6px solid #ffffff;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
  transform: rotate(-0.6deg);
}

/* ---- 有序序号形态（schema 5）----
 * 用 counter(list-item)：它是 CSS 内置的计数器，会跟随 ol 的 start 属性与 li 的 value 属性，
 * 所以渲染器一行都不用改（md2card 是给每个 li 写 data-index，等于多一处隐式契约）。
 * 注意：本文件的注释会被内联进 SVG 的 style 里，**不能出现裸的小于号**
 * （写成「ol 的 start 属性」而不是尖括号形式），否则 XML 解析器会当标签开头。 */
.ly-card[data-listno="circle"] .ly-body ol,
.ly-card[data-listno="square"] .ly-body ol { list-style: none; padding-left: 2.15em; }
.ly-card[data-listno="circle"] .ly-body ol > li,
.ly-card[data-listno="square"] .ly-body ol > li { position: relative; }
.ly-card[data-listno="circle"] .ly-body ol > li::before,
.ly-card[data-listno="square"] .ly-body ol > li::before {
  content: counter(list-item);
  position: absolute;
  left: -2.1em;
  top: 0.16em;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.62em;
  height: 1.62em;
  background: var(--c-accent);
  color: var(--c-on-accent);
  font-size: 0.74em;
  font-weight: 700;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.ly-card[data-listno="circle"] .ly-body ol > li::before { border-radius: 50%; }
.ly-card[data-listno="square"] .ly-body ol > li::before { border-radius: 2px; }

/* ---- 五角星项目符号（schema 5）----
 * 不用 SVG：★ 是 U+2605，汉字字体全有，跟着字号缩放不用调；SVG 在这里要多挂 6 个
 * 元素，列表一长就拖慢分页测量。 */
.ly-card[data-bullet="star"] .ly-body ul > li:not(.task) {
  list-style: none;
  position: relative;
  padding-left: 1.3em;
}
.ly-card[data-bullet="star"] .ly-body ul > li:not(.task)::before {
  content: "★";
  position: absolute;
  left: 0;
  top: 0;
  color: var(--c-accent);
  font-size: 0.86em;
}
`

/**
 * 共用排版骨架。所有尺寸都挂变量，模板只改变量值 —— 这是"可调参数"能生效的前提。
 * 任何写死 px 的地方都会让某个参数对某套模板失效。
 */
export const CARD_BASE_CSS = `
.ly-card {
  --c-paper: #ffffff;
  --c-paper-solid: #ffffff;
  --c-ink: #1a1d21;
  --c-muted: #5b6470;
  --c-faint: #9aa2ad;
  --c-accent: #111418;
  --c-on-accent: #ffffff;
  --c-rule: #e8eaed;
  --c-code-bg: #f7f8f9;
  --c-code-ink: #24292f;
  --c-quote-bg: transparent;
  --c-quote-rule: #d0d7de;
  --c-mark: #fff3a3;
  --c-shadow: none;
  --c-tex-line: rgba(0, 0, 0, 0.06);
  --c-halo: rgba(120, 160, 255, 0.16);
  --c-fold: rgba(0, 0, 0, 0.06);
  --c-tape: rgba(255, 255, 255, 0.55);
  --c-frame: #d9dde3;
  --c-stamp-size: 64px;
  --c-pad-x: 40px;
  --c-pad-top: 44px;
  --c-pad-bottom: 40px;
  --c-size: 15px;
  --c-lh: 1.78;
  --c-radius: 6px;
  --c-title-size: 34px;
  --c-font: -apple-system, 'Segoe UI', 'Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', sans-serif;
  --c-head-font: var(--c-font);
  --c-mono: ${MONO_STACK.replace(/`/g, '')};

  position: relative;
  box-sizing: border-box;
  width: var(--ly-card-w);
  height: var(--ly-card-h);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  /* schema 5：外圈带。0 时与旧版完全一致 —— 这是"双面卡片"的全部实现，
     所谓"黄色边框"其实是这一圈留白，不是 border（见 docs/10 §2.1）。
     "band-k" 是给缩略图用的整体压缩系数：30px 的带子放在 170px 宽的缩略图上
     会吃掉三分之一，等比压一下才看得出"是黄边围着一张白卡"。 */
  padding: calc(var(--c-band, 0px) * var(--c-band-k, 1));
  background: var(--c-paper);
  color: var(--c-ink);
  font-family: var(--c-font);
  font-size: var(--c-size);
  line-height: var(--c-lh);
  box-shadow: var(--c-shadow);
  border-radius: var(--c-radius);
  -webkit-font-smoothing: antialiased;
  text-rendering: geometricPrecision;
}
.ly-card * { box-sizing: border-box; }

.ly-card .ly-inner {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  /* 内面板（"白卡"那一层）：四个变量默认全为"不画"，所以 28 套老模板一点不变。
     分页测量量的是 .ly-body 的 clientHeight，这一圈 padding 与 border 天然计入，
     不需要在 paginate 里额外补偿。 */
  background-color: var(--c-panel-bg, transparent);
  border: var(--c-panel-border, 0px) solid var(--c-ink);
  border-radius: var(--c-panel-radius, 0px);
  box-shadow: var(--c-panel-shadow, none);
  padding: var(--c-panel-pad, var(--c-pad-top) var(--c-pad-x) var(--c-pad-bottom));
}

.ly-card .ly-head {
  flex: 0 0 auto;
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 0.9em;
  padding-bottom: 0.45em;
  border-bottom: 1px solid var(--c-rule);
  font-size: 0.76em;
  letter-spacing: 0.04em;
  color: var(--c-faint);
}
.ly-card .ly-head .ly-doc { font-weight: 600; color: var(--c-muted); }
.ly-card .ly-head .ly-sec { margin-left: auto; color: var(--c-faint); }

.ly-card .ly-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}
.ly-card .ly-foot {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 0.8em;
  padding-top: 0.5em;
  font-size: 0.72em;
  color: var(--c-faint);
  border-top: 1px solid var(--c-rule);
}
.ly-card .ly-foot .ly-page { margin-left: auto; font-variant-numeric: tabular-nums; }
.ly-card .ly-foot .ly-brand { letter-spacing: 0.12em; text-transform: uppercase; font-size: 0.86em; }

/* 封面 */
.ly-card.ly-cover[data-cover="center"] .ly-inner { justify-content: center; }
.ly-card.ly-cover[data-cover="top"] .ly-inner { justify-content: flex-start; padding-top: calc(var(--c-pad-top) * 1.6); }
.ly-card.ly-cover[data-cover="band"] .ly-inner { justify-content: flex-end; }

.ly-card .ly-kicker {
  display: inline-block;
  align-self: flex-start;
  margin-bottom: 1em;
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--c-accent);
  color: var(--c-on-accent);
  font-size: 0.7em;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.ly-card .ly-title {
  margin: 0 0 0.5em;
  font-family: var(--c-head-font);
  font-size: var(--c-title-size);
  line-height: 1.3;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: var(--c-ink);
}
.ly-card .ly-sub {
  margin: 0;
  font-size: 0.93em;
  line-height: var(--c-lh);
  color: var(--c-muted);
  max-height: 5.2em;
  overflow: hidden;
}
.ly-card .ly-cover-rule {
  width: 56px;
  height: 3px;
  margin: 1.4em 0 0;
  background: var(--c-accent);
  border-radius: 2px;
}
.ly-card .ly-meta {
  margin-top: 1.7em;
  font-size: 0.76em;
  color: var(--c-faint);
  display: flex;
  gap: 10px;
  align-items: center;
}

/* 正文排版，全部 em 相对 --c-size */
.ly-card .ly-body > :first-child { margin-top: 0; }
.ly-card .ly-body > :last-child { margin-bottom: 0; }
.ly-card h1, .ly-card h2, .ly-card h3, .ly-card h4, .ly-card h5, .ly-card h6 {
  font-family: var(--c-head-font);
  line-height: 1.42;
  font-weight: 700;
  margin: 1.1em 0 0.5em;
}
.ly-card h1 { font-size: 1.5em; }
.ly-card h2 { font-size: 1.28em; }
.ly-card h3 { font-size: 1.12em; }
.ly-card h4 { font-size: 1em; }
.ly-card h5, .ly-card h6 { font-size: 0.94em; color: var(--c-muted); }
.ly-card p { margin: 0.72em 0; }
.ly-card a { color: var(--c-accent); text-decoration: none; border-bottom: 1px solid currentColor; }
.ly-card strong { font-weight: 700; }
.ly-card em { font-style: italic; }
.ly-card del { color: var(--c-muted); }
.ly-card mark { background: var(--c-mark); color: inherit; padding: 0 2px; border-radius: 2px; }
/* 分隔线：schema 5 起线高与线型都是变量（斜纹/胶带/虚线靠 background 画，不是 border-style） */
.ly-card hr {
  border: 0;
  height: var(--c-hr-h, 1px);
  margin: 1.4em 0;
  background: var(--c-hr-bg, var(--c-rule));
}

.ly-card ul, .ly-card ol { margin: 0.7em 0; padding-left: 1.35em; }
.ly-card li { margin: 0.3em 0; }
.ly-card li::marker { color: var(--c-accent); }
.ly-card li.task { list-style: none; margin-left: -1.2em; }
.ly-card li.task input { margin-right: 0.4em; vertical-align: -0.08em; accent-color: var(--c-accent); }
.ly-card li.task.done { color: var(--c-muted); }

.ly-card blockquote {
  margin: 0.9em 0;
  padding: 0.55em 0 0.55em 0.9em;
  border-left: 3px solid var(--c-quote-rule);
  background: var(--c-quote-bg);
  color: var(--c-muted);
  font-size: 0.96em;
  border-radius: 0 4px 4px 0;
}
.ly-card blockquote p { margin: 0.3em 0; }

/* ---- 引用框形态（schema 4）----
 * 优先级靠 data-quote 把每条都写成 [data-quote] 选择器，特异性高于上面的基础规则，
 * 不依赖书写顺序 —— 与"末尾同权媒体查询会顶掉样式"是同一类教训。 */
.ly-card[data-quote="bar"] .ly-body blockquote {
  border: 0;
  border-left: 3px solid var(--c-quote-rule);
  background: var(--c-quote-bg);
  border-radius: 0 4px 4px 0;
  padding: 0.55em 0.9em 0.55em 0.9em;
}
.ly-card[data-quote="card"] .ly-body blockquote {
  position: relative;
  border: 0;
  background: var(--c-quote-bg);
  border-radius: 10px;
  padding: 0.9em 1.05em 0.85em 1.05em;
  box-shadow: inset 3px 0 0 var(--c-accent), 0 0 0 1px var(--c-rule);
  overflow: hidden;
}
.ly-card[data-quote="card"] .ly-body blockquote::before {
  content: "“";
  position: absolute;
  top: -0.42em;
  right: 0.16em;
  font-family: Georgia, 'Songti SC', serif;
  font-size: 3.4em;
  line-height: 1;
  color: var(--c-accent);
  opacity: 0.16;
}
/* 四角书引：8 条 1.5px 渐变线拼出四个角（单个伪元素画 8 个角，不占用正文节点） */
.ly-card[data-quote="quad"] .ly-body blockquote {
  border: 0;
  background-color: transparent;
  background-image:
    linear-gradient(var(--c-accent) 0 0), linear-gradient(var(--c-accent) 0 0),
    linear-gradient(var(--c-accent) 0 0), linear-gradient(var(--c-accent) 0 0),
    linear-gradient(var(--c-accent) 0 0), linear-gradient(var(--c-accent) 0 0),
    linear-gradient(var(--c-accent) 0 0), linear-gradient(var(--c-accent) 0 0);
  background-repeat: no-repeat;
  background-size:
    18px 1.5px, 1.5px 18px, 18px 1.5px, 1.5px 18px,
    18px 1.5px, 1.5px 18px, 18px 1.5px, 1.5px 18px;
  background-position:
    left top, left top, right top, right top,
    left bottom, left bottom, right bottom, right bottom;
  border-radius: 0;
  padding: 0.85em 1.1em;
}
.ly-card[data-quote="bubble"] .ly-body blockquote {
  border: 0;
  background: var(--c-quote-bg);
  border-radius: 14px 14px 14px 3px;
  padding: 0.8em 1.05em;
  box-shadow: 0 0 0 1px var(--c-rule);
}
.ly-card[data-quote="none"] .ly-body blockquote {
  border: 0;
  background: transparent;
  padding: 0.5em 0;
  color: var(--c-muted);
}

/* ---- 项目符号（schema 4）----
 * 除 dot 外一律 list-style:none + ::before 定位：::marker 只能用 content 改字形，
 * 改不了颜色以外的位置与宽度，中文符号在等宽上还会偏。 */
.ly-card[data-bullet="dash"] .ly-body ul > li:not(.task),
.ly-card[data-bullet="square"] .ly-body ul > li:not(.task),
.ly-card[data-bullet="ring"] .ly-body ul > li:not(.task),
.ly-card[data-bullet="cjk"] .ly-body ul > li:not(.task),
.ly-card[data-bullet="none"] .ly-body ul > li:not(.task) {
  list-style: none;
  position: relative;
  padding-left: 1.15em;
}
.ly-card[data-bullet="dash"] .ly-body ul > li:not(.task)::before,
.ly-card[data-bullet="square"] .ly-body ul > li:not(.task)::before,
.ly-card[data-bullet="ring"] .ly-body ul > li:not(.task)::before,
.ly-card[data-bullet="cjk"] .ly-body ul > li:not(.task)::before {
  position: absolute;
  left: 0;
  top: 0;
  color: var(--c-accent);
  font-variant-numeric: tabular-nums;
}
.ly-card[data-bullet="dash"] .ly-body ul > li:not(.task)::before { content: "—"; opacity: 0.8; }
.ly-card[data-bullet="square"] .ly-body ul > li:not(.task)::before { content: "▪"; font-size: 0.92em; }
.ly-card[data-bullet="ring"] .ly-body ul > li:not(.task)::before { content: "◦"; font-size: 1.05em; }
.ly-card[data-bullet="cjk"] .ly-body ul > li:not(.task)::before { content: counter(list-item) "、"; }
.ly-card[data-bullet="none"] .ly-body ul > li:not(.task) { padding-left: 0; }

/* ---- 标题装饰（schema 4）---- */
.ly-card[data-title="underline"] .ly-body h1,
.ly-card[data-title="underline"] .ly-body h2 {
  padding-bottom: 0.22em;
  border-bottom: 2px solid var(--c-accent);
}
.ly-card[data-title="bar"] .ly-body h1,
.ly-card[data-title="bar"] .ly-body h2 {
  padding-left: 0.5em;
  border-left: 4px solid var(--c-accent);
}
.ly-card[data-title="block"] .ly-body h1,
.ly-card[data-title="block"] .ly-body h2 {
  display: block;
  background: var(--c-accent);
  color: var(--c-on-accent);
  padding: 0.16em 0.55em;
  border-radius: 3px;
  margin-left: -0.12em;
}
.ly-card[data-title="bracket"] .ly-body h1::before,
.ly-card[data-title="bracket"] .ly-body h2::before {
  content: "「";
  color: var(--c-accent);
  margin-left: -0.5em;
}
.ly-card[data-title="bracket"] .ly-body h1::after,
.ly-card[data-title="bracket"] .ly-body h2::after {
  content: "」";
  color: var(--c-accent);
}

.ly-card code {
  font-family: var(--c-mono);
  font-size: 0.86em;
  background: var(--c-code-bg);
  color: var(--c-code-ink);
  padding: 0.12em 0.35em;
  border-radius: 3px;
}
.ly-card pre.ly-code {
  margin: 0.9em 0;
  padding: 12px 14px;
  background: var(--c-code-bg);
  color: var(--c-code-ink);
  border-radius: min(var(--c-radius), 8px);
  overflow: hidden;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 0.83em;
  line-height: 1.62;
  position: relative;
}
.ly-card pre.ly-code code { background: none; padding: 0; color: inherit; font-size: 1em; }
.ly-card pre.ly-code .ly-lang {
  position: absolute;
  top: 6px;
  right: 9px;
  font-size: 0.76em;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--c-faint);
}
.ly-card .tok-com { color: var(--tok-com); font-style: italic; }
.ly-card .tok-str { color: var(--tok-str); }
.ly-card .tok-num { color: var(--tok-num); }
.ly-card .tok-kw  { color: var(--tok-kw); font-weight: 600; }
.ly-card .tok-fn  { color: var(--tok-fn); }

.ly-card table { width: 100%; margin: 0.9em 0; border-collapse: collapse; font-size: 0.9em; }
.ly-card th, .ly-card td {
  border: 1px solid var(--c-rule);
  padding: 6px 9px;
  text-align: left;
  vertical-align: top;
}
.ly-card th { background: var(--c-code-bg); font-weight: 700; }

.ly-card img {
  max-width: 100%;
  max-height: 46%;
  object-fit: cover;
  border-radius: var(--c-radius);
  display: block;
  margin: 0.8em auto;
}
.ly-card .ly-math { margin: 0.8em 0; text-align: center; overflow: hidden; }
.ly-card .katex { font-size: 1.02em; line-height: 1.3; }
.ly-card .katex-display { margin: 0.5em 0; }
` + DECOR_CSS

/** 模板的 data 属性表：纹理/强调位/折角/引用框/符号/标题/边框/装订全靠它命中 */
export function decorAttrMap(t: CardTemplate): Record<string, string> {
  const d = t.decor
  return {
    'data-tex': d.texture,
    'data-acc': d.accent,
    'data-corner': d.corner,
    'data-cover': d.cover,
    'data-bind': d.binding ?? 'none',
    'data-quote': d.quote ?? 'bar',
    'data-bullet': d.bullet ?? 'dot',
    'data-title': d.title ?? 'none',
    'data-frame': d.frame ?? 'none',
    /* schema 5 */
    'data-tbl': d.surface?.table ?? 'flat',
    'data-pre': d.surface?.code ?? 'flat',
    'data-pic': d.surface?.image ?? 'plain',
    'data-listno': d.listNo ?? 'plain',
  }
}

/** 同上的字符串形态（拼 HTML 时用） */
export function decorAttrs(t: CardTemplate): string {
  return Object.entries(decorAttrMap(t))
    .map(([k, v]) => ` ${k}="${v}"`)
    .join('')
}

/**
 * 编译模板 → CSS。只输出变量块与少量随模板变化的规则（标题字重、kicker 形态）。
 * 结果可以整段塞进 <style>，也可以内联进截图用的 SVG。
 */
export function compileTemplate(t: CardTemplate): string {
  const m = t.metrics
  const k = t.tokens
  // 半透明纯色兜底：折角三角需要一个不透明的"纸色"，在这里退化成白色
  const solid = gradientSolid(k.paper)
  const bg = buildBgVars(t.decor)
  const panel = t.decor.panel
  const hr = t.decor.rule
  return `
.ly-card[data-tpl="${t.id}"] {
  --c-paper: ${k.paper};
  --c-paper-solid: ${solid};
  --c-ink: ${k.ink};
  --c-muted: ${k.muted};
  --c-faint: ${k.faint};
  --c-accent: ${k.accent};
  --c-on-accent: ${k.onAccent};
  --c-rule: ${k.rule};
  --c-code-bg: ${k.codeBg};
  --c-code-ink: ${k.codeInk};
  --c-quote-bg: ${k.quoteBg};
  --c-quote-rule: ${k.quoteRule};
  --c-mark: ${k.mark};
  --c-shadow: ${k.shadow};
  --c-tex-line: ${texLineOf(t)};
  --c-halo: ${t.dark ? haloOf(k.accent) : 'rgba(120, 160, 255, 0.14)'};
  --c-fold: ${foldOf(k.ink)};
  --c-tape: ${t.dark ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.55)'};
  --c-frame: ${frameOf(t)};
  --c-stamp-size: ${Math.min(140, Math.max(34, t.decor.stampSize ?? 64))}px;
  --c-bg-img: ${bg.image};
  --c-bg-size: ${bg.size};
  --c-bg-repeat: ${bg.repeat};
  --c-bg-opacity: ${Math.min(100, Math.max(0, t.decor.bgOpacity)) / 100};
  --c-pad-x: ${m.padX}px;
  --c-pad-top: ${m.padTop}px;
  --c-pad-bottom: ${m.padBottom}px;
  --c-size: ${m.fontSize}px;
  --c-lh: ${m.lineHeight};
  --c-radius: ${m.radius}px;
  --c-title-size: ${m.titleSize}px;
  --c-font: ${t.font.body};
  --c-head-font: ${t.font.head};
  --c-mono: ${t.font.mono};
  --tok-com: ${t.code.com};
  --tok-str: ${t.code.str};
  --tok-num: ${t.code.num};
  --tok-kw: ${t.code.kw};
  --tok-fn: ${t.code.fn};
${panelVars(t, panel)}
${hrVars(k.rule, k.ink, hr)}
}` + headCss(t)
}

/** 内面板的变量块（全为默认值时整块省略，保持旧模板的 CSS 逐字节不变） */
function panelVars(t: CardTemplate, p: CardTemplate['decor']['panel']): string {
  if (!p.band && !p.border && !p.shadow && !p.pad) return ''
  const lines = [
    `  --c-band: ${Math.min(40, Math.max(0, p.band))}px;`,
    // 面板底色只有一个来源：tokens.panelBg。再开一个 decor.panel.bg 会变成
    // "两个都能改、谁赢看谁"的死结（面板上的色板到底该写哪一个？）
    `  --c-panel-bg: ${t.tokens.panelBg || 'transparent'};`,
    `  --c-panel-border: ${Math.min(4, Math.max(0, p.border))}px;`,
    `  --c-panel-radius: ${Math.min(24, Math.max(0, p.radius))}px;`,
    `  --c-panel-shadow: ${panelShadow(p.shadow, t.tokens.ink)};`,
  ]
  // pad 只在显式给了值时才接管 inner 的 padding；否则继续用 metrics 的三段留白。
  // 乘 --c-pad-k 是为了缩略图：170px 宽的小卡片上 12px 内边距就是 7%，
  // 直接照搬会让 .ly-body 只剩 40 多 px —— 那是"缩略图溢出"的真正来源。
  if (p.pad > 0) lines.push(`  --c-panel-pad: calc(${Math.min(40, p.pad)}px * var(--c-pad-k, 1));`)
  return lines.join('\n')
}

/**
 * 面板投影：只有三档预设，不收自由字符串。
 * "贴纸感"的本质是**模糊半径为 0 的硬影**（md2card 是 `10px 10px 0`），
 * 一旦允许用户写 `0 0 40px red`，那种硬边就没了 —— 而且任意 CSS 会绕过 normalize 的夹取。
 */
function panelShadow(kind: string, ink: string): string {
  if (kind === 'sticker') return `10px 10px 0 ${ink}`
  if (kind === 'float') {
    const rgb = toRgb(ink)
    const c = rgb ? `${rgb.r}, ${rgb.g}, ${rgb.b}` : '0, 0, 0'
    return `0 10px 26px rgba(${c}, 0.18)`
  }
  return 'none'
}

/** 分隔线的三条变量：线高、底（可能是渐变）、以及双色 */
function hrVars(ruleColor: string, ink: string, hr: CardTemplate['decor']['rule']): string {
  const c1 = hr.color || ruleColor
  const c2 = hr.color2 || ink
  const h = Math.min(12, Math.max(1, hr.height))
  let bg = c1
  if (hr.style === 'none') bg = 'transparent'
  else if (hr.style === 'dashed') bg = `repeating-linear-gradient(to right, ${c1} 0 ${h * 3}px, transparent ${h * 3}px ${h * 5}px)`
  else if (hr.style === 'stripe') bg = `repeating-linear-gradient(${Math.min(180, Math.max(0, hr.angle))}deg, ${c1} 0 ${h}px, ${c2} ${h}px ${h * 2}px)`
  else if (hr.style === 'tape') bg = `repeating-linear-gradient(to right, ${c1} 0 14px, ${c2} 14px 28px)`
  return `  --c-hr-h: ${h}px;\n  --c-hr-bg: ${bg};`
}

/** 这一级标题是不是"什么都不做"—— 是的话一条规则都不生成 */
function isPlainHead(h: HeadSpec): boolean {
  return (
    !h.bg && !h.fg && !h.padX && !h.padY && !h.radius && !h.rotate && !h.shadow &&
    !h.caps && !h.italic && h.align !== 'center' && !h.inline && h.rule === 'none'
  )
}

/**
 * 逐级标题形态。
 *
 * 为什么必须逐级：md2card 的波普三级标题是三种完全不同的东西 ——
 * h1 红色重影 + 斜纹下划线、h2 青底旋转 −2°、h3 珊瑚圆角块。
 * schema 4 的 `decor.title` 是对 h1/h2 同时生效的单一形态，表达不了这种"三级三样"。
 *
 * 为什么按模板条件生成、而不是在骨架里写一份通用规则：
 * 通用规则会让 28 套老模板也吃到 `border: 0` 之类的重置，与 `decor.title` 打架。
 * 只给真正用到的模板生成，旧模板的 CSS 逐字节不变（这也是升级不改变观感的保证）。
 */
function headCss(t: CardTemplate): string {
  const out: string[] = []
  for (const lv of HEAD_LEVELS) {
    const h = t.decor.headings?.[lv]
    if (!h || isPlainHead(h)) continue
    const d: string[] = []
    if (h.bg) d.push(`background-color: ${h.bg}`)
    if (h.fg) d.push(`color: ${h.fg}`)
    if (h.padX || h.padY) d.push(`padding: ${h.padY}px ${h.padX}px`)
    if (h.radius) d.push(`border-radius: ${h.radius}px`)
    if (h.rotate) d.push(`transform: rotate(${h.rotate}deg)`)
    if (h.shadow) d.push(`text-shadow: ${h.shadow}px ${h.shadow}px 0 var(--c-accent)`)
    if (h.caps) d.push('text-transform: uppercase')
    if (h.italic) d.push('font-style: italic')
    if (h.align === 'center') d.push('text-align: center')
    if (h.inline) {
      // display:table 让色块收窄到文字宽度（居中时再配 auto 外边距）
      d.push('display: table')
      if (h.align === 'center') d.push('margin-left: auto', 'margin-right: auto')
    }
    if (h.rule !== 'none') {
      // 下划线用 background-image 而不是 border-bottom：border 会改变行盒高度，
      // 而这里已经可能叠着底色块，加法越少越好
      d.push('padding-bottom: 0.16em')
      d.push('background-repeat: repeat-x')
      d.push('background-position: left bottom')
      if (h.rule === 'solid') {
        d.push('background-image: linear-gradient(var(--c-accent), var(--c-accent))')
        d.push('background-size: 100% 3px')
      } else {
        d.push('background-image: repeating-linear-gradient(45deg, var(--c-accent) 0 5px, var(--c-ink) 5px 10px)')
        d.push('background-size: 100% 6px')
      }
    }
    out.push(`.ly-card[data-tpl="${t.id}"] .ly-body ${lv} { ${d.join('; ')} }`)
  }
  return out.length ? '\n' + out.join('\n') : ''
}

/** 纹理线的颜色：模板指定了 patternInk 就用它，否则按纸色亮度自动算 */
function texLineOf(t: CardTemplate): string {
  if (t.decor.texture === 'none') return 'transparent'
  const ink = t.tokens.patternInk
  if (ink) return ink
  return texLine(gradientSolid(t.tokens.paper), t.dark)
}

/** 渐变/函数色的"代表色"，给需要不透明底的地方用 */
function gradientSolid(paper: string): string {
  if (!/gradient|url\(/i.test(paper)) return paper
  const m = paper.match(/#[0-9a-f]{3,8}/i)
  return m ? m[0] : '#ffffff'
}

/**
 * 纹理线的颜色：必须与**纸色**形成对比，不是与墨色。
 *
 * v0.9.0 这里判反了 —— 它看的是 ink 的亮度，浅色纸配深墨时返回
 * `rgba(255,255,255,0.085)`，于是白线画在白纸上，8 种纹理里 5 种完全不可见
 * （用户报的"纹理与装饰设了没效果"就是这个）。现在改成看纸色：
 * 亮纸用深线、暗纸用浅线，并把透明度提到肉眼确实能看见的量级。
 */
function texLine(paper: string, dark?: boolean): string {
  const rgb = toRgb(paper)
  if (!rgb) return dark ? 'rgba(255, 255, 255, 0.13)' : 'rgba(0, 0, 0, 0.11)'
  // 感知亮度（Rec.601）：比简单取均值更贴合"看起来亮不亮"
  const lum = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b
  return lum > 150 ? 'rgba(0, 0, 0, 0.11)' : 'rgba(255, 255, 255, 0.14)'
}

/**
 * 生成背景层的变量；自定义图优先于预设。
 * 预设的 CSS 值来自 params.ts（面板画缩略图用的是同一份，避免"选的"与"看到的"不一致）。
 */
function buildBgVars(d: CardTemplate['decor']): { image: string; size: string; repeat: string } {
  if (d.bgImage && /^data:image\/(png|jpeg|webp|gif);base64,/.test(d.bgImage)) {
    return { image: `url("${d.bgImage}")`, size: 'cover', repeat: 'no-repeat' }
  }
  const preset = BG_PREVIEW[d.bg]
  return preset
    ? { image: preset, size: BG_PREVIEW_SIZE[d.bg] ?? 'auto', repeat: 'repeat' }
    : { image: 'none', size: 'auto', repeat: 'repeat' }
}

function haloOf(accent: string): string {
  const rgb = toRgb(accent)
  if (!rgb) return 'rgba(120, 200, 255, 0.2)'
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.22)`
}

/**
 * 外边框颜色：亮纸用墨色的一点点（比 rule 明显），暗纸用白的一点点。
 * 直接复用 rule 会被浅色模板的分隔线吞掉（双线边框看着像没画）。
 */
function frameOf(t: CardTemplate): string {
  const rgb = toRgb(t.tokens.ink)
  if (!rgb) return t.dark ? 'rgba(255, 255, 255, 0.22)' : 'rgba(0, 0, 0, 0.16)'
  const lum = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b
  return lum > 140 ? 'rgba(0, 0, 0, 0.18)' : 'rgba(255, 255, 255, 0.26)'
}

function foldOf(ink: string): string {
  const rgb = toRgb(ink)
  if (!rgb) return 'rgba(0, 0, 0, 0.06)'
  const light = rgb.r + rgb.g + rgb.b > 450
  return light ? 'rgba(255, 255, 255, 0.5)' : 'rgba(0, 0, 0, 0.18)'
}

function toRgb(color: string): { r: number; g: number; b: number } | null {
  const s = color.trim()
  let m = /^#([0-9a-f]{6})$/i.exec(s)
  if (m) {
    const n = parseInt(m[1], 16)
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
  }
  m = /^#([0-9a-f]{3})$/i.exec(s)
  if (m) {
    const [r, g, b] = m[1].split('')
    return { r: parseInt(r + r, 16), g: parseInt(g + g, 16), b: parseInt(b + b, 16) }
  }
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(s)
  if (m) return { r: +m[1], g: +m[2], b: +m[3] }
  return null
}

/** 导出/截图时用的完整样式表：骨架 + 当前模板 */
export function stylesheetFor(t: CardTemplate): string {
  return CARD_BASE_CSS + '\n' + compileTemplate(t)
}
