/**
 * 卡片输出风格（"输出层主题"）—— 与编辑器主题刻意分离的两套体系。
 *
 * 为什么必须分离：编辑器主题解决的是「在软件里读起来舒服」，改的是 `--bg / --fg` 那套
 * CM6 变量；输出风格解决的是「导出去之后在别人手机里好看」，决定的是卡片容器的
 * 底色、纸感、边框、装饰、标题字体和代码配色。同一个用户在软件里可能用 Night 暗色，
 * 但导出的小红书卡片必须是浅色纸感——两者混在一套变量里必然互相绑架。
 *
 * 模型：**风格 = 一份 CSS + 一组变量**。约定 `.ly-card` 是唯一根节点，风格只允许
 * 覆盖变量（--c-bg / --c-fg / --c-accent / --c-line ...）与少量装饰伪元素，
 * 绝不改动布局盒模型。这样新增风格只需要往 STYLES 里加一条，分页与截图管线零改动。
 *
 * 全部样式为本项目原创（不复制任何第三方卡片的 CSS），仅工程结构上与常见
 * 「Markdown → 知识卡片」产品一致。
 */

export interface CardSize {
  id: string
  label: string
  labelEn: string
  /** 逻辑像素宽（CSS px），截图时按 scale 放大 */
  w: number
  h: number
  /** 输出倍率 */
  scale: number
}

/** 尺寸预设：逻辑尺寸按 96dpi 的"版面宽度"给，scale 只影响清晰度 */
export const CARD_SIZES: CardSize[] = [
  { id: 'xhs', label: '竖版 3:4', labelEn: 'Portrait 3:4', w: 540, h: 720, scale: 2 },
  { id: 'square', label: '方版 1:1', labelEn: 'Square 1:1', w: 540, h: 540, scale: 2 },
  { id: 'story', label: '长竖 9:16', labelEn: 'Story 9:16', w: 540, h: 960, scale: 2 },
  { id: 'a4', label: 'A4 纸', labelEn: 'A4', w: 595, h: 842, scale: 2 },
]

export interface CardStyle {
  id: string
  label: string
  labelEn: string
  dark?: boolean
  /** 风格主色，用于面板上的缩略色块 */
  swatch: [string, string]
}

/** 8 套内置输出风格（自研，非复制） */
export const CARD_STYLES: CardStyle[] = [
  { id: 'paper', label: '素纸', labelEn: 'Plain Paper', swatch: ['#ffffff', '#1f2328'] },
  { id: 'note', label: '便签', labelEn: 'Sticky Note', swatch: ['#fff6bf', '#6b5518'] },
  { id: 'magazine', label: '杂志', labelEn: 'Magazine', swatch: ['#fbf9f4', '#c0392b'] },
  { id: 'night', label: '暗夜', labelEn: 'Midnight', dark: true, swatch: ['#14161b', '#7ee0ff'] },
  { id: 'gradient', label: '渐变海报', labelEn: 'Gradient Poster', dark: true, swatch: ['#3b2f8f', '#ffb3c7'] },
  { id: 'typewriter', label: '打字机', labelEn: 'Typewriter', swatch: ['#f6f1e2', '#4a3f2a'] },
  { id: 'grid', label: '方格笔记', labelEn: 'Grid Note', swatch: ['#fdfdfa', '#2563a8'] },
  { id: 'ink', label: '水墨', labelEn: 'Ink Wash', swatch: ['#f7f4ec', '#2b2b2b'] },
]

export function findStyle(id: string): CardStyle {
  return CARD_STYLES.find((s) => s.id === id) ?? CARD_STYLES[0]
}

export function findSize(id: string): CardSize {
  return CARD_SIZES.find((s) => s.id === id) ?? CARD_SIZES[0]
}

/* ------------------------------------------------------------------ *
 * 基础排版骨架 —— 所有风格共用，风格只允许覆盖变量
 * ------------------------------------------------------------------ */
const BASE_CSS = `
.ly-card {
  --c-bg: #ffffff;
  --c-fg: #1f2328;
  --c-muted: #6b7280;
  --c-faint: #9aa2ad;
  --c-accent: #0969da;
  --c-line: #e5e7eb;
  --c-pad: 44px 40px 40px;
  --c-radius: 6px;
  --c-font: -apple-system, 'Segoe UI', 'Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', sans-serif;
  --c-head-font: var(--c-font);
  --c-mono: 'JetBrains Mono', Consolas, 'Courier New', monospace;
  --c-code-bg: #f6f8fa;
  --c-code-fg: #24292f;
  --c-quote-bg: transparent;
  --c-quote-line: #d0d7de;
  --c-mark: #fff3a3;
  --c-shadow: none;
  --c-border: 0;

  position: relative;
  box-sizing: border-box;
  width: var(--ly-card-w);
  height: var(--ly-card-h);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--c-bg);
  color: var(--c-fg);
  font-family: var(--c-font);
  font-size: 15px;
  line-height: 1.78;
  box-shadow: var(--c-shadow);
  border: var(--c-border);
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
  padding: var(--c-pad);
}

/* 内容页：页眉 / 正文 / 页脚 */
.ly-card .ly-head {
  flex: 0 0 auto;
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 14px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--c-line);
  font-size: 11.5px;
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
  margin-top: 12px;
  padding-top: 8px;
  font-size: 11px;
  color: var(--c-faint);
  border-top: 1px solid var(--c-line);
}
.ly-card .ly-foot .ly-page { margin-left: auto; font-variant-numeric: tabular-nums; }
.ly-card .ly-foot .ly-brand { letter-spacing: 0.12em; text-transform: uppercase; font-size: 9.5px; }

/* 封面页 */
.ly-card.ly-cover .ly-inner { justify-content: center; }
.ly-card .ly-kicker {
  display: inline-block;
  align-self: flex-start;
  margin-bottom: 16px;
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--c-accent);
  color: var(--c-on-accent, #fff);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.ly-card .ly-title {
  margin: 0 0 16px;
  font-family: var(--c-head-font);
  font-size: 34px;
  line-height: 1.3;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: var(--c-fg);
}
.ly-card .ly-sub {
  margin: 0;
  font-size: 14px;
  line-height: 1.75;
  color: var(--c-muted);
  max-height: 5.2em;
  overflow: hidden;
}
.ly-card .ly-cover-rule {
  width: 56px;
  height: 3px;
  margin: 22px 0 0;
  background: var(--c-accent);
  border-radius: 2px;
}
.ly-card .ly-meta {
  margin-top: 26px;
  font-size: 11.5px;
  color: var(--c-faint);
  display: flex;
  gap: 10px;
  align-items: center;
}

/* 正文排版 */
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
.ly-card hr { border: none; border-top: 1px solid var(--c-line); margin: 1.4em 0; }

.ly-card ul, .ly-card ol { margin: 0.7em 0; padding-left: 1.35em; }
.ly-card li { margin: 0.3em 0; }
.ly-card li::marker { color: var(--c-accent); }
.ly-card li.task { list-style: none; margin-left: -1.2em; }
.ly-card li.task input { margin-right: 0.4em; vertical-align: -0.08em; accent-color: var(--c-accent); }
.ly-card li.task.done { color: var(--c-muted); }

.ly-card blockquote {
  margin: 0.9em 0;
  padding: 0.55em 0 0.55em 0.9em;
  border-left: 3px solid var(--c-quote-line);
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
  color: var(--c-code-fg);
  padding: 0.12em 0.35em;
  border-radius: 3px;
}
.ly-card pre.ly-code {
  margin: 0.9em 0;
  padding: 12px 14px;
  background: var(--c-code-bg);
  color: var(--c-code-fg);
  border-radius: 6px;
  overflow: hidden;
  /* 超长行必须折行：卡片是定宽裁切容器，截断等于丢代码，折行至少信息完整 */
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 12.5px;
  line-height: 1.62;
  position: relative;
}
.ly-card pre.ly-code code { background: none; padding: 0; color: inherit; font-size: 1em; }
.ly-card pre.ly-code .ly-lang {
  position: absolute;
  top: 6px;
  right: 9px;
  font-size: 9.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--c-faint);
}
.ly-card .tok-com { color: var(--tok-com); font-style: italic; }
.ly-card .tok-str { color: var(--tok-str); }
.ly-card .tok-num { color: var(--tok-num); }
.ly-card .tok-kw  { color: var(--tok-kw); font-weight: 600; }
.ly-card .tok-fn  { color: var(--tok-fn); }

.ly-card table {
  width: 100%;
  margin: 0.9em 0;
  border-collapse: collapse;
  font-size: 0.9em;
}
.ly-card th, .ly-card td {
  border: 1px solid var(--c-line);
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
.ly-card .ly-math {
  margin: 0.8em 0;
  text-align: center;
  overflow: hidden;
}
.ly-card .katex { font-size: 1.02em; line-height: 1.3; }
.ly-card .katex-display { margin: 0.5em 0; }

/* 卡片内分栏：图片与正文并排的场景不做，保持单列，避免测量误差 */
`

/* ------------------------------------------------------------------ *
 * 8 套风格：只覆盖变量 + 装饰
 * ------------------------------------------------------------------ */
const STYLE_CSS: Record<string, string> = {
  /* 素纸：极简白 + 细黑线，最保险的通用款 */
  paper: `
.ly-card[data-style="paper"] {
  --c-bg: #ffffff;
  --c-fg: #1a1d21;
  --c-muted: #5b6470;
  --c-accent: #111418;
  --c-on-accent: #ffffff;
  --c-line: #e8eaed;
  --c-radius: 4px;
  --c-code-bg: #f7f8f9;
  --c-quote-line: #111418;
  --c-quote-bg: #fafbfc;
  --tok-com: #8b949e; --tok-str: #2f6f44; --tok-num: #9a3412; --tok-kw: #1a1d21; --tok-fn: #1d4ed8;
}
.ly-card[data-style="paper"] .ly-title { font-size: 36px; letter-spacing: -0.02em; }
.ly-card[data-style="paper"] .ly-kicker { background: #111418; border-radius: 2px; letter-spacing: 0.22em; }
`,

  /* 便签：黄色便签纸 + 左上折角 + 轻微胶带 */
  note: `
.ly-card[data-style="note"] {
  --c-bg: #fff8c9;
  --c-fg: #4a3d12;
  --c-muted: #7a6626;
  --c-faint: #a3904f;
  --c-accent: #b45309;
  --c-on-accent: #fffdf2;
  --c-line: #e7d98f;
  --c-radius: 3px;
  --c-code-bg: #fdf1b0;
  --c-code-fg: #4a3d12;
  --c-quote-line: #b45309;
  --c-quote-bg: #fff3ad;
  --c-mark: #ffe066;
  --c-shadow: 0 10px 24px rgba(120, 96, 20, 0.16);
  --tok-com: #a3904f; --tok-str: #6b7a1f; --tok-num: #b45309; --tok-kw: #7a3d00; --tok-fn: #8a5a00;
  --c-head-font: 'Segoe UI', 'Microsoft YaHei', sans-serif;
}
.ly-card[data-style="note"]::before {
  content: "";
  position: absolute;
  top: 0; right: 0;
  width: 46px; height: 46px;
  background: linear-gradient(225deg, #efe1a0 0%, #efe1a0 50%, #fff8c9 50%);
  box-shadow: -2px 2px 4px rgba(120, 96, 20, 0.14);
}
.ly-card[data-style="note"]::after {
  content: "";
  position: absolute;
  top: -10px; left: 50%;
  transform: translateX(-50%) rotate(-2.2deg);
  width: 96px; height: 26px;
  background: rgba(255, 255, 255, 0.52);
  border-left: 1px dashed rgba(160, 140, 80, 0.35);
  border-right: 1px dashed rgba(160, 140, 80, 0.35);
}
.ly-card[data-style="note"] .ly-title { color: #6b5518; font-size: 33px; }
.ly-card[data-style="note"] .ly-kicker { background: #b45309; }
`,

  /* 杂志：米白纸 + 衬线大标题 + 顶部红细线 */
  magazine: `
.ly-card[data-style="magazine"] {
  --c-bg: #fbf9f4;
  --c-fg: #16130f;
  --c-muted: #5c554b;
  --c-faint: #9b9285;
  --c-accent: #c0392b;
  --c-on-accent: #fffdf9;
  --c-line: #ddd6c9;
  --c-radius: 0;
  --c-code-bg: #f2ede2;
  --c-quote-line: #c0392b;
  --c-mark: #f6e0a8;
  --c-head-font: Georgia, 'Times New Roman', 'Songti SC', 'SimSun', serif;
  --tok-com: #9b9285; --tok-str: #4a6b3a; --tok-num: #a3541f; --tok-kw: #16130f; --tok-fn: #1f4e79;
}
.ly-card[data-style="magazine"]::before {
  content: "";
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 5px;
  background: #c0392b;
}
.ly-card[data-style="magazine"] .ly-title {
  font-size: 40px;
  line-height: 1.16;
  letter-spacing: -0.015em;
}
.ly-card[data-style="magazine"] .ly-kicker {
  background: transparent;
  color: #c0392b;
  padding: 0;
  border-radius: 0;
  border-bottom: 2px solid #c0392b;
  letter-spacing: 0.28em;
}
.ly-card[data-style="magazine"] .ly-head {
  border-bottom: 2px solid #16130f;
  color: #16130f;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}
.ly-card[data-style="magazine"] h2 { font-size: 1.36em; }
`,

  /* 暗夜：近黑底 + 青色强调 + 顶部光晕 */
  night: `
.ly-card[data-style="night"] {
  --c-bg: #14161b;
  --c-fg: #e6e9ef;
  --c-muted: #9aa3b2;
  --c-faint: #6b7484;
  --c-accent: #7ee0ff;
  --c-on-accent: #06202a;
  --c-line: #262a33;
  --c-radius: 8px;
  --c-code-bg: #1b1f27;
  --c-code-fg: #e6e9ef;
  --c-quote-line: #7ee0ff;
  --c-quote-bg: #191d24;
  --c-mark: #3f3a13;
  --tok-com: #6b7484; --tok-str: #a5e8a1; --tok-num: #ffab70; --tok-kw: #7ee0ff; --tok-fn: #c792ea;
}
.ly-card[data-style="night"]::before {
  content: "";
  position: absolute;
  top: -60px; left: -40px; right: -40px;
  height: 220px;
  background: radial-gradient(ellipse at 30% 0%, rgba(126, 224, 255, 0.18), transparent 62%);
}
.ly-card[data-style="night"] .ly-title { color: #f2f6ff; font-size: 35px; }
.ly-card[data-style="night"] img { border: 1px solid #262a33; }
`,

  /* 渐变海报：深紫蓝渐变 + 半透明玻璃卡 */
  gradient: `
.ly-card[data-style="gradient"] {
  --c-bg: linear-gradient(150deg, #2b1e5e 0%, #4a2f8f 46%, #8f4bb5 100%);
  --c-fg: #fdf7ff;
  --c-muted: #dcc9f0;
  --c-faint: #b9a4d6;
  --c-accent: #ffb3c7;
  --c-on-accent: #3a1b3f;
  --c-line: rgba(255, 255, 255, 0.18);
  --c-radius: 14px;
  --c-code-bg: rgba(12, 6, 28, 0.42);
  --c-code-fg: #f4ecff;
  --c-quote-line: #ffb3c7;
  --c-quote-bg: rgba(255, 255, 255, 0.08);
  --c-mark: rgba(255, 179, 199, 0.36);
  --tok-com: #b9a4d6; --tok-str: #a7f3c9; --tok-num: #ffd28a; --tok-kw: #ffb3c7; --tok-fn: #a5d8ff;
}
.ly-card[data-style="gradient"]::before {
  content: "";
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 84% 12%, rgba(255, 179, 199, 0.34), transparent 46%),
    radial-gradient(circle at 8% 92%, rgba(120, 200, 255, 0.28), transparent 52%);
}
.ly-card[data-style="gradient"] .ly-title {
  font-size: 36px;
  text-shadow: 0 2px 18px rgba(0, 0, 0, 0.25);
}
.ly-card[data-style="gradient"] .ly-kicker {
  background: rgba(255, 255, 255, 0.16);
  color: #ffe6ee;
  backdrop-filter: blur(4px);
}
.ly-card[data-style="gradient"] .ly-head,
.ly-card[data-style="gradient"] .ly-foot { border-color: rgba(255, 255, 255, 0.16); }
.ly-card[data-style="gradient"] blockquote { border-radius: 0 8px 8px 0; }
`,

  /* 打字机：米色打字纸 + 等宽字形 + 左侧装订孔 */
  typewriter: `
.ly-card[data-style="typewriter"] {
  --c-bg: #f6f1e2;
  --c-fg: #3b3325;
  --c-muted: #6e6350;
  --c-faint: #948872;
  --c-accent: #8a3b2e;
  --c-on-accent: #fbf6e8;
  --c-line: #d8cdb4;
  --c-radius: 2px;
  --c-code-bg: #ebe3cf;
  --c-code-fg: #3b3325;
  --c-quote-line: #8a3b2e;
  --c-mark: #e8d79a;
  --c-font: 'Courier New', 'Consolas', 'Songti SC', monospace;
  --c-head-font: 'Courier New', 'Consolas', 'Songti SC', monospace;
  --tok-com: #948872; --tok-str: #4a6b3a; --tok-num: #8a3b2e; --tok-kw: #3b3325; --tok-fn: #2b5470;
}
.ly-card[data-style="typewriter"]::before {
  content: "";
  position: absolute;
  top: 0; bottom: 0; left: 0;
  width: 26px;
  background:
    radial-gradient(circle at 13px 34px, #e2d8c0 0 5px, transparent 5.5px) 0 0 / 26px 72px repeat-y;
  border-right: 1px dashed #d8cdb4;
}
.ly-card[data-style="typewriter"] .ly-inner { padding-left: 52px; }
.ly-card[data-style="typewriter"] .ly-title {
  font-size: 30px;
  letter-spacing: 0.02em;
  text-transform: none;
}
.ly-card[data-style="typewriter"] .ly-kicker {
  background: transparent;
  color: #8a3b2e;
  border: 1px solid #8a3b2e;
  padding: 2px 8px;
  letter-spacing: 0.2em;
}
`,

  /* 方格笔记：淡蓝网格 + 蓝色标题 + 左侧色条 */
  grid: `
.ly-card[data-style="grid"] {
  --c-bg: #fdfdfa;
  --c-fg: #20242b;
  --c-muted: #5c6470;
  --c-faint: #98a1ad;
  --c-accent: #2563a8;
  --c-on-accent: #ffffff;
  --c-line: #dbe4ef;
  --c-radius: 5px;
  --c-code-bg: #eef4fb;
  --c-quote-line: #2563a8;
  --c-mark: #cfe6ff;
  --tok-com: #98a1ad; --tok-str: #2f6f44; --tok-num: #b45309; --tok-kw: #1e3f66; --tok-fn: #1d4ed8;
}
.ly-card[data-style="grid"]::before {
  content: "";
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(to right, rgba(37, 99, 168, 0.09) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(37, 99, 168, 0.09) 1px, transparent 1px);
  background-size: 24px 24px;
}
.ly-card[data-style="grid"]::after {
  content: "";
  position: absolute;
  top: 0; bottom: 0; left: 0;
  width: 6px;
  background: #2563a8;
}
.ly-card[data-style="grid"] .ly-inner { padding-left: 46px; }
.ly-card[data-style="grid"] .ly-title { font-size: 34px; }
`,

  /* 水墨：宣纸底 + 楷体 + 印章红 */
  ink: `
.ly-card[data-style="ink"] {
  --c-bg: #f7f4ec;
  --c-fg: #24211c;
  --c-muted: #5f584d;
  --c-faint: #8c8577;
  --c-accent: #9b2c1f;
  --c-on-accent: #fbf7ee;
  --c-line: #ddd6c6;
  --c-radius: 2px;
  --c-code-bg: #efeade;
  --c-quote-line: #9b2c1f;
  --c-mark: #f0e2b8;
  --c-font: 'Kaiti SC', 'KaiTi', 'STKaiti', 'Songti SC', 'SimSun', serif;
  --c-head-font: 'Kaiti SC', 'KaiTi', 'STKaiti', 'Songti SC', serif;
  --tok-com: #8c8577; --tok-str: #4c6b3c; --tok-num: #9b2c1f; --tok-kw: #24211c; --tok-fn: #2f4f6b;
}
.ly-card[data-style="ink"]::before {
  content: "";
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse at 78% 8%, rgba(155, 44, 31, 0.06), transparent 58%),
    radial-gradient(ellipse at 12% 96%, rgba(36, 33, 28, 0.05), transparent 54%);
}
.ly-card[data-style="ink"]::after {
  content: "";
  position: absolute;
  right: 26px; bottom: 26px;
  width: 34px; height: 34px;
  border-radius: 3px;
  background: #9b2c1f;
  opacity: 0.86;
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.34);
  transform: rotate(-3deg);
}
.ly-card[data-style="ink"] .ly-title {
  font-size: 36px;
  letter-spacing: 0.06em;
  font-weight: 700;
}
.ly-card[data-style="ink"] .ly-kicker {
  background: transparent;
  color: #9b2c1f;
  border: 1px solid #9b2c1f;
  border-radius: 1px;
  letter-spacing: 0.3em;
}
.ly-card[data-style="ink"] .ly-foot .ly-brand { font-family: var(--c-head-font); letter-spacing: 0.3em; }
`,
}

export function styleCss(id: string): string {
  return STYLE_CSS[id] ?? STYLE_CSS.paper
}

/** 完整样式表：基础骨架 + 8 套风格。截图前整份内联进 SVG，因此必须是自包含的 */
export const CARD_CSS = BASE_CSS + Object.values(STYLE_CSS).join('\n')
