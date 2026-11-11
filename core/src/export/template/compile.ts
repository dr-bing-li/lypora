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

import { MONO_STACK, type CardTemplate } from './types'
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

/* ---- 强调条 ---- */
.ly-card[data-acc="top"]::after { top: 0; left: 0; right: 0; height: 5px; background: var(--c-accent); }
.ly-card[data-acc="left"]::after { top: 0; bottom: 0; left: 0; width: 6px; background: var(--c-accent); }
.ly-card[data-acc="corner"]::after {
  top: 0; right: 0; width: 46px; height: 46px;
  background: linear-gradient(225deg, var(--c-accent) 0 50%, transparent 50%);
  opacity: 0.9;
}

/* ---- 折角（便签右上） ---- */
.ly-card[data-corner="fold"] .ly-inner::after {
  top: 0; right: 0; width: 46px; height: 46px;
  background: linear-gradient(225deg, var(--c-fold) 0 50%, var(--c-paper-solid) 50%);
  box-shadow: -2px 2px 4px rgba(0, 0, 0, 0.12);
}

/* ---- 胶带 / 印章（真实元素，随页面 HTML 一起产出） ---- */
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
.ly-card .ly-stamp {
  position: absolute;
  right: 26px; bottom: 26px;
  width: 34px; height: 34px;
  border-radius: 3px;
  background: var(--c-accent);
  opacity: 0.85;
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.34);
  transform: rotate(-3deg);
  z-index: 4;
}
/* ---- 装订位（真实元素，绝对定位，不参与布局） ---- */
.ly-card .ly-bind { position: absolute; z-index: 5; pointer-events: none; }
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
  top: 16px; left: 50%; width: 26px; height: 64px;
  transform: translateX(-50%) rotate(-2deg);
  border: 2.6px solid rgba(148, 152, 158, 0.8);
  border-bottom-color: transparent;
  border-radius: 9px 9px 4px 4px;
  box-shadow: inset 0 2px 3px rgba(255, 255, 255, 0.55);
}
.ly-card[data-bind="staple"] .ly-bind {
  top: 22px; left: 50%; width: 36px; height: 8px;
  transform: translateX(-50%) rotate(-4deg);
  border: 2.4px solid rgba(138, 142, 148, 0.9);
  border-radius: 3px;
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
  padding: var(--c-pad-top) var(--c-pad-x) var(--c-pad-bottom);
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
.ly-card hr { border: none; border-top: 1px solid var(--c-rule); margin: 1.4em 0; }

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

/** 模板的 data 属性：渲染卡片时挂到根节点，纹理/强调位/折角/装订全靠它命中 */
export function decorAttrs(t: CardTemplate): string {
  return ` data-tex="${t.decor.texture}" data-acc="${t.decor.accent}" data-corner="${t.decor.corner}" data-cover="${t.decor.cover}" data-bind="${t.decor.binding ?? 'none'}"`
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
  --c-tex-line: ${t.decor.texture === 'none' ? 'transparent' : texLine(solid, t.dark)};
  --c-halo: ${t.dark ? haloOf(k.accent) : 'rgba(120, 160, 255, 0.14)'};
  --c-fold: ${foldOf(k.ink)};
  --c-tape: ${t.dark ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.55)'};
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
}`
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
