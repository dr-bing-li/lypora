/**
 * 参数表 —— 面板据此**自动生成控件**。
 *
 * 这是"模板可调整"能低成本落地的地方：12 套模板 × 12 个可调项，如果手写表单就是
 * 144 个控件要维护，改一个还要同步 12 遍。声明成数据后，加一套模板 = 加一条 JSON，
 * 参数面板自动就有了。
 *
 * 约束：path 只允许指向 tokens / metrics / decor / font 下的叶子字段；
 * 一切读写都走 getPath/setPath，不 eval、不拼属性访问字符串。
 */

import type { CardTemplate, ParamKind } from './types'
import { BINDINGS, BULLET_STYLES, FRAME_STYLES, QUOTE_STYLES, STAMP_POSITIONS, STAMP_PRESETS, TITLE_MARKS } from './types'

export interface ParamSpec {
  path: string
  kind: ParamKind
  labelKey: string
  min?: number
  max?: number
  step?: number
  unit?: string
  options?: { value: string; labelKey?: string; label?: string }[]
  /** text 类控件：占位提示键与最大长度 */
  placeholderKey?: string
  maxLength?: number
}

export const TEXTURES = ['none', 'grain', 'grid', 'dots', 'ruled', 'fiber', 'halo', 'stripe', 'perf'] as const
export const ACCENTS = ['none', 'left', 'top', 'corner'] as const
export const CORNERS = ['none', 'fold', 'round'] as const
export const COVERS = ['center', 'top', 'band'] as const
export const QUOTES = QUOTE_STYLES
export const BULLETS = BULLET_STYLES
export const TITLES = TITLE_MARKS
export const FRAMES = FRAME_STYLES
export const STAMPS = STAMP_PRESETS
export const STAMP_POS = STAMP_POSITIONS

const enumOpts = (prefix: string, values: readonly string[]) =>
  values.map((v) => ({ value: v, labelKey: `${prefix}.${v}` }))

/**
 * 背景底纹预设 → CSS 背景值。
 *
 * 为什么用 CSS 而不是 PNG/SVG 文件：
 *   ① 卡片最终要过 <foreignObject> 光栅化，CSS 渐变与 repeating-gradient 是
 *      浏览器排版引擎的原生能力，一定画得出来；外部图片多一条"解码失败就空白"的路径；
 *   ② 零文件、零请求、缩放不糊、导出天然内联，包体积一点都不涨。
 * 用户上传的图才走真实的 url(data:image/…)，见 compile.ts 的 buildBgVars。
 *
 * 放在 params 里而不是 compile 里：面板要拿同一份值画"预设缩略图"，
 * 两处各写一份必然漂移（用户选的和他看到的不一样）。
 */
export const BG_PREVIEW: Record<string, string> = {
  // 牛皮纸：光有斜纹是不够的（alpha 0.05 在白纸上量不出来，用户会认为没生效）。
  // 最底层加一层半透明牛皮色，白纸透出来是浅牛皮、牛皮纸模板（craft）透出来是深牛皮，
  // 既保证「看得出来」，又不把模板自己的纸色整块盖死。
  kraft:
    'repeating-linear-gradient(45deg, rgba(120, 92, 56, 0.075) 0 2px, transparent 2px 7px),' +
    'repeating-linear-gradient(-45deg, rgba(90, 68, 40, 0.06) 0 3px, transparent 3px 11px),' +
    'linear-gradient(rgba(214, 186, 142, 0.58), rgba(201, 170, 124, 0.62))',
  lined: 'repeating-linear-gradient(to bottom, rgba(70, 110, 190, 0.16) 0 1px, transparent 1px 28px)',
  grid:
    'linear-gradient(to right, rgba(0, 0, 0, 0.07) 1px, transparent 1px),' +
    'linear-gradient(to bottom, rgba(0, 0, 0, 0.07) 1px, transparent 1px)',
  // 1.1px / alpha 0.11 在 2× 出图里几乎看不出「点阵」，实际用户感知就是「没效果」。
  dots: 'radial-gradient(rgba(0, 0, 0, 0.17) 1.35px, transparent 1.4px)',
  watercolor:
    'radial-gradient(ellipse at 18% 12%, rgba(122, 170, 255, 0.20), transparent 54%),' +
    'radial-gradient(ellipse at 86% 82%, rgba(255, 158, 178, 0.18), transparent 50%),' +
    'radial-gradient(ellipse at 58% 44%, rgba(168, 240, 196, 0.14), transparent 46%)',
  paper:
    'repeating-linear-gradient(92deg, rgba(0, 0, 0, 0.035) 0 1px, transparent 1px 5px),' +
    'repeating-linear-gradient(2deg, rgba(0, 0, 0, 0.028) 0 1px, transparent 1px 7px)',
  // 网格柔光：三团大半径径向渐变叠出来的"现代 PPT 背景"，比纯色块有层次
  mesh:
    'radial-gradient(ellipse 62% 58% at 12% 8%, rgba(112, 160, 255, 0.30), transparent 60%),' +
    'radial-gradient(ellipse 58% 52% at 92% 18%, rgba(255, 138, 196, 0.26), transparent 62%),' +
    'radial-gradient(ellipse 70% 60% at 50% 108%, rgba(120, 232, 200, 0.24), transparent 58%)',
}

export const BG_PREVIEW_SIZE: Record<string, string> = {
  kraft: 'auto',
  lined: 'auto',
  grid: '24px 24px',
  dots: '16px 16px',
  watercolor: 'auto',
  paper: 'auto',
  mesh: 'auto',
}

export const PARAM_SPECS: ParamSpec[] = [
  /* 颜色 */
  { path: 'tokens.paper', kind: 'color', labelKey: 'tpl.p.paper' },
  { path: 'tokens.ink', kind: 'color', labelKey: 'tpl.p.ink' },
  { path: 'tokens.accent', kind: 'color', labelKey: 'tpl.p.accent' },
  { path: 'tokens.codeBg', kind: 'color', labelKey: 'tpl.p.codeBg' },

  /* 度量 */
  { path: 'metrics.fontSize', kind: 'number', labelKey: 'tpl.p.fontSize', min: 12, max: 22, step: 0.5, unit: 'px' },
  { path: 'metrics.lineHeight', kind: 'number', labelKey: 'tpl.p.lineHeight', min: 1.4, max: 2.2, step: 0.02 },
  { path: 'metrics.titleSize', kind: 'number', labelKey: 'tpl.p.titleSize', min: 22, max: 52, step: 1, unit: 'px' },
  { path: 'metrics.padX', kind: 'number', labelKey: 'tpl.p.padX', min: 16, max: 84, step: 2, unit: 'px' },
  { path: 'metrics.radius', kind: 'number', labelKey: 'tpl.p.radius', min: 0, max: 24, step: 1, unit: 'px' },

  /* 版面开关 */
  { path: 'metrics.headRule', kind: 'toggle', labelKey: 'tpl.p.headRule' },
  { path: 'metrics.pageNo', kind: 'toggle', labelKey: 'tpl.p.pageNo' },

  /* 页眉页脚文本（schema 4）：占位符 {doc} {sec} {date} {page} {total} */
  { path: 'metrics.headText', kind: 'text', labelKey: 'tpl.p.headText', placeholderKey: 'tpl.p.textHint', maxLength: 40 },
  { path: 'metrics.headSide', kind: 'text', labelKey: 'tpl.p.headSide', placeholderKey: 'tpl.p.textHint', maxLength: 40 },
  { path: 'metrics.footText', kind: 'text', labelKey: 'tpl.p.footText', placeholderKey: 'tpl.p.textHint', maxLength: 40 },

  /* 装饰 */
  { path: 'decor.texture', kind: 'select', labelKey: 'tpl.p.texture', options: enumOpts('tpl.tex', TEXTURES) },
  { path: 'decor.accent', kind: 'select', labelKey: 'tpl.p.accentMark', options: enumOpts('tpl.acc', ACCENTS) },
  { path: 'decor.corner', kind: 'select', labelKey: 'tpl.p.corner', options: enumOpts('tpl.corner', CORNERS) },
  { path: 'decor.cover', kind: 'select', labelKey: 'tpl.p.cover', options: enumOpts('tpl.cover', COVERS) },
  { path: 'decor.tape', kind: 'toggle', labelKey: 'tpl.p.tape' },
  { path: 'decor.stamp', kind: 'toggle', labelKey: 'tpl.p.stamp' },
  { path: 'decor.stampPreset', kind: 'select', labelKey: 'tpl.p.stampPreset', options: enumOpts('tpl.stamp', STAMPS) },
  { path: 'decor.stampPos', kind: 'select', labelKey: 'tpl.p.stampPos', options: enumOpts('tpl.pos', STAMP_POS) },
  { path: 'decor.stampSize', kind: 'number', labelKey: 'tpl.p.stampSize', min: 34, max: 140, step: 2, unit: 'px' },

  /* 排版风格（schema 4）：引用框 / 项目符号 / 标题装饰 / 外边框 */
  { path: 'decor.quote', kind: 'select', labelKey: 'tpl.p.quote', options: enumOpts('tpl.quote', QUOTES) },
  { path: 'decor.bullet', kind: 'select', labelKey: 'tpl.p.bullet', options: enumOpts('tpl.bullet', BULLETS) },
  { path: 'decor.title', kind: 'select', labelKey: 'tpl.p.title', options: enumOpts('tpl.title', TITLES) },
  { path: 'decor.frame', kind: 'select', labelKey: 'tpl.p.frame', options: enumOpts('tpl.frame', FRAMES) },

  /* 背景不透明度（bg 预设本身在面板里用缩略图按钮选，故不在这里占一行 select） */
  { path: 'decor.bgOpacity', kind: 'number', labelKey: 'tpl.p.bgOpacity', min: 0, max: 100, step: 5, unit: '%' },

  /* 装订 */
  { path: 'decor.binding', kind: 'select', labelKey: 'tpl.p.binding', options: enumOpts('tpl.bind', BINDINGS) },
]

/** 点路径读取（只看 tokens/metrics/decor 三层） */
export function getPath(t: CardTemplate, path: string): unknown {
  const parts = path.split('.')
  let cur: unknown = t
  for (const p of parts) {
    if (typeof cur !== 'object' || cur === null) return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return cur
}

/** 点路径写入，返回新对象（不改原对象，便于 React 式比对与撤销） */
export function setPath(t: CardTemplate, path: string, value: unknown): CardTemplate {
  const parts = path.split('.')
  const next = structuredClone(t)
  let cur: Record<string, unknown> = next as unknown as Record<string, unknown>
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]
    if (typeof cur[k] !== 'object' || cur[k] === null) return next
    cur = cur[k] as Record<string, unknown>
  }
  cur[parts[parts.length - 1]] = value
  return next
}
