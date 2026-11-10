/**
 * 模板的进出：校验（外部导入）与持久化（本地存储）。
 *
 * 安全底线：模板最终会被拼进 `<style>`，所以任何字符串字段都必须过白名单。
 * 一个 `}` 就能跳出变量块改写整页样式，所以颜色/字体字段一律按**语法形态**校验，
 * 而不是"看着像个颜色就行"。这是本模块存在的主要理由。
 */

import { TEMPLATE_SCHEMA, FONT_PRESETS, MONO_STACK, type CardTemplate, type TemplateDecor, type TemplateMetrics, type TemplateTokens } from './types'
import { ACCENTS, CORNERS, COVERS, TEXTURES } from './params'
import { BUILTIN_TEMPLATES, builtinById } from './builtin'

const KEY_CURRENT = 'lypora:beautify:template'
const KEY_USER = 'lypora:beautify:userTemplates'

/* ------------------------------------------------------------------ *
 * 白名单校验
 * ------------------------------------------------------------------ */

const NAMED_COLORS = new Set([
  'transparent', 'currentcolor', 'inherit', 'none', 'black', 'white',
  'red', 'green', 'blue', 'gray', 'grey', 'silver', 'navy', 'teal', 'olive',
  'maroon', 'purple', 'orange', 'gold', 'pink', 'brown', 'beige', 'ivory',
])

/** 只放行「颜色 / 渐变 / 投影 / 字体栈」这四类语法形态 */
export function sanitizeColor(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const s = input.trim()
  if (!s || s.length > 180) return null
  // 结构性字符一律拒绝：分号能结束声明，花括号能跳出规则，@ 能引入 at-rule
  if (/[;{}<>@\\]/.test(s)) return null
  if (/url\s*\(|expression\s*\(|javascript:/i.test(s)) return null
  if (NAMED_COLORS.has(s.toLowerCase())) return s
  if (/^#[0-9a-f]{3,8}$/i.test(s)) return s
  if (/^rgba?\(\s*[\d.\s,%]+\)$/i.test(s)) return s
  if (/^hsla?\(\s*[\d.\s,%deg]+\)$/i.test(s)) return s
  // 渐变：只允许 linear/radial + 颜色停靠点，字符集收紧到"颜色与标点"
  if (/^(linear|radial)-gradient\([#0-9a-z().,%\s-]+\)$/i.test(s)) return s
  // 投影：0 10px 24px rgba(...)
  if (/^[\d.\s a-z(),%-]+$/i.test(s) && /\d/.test(s)) return s
  return null
}

export function sanitizeFontStack(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const s = input.trim()
  if (!s || s.length > 220) return null
  if (/[;{}<>@\\]/.test(s)) return null
  if (/url\s*\(|expression\s*\(/i.test(s)) return null
  if (!/^[\w\s,'"\-]+$/.test(s)) return null
  return s
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function pickEnum<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
}

const RANGES = {
  padX: [16, 84] as const,
  padTop: [16, 120] as const,
  padBottom: [16, 100] as const,
  fontSize: [12, 22] as const,
  lineHeight: [1.4, 2.2] as const,
  radius: [0, 24] as const,
  titleSize: [22, 52] as const,
}

/**
 * 把任意 JSON 归一化成一份合法模板。
 * 缺字段用 fallback 补，超范围 clamp，非法字符串直接丢掉该字段（保留 fallback 值）。
 */
export function normalizeTemplate(raw: unknown, fallback: CardTemplate): CardTemplate {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const tk = (o.tokens && typeof o.tokens === 'object' ? o.tokens : {}) as Record<string, unknown>
  const mt = (o.metrics && typeof o.metrics === 'object' ? o.metrics : {}) as Record<string, unknown>
  const dc = (o.decor && typeof o.decor === 'object' ? o.decor : {}) as Record<string, unknown>
  const cd = (o.code && typeof o.code === 'object' ? o.code : {}) as Record<string, unknown>
  const ft = (o.font && typeof o.font === 'object' ? o.font : {}) as Record<string, unknown>

  const color = (k: keyof TemplateTokens) => sanitizeColor(tk[k]) ?? fallback.tokens[k]
  const tokens: TemplateTokens = {
    paper: color('paper'),
    ink: color('ink'),
    muted: color('muted'),
    faint: color('faint'),
    accent: color('accent'),
    onAccent: color('onAccent'),
    rule: color('rule'),
    codeBg: color('codeBg'),
    codeInk: color('codeInk'),
    quoteBg: color('quoteBg'),
    quoteRule: color('quoteRule'),
    mark: color('mark'),
    shadow: color('shadow'),
  }

  const metrics: TemplateMetrics = {
    padX: clampNum(mt.padX, ...RANGES.padX, fallback.metrics.padX),
    padTop: clampNum(mt.padTop, ...RANGES.padTop, fallback.metrics.padTop),
    padBottom: clampNum(mt.padBottom, ...RANGES.padBottom, fallback.metrics.padBottom),
    fontSize: clampNum(mt.fontSize, ...RANGES.fontSize, fallback.metrics.fontSize),
    lineHeight: clampNum(mt.lineHeight, ...RANGES.lineHeight, fallback.metrics.lineHeight),
    radius: clampNum(mt.radius, ...RANGES.radius, fallback.metrics.radius),
    titleSize: clampNum(mt.titleSize, ...RANGES.titleSize, fallback.metrics.titleSize),
    headRule: typeof mt.headRule === 'boolean' ? mt.headRule : fallback.metrics.headRule,
    pageNo: typeof mt.pageNo === 'boolean' ? mt.pageNo : fallback.metrics.pageNo,
    brand: typeof mt.brand === 'string' ? mt.brand.replace(/[<>{}]/g, '').slice(0, 24) : fallback.metrics.brand,
  }

  const decor: TemplateDecor = {
    texture: pickEnum(dc.texture, TEXTURES, fallback.decor.texture),
    accent: pickEnum(dc.accent, ACCENTS, fallback.decor.accent),
    corner: pickEnum(dc.corner, CORNERS, fallback.decor.corner),
    tape: typeof dc.tape === 'boolean' ? dc.tape : fallback.decor.tape,
    stamp: typeof dc.stamp === 'boolean' ? dc.stamp : fallback.decor.stamp,
    cover: pickEnum(dc.cover, COVERS, fallback.decor.cover),
  }

  const code = {
    com: sanitizeColor(cd.com) ?? fallback.code.com,
    str: sanitizeColor(cd.str) ?? fallback.code.str,
    num: sanitizeColor(cd.num) ?? fallback.code.num,
    kw: sanitizeColor(cd.kw) ?? fallback.code.kw,
    fn: sanitizeColor(cd.fn) ?? fallback.code.fn,
  }

  const font = {
    body: sanitizeFontStack(ft.body) ?? fallback.font.body,
    head: sanitizeFontStack(ft.head) ?? fallback.font.head,
    mono: sanitizeFontStack(ft.mono) ?? MONO_STACK,
  }

  const id = typeof o.id === 'string' && /^[a-z0-9][a-z0-9-]{1,31}$/.test(o.id) ? o.id : fallback.id
  const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 24) : fallback.name

  return {
    schema: TEMPLATE_SCHEMA,
    id,
    name,
    enName: typeof o.enName === 'string' ? o.enName.slice(0, 40) : fallback.enName,
    dark: typeof o.dark === 'boolean' ? o.dark : fallback.dark,
    tokens,
    metrics,
    decor,
    code,
    font,
  }
}

export interface ImportResult {
  ok: boolean
  template?: CardTemplate
  /** 被修正/丢弃的字段数，用来提示"这模板不太规范" */
  fixes?: number
  reason?: string
}

/** 导入外部模板：归一化 + id 去重 */
export function importTemplate(json: string, existingIds: string[]): ImportResult {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return { ok: false, reason: 'invalid-json' }
  }
  const base = BUILTIN_TEMPLATES[0]
  const t = normalizeTemplate(raw, base)
  if (t.id === base.id && !(raw as { id?: string })?.id) {
    // 没有 id 的一律视为非法模板，避免"导入了一个素纸"
    if (!(raw as { tokens?: unknown })?.tokens) return { ok: false, reason: 'missing-fields' }
  }
  // id 与内置或已导入的冲突 → 加后缀，绝不覆盖
  const taken = new Set([...BUILTIN_TEMPLATES.map((x) => x.id), ...existingIds])
  if (taken.has(t.id)) t.id = `${t.id}-${Date.now().toString(36).slice(-4)}`
  return { ok: true, template: t }
}

export function exportTemplate(t: CardTemplate): string {
  return JSON.stringify({ ...t, exportedAt: new Date().toISOString(), app: 'Lypora' }, null, 2)
}

/* ------------------------------------------------------------------ *
 * 持久化
 * ------------------------------------------------------------------ */

export function loadCurrent(): CardTemplate {
  try {
    const raw = localStorage.getItem(KEY_CURRENT)
    if (!raw) return BUILTIN_TEMPLATES[0]
    const parsed = JSON.parse(raw) as CardTemplate
    const base = builtinById(parsed.id)
    return normalizeTemplate(parsed, base)
  } catch {
    return BUILTIN_TEMPLATES[0]
  }
}

export function saveCurrent(t: CardTemplate): void {
  try {
    localStorage.setItem(KEY_CURRENT, JSON.stringify(t))
  } catch {
    /* 配额满不影响本次导出 */
  }
}

export function listUserTemplates(): CardTemplate[] {
  try {
    const raw = localStorage.getItem(KEY_USER)
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.map((x) => normalizeTemplate(x, BUILTIN_TEMPLATES[0])).filter((t) => !!t)
  } catch {
    return []
  }
}

export function saveUserTemplates(list: CardTemplate[]): void {
  try {
    localStorage.setItem(KEY_USER, JSON.stringify(list.slice(0, 40)))
  } catch {
    /* 忽略 */
  }
}

export function fontPresetId(t: CardTemplate): string {
  const hit = FONT_PRESETS.find((f) => f.body === t.font.body)
  return hit ? hit.id : 'sans'
}
