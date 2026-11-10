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

export interface ParamSpec {
  path: string
  kind: ParamKind
  labelKey: string
  min?: number
  max?: number
  step?: number
  unit?: string
  options?: { value: string; labelKey?: string; label?: string }[]
}

export const TEXTURES = ['none', 'grain', 'grid', 'dots', 'ruled', 'fiber', 'halo', 'stripe'] as const
export const ACCENTS = ['none', 'left', 'top', 'corner'] as const
export const CORNERS = ['none', 'fold', 'round'] as const
export const COVERS = ['center', 'top', 'band'] as const

const enumOpts = (prefix: string, values: readonly string[]) =>
  values.map((v) => ({ value: v, labelKey: `${prefix}.${v}` }))

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

  /* 装饰 */
  { path: 'decor.texture', kind: 'select', labelKey: 'tpl.p.texture', options: enumOpts('tpl.tex', TEXTURES) },
  { path: 'decor.accent', kind: 'select', labelKey: 'tpl.p.accentMark', options: enumOpts('tpl.acc', ACCENTS) },
  { path: 'decor.corner', kind: 'select', labelKey: 'tpl.p.corner', options: enumOpts('tpl.corner', CORNERS) },
  { path: 'decor.cover', kind: 'select', labelKey: 'tpl.p.cover', options: enumOpts('tpl.cover', COVERS) },
  { path: 'decor.tape', kind: 'toggle', labelKey: 'tpl.p.tape' },
  { path: 'decor.stamp', kind: 'toggle', labelKey: 'tpl.p.stamp' },
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
