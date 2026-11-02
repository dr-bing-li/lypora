/**
 * 国际化（i18n）运行时 —— 零依赖、可运行时切换、跟随系统。
 *
 * 设计要点：
 * 1. **键集合以 zh-CN 为唯一真源**：`Dict = typeof zhCN`，其它语言对象被赋值到这个类型上，
 *    少一个键 `npm run typecheck` 直接报错；多一个键类型系统查不出（结构类型只看"至少"），
 *    所以另有一道 `node i18n-check.mjs` 做双向比对 + 占位符比对。
 * 2. **扁平取值表在模块加载时构建一次**：`t()` 走的是对象查表 + 一次字符串替换，
 *    不进正则树、不做递归查找，编辑区每次按键都可能调它。
 * 3. **不做 DOM 观察**：切换语言时由调用方（main.ts）显式重绘，静态节点靠 `data-i18n`
 *    标记后调 `applyStaticDom()`。这样"哪里会变"是可数的，不会出现 MutationObserver 打架。
 * 4. **持久化只存偏好值**（`system` / 具体语言），不缓存解析结果：
 *    用户下次换系统语言时，"跟随系统"仍然生效。
 */

import zhCN from './locales/zh-CN'
import en from './locales/en'
import ja from './locales/ja'
import ko from './locales/ko'
import es from './locales/es'
import fr from './locales/fr'
import de from './locales/de'

/** 与 io/store.ts 的 `lypora:` 前缀保持一致；这里不引 store，是为了让本模块零依赖、可在 Node 里单测 */
const PREF_KEY = 'lypora:locale'

export type LocaleId = 'zh-CN' | 'en' | 'ja' | 'ko' | 'es' | 'fr' | 'de'
/** 用户偏好：具体语言，或跟随系统 */
export type LocalePref = LocaleId | 'system'

/** 字典类型：全部取自 zh-CN */
export type Dict = typeof zhCN
type Plural = { one: string; other: string }
type Msg = string | Plural

/** 把嵌套字典的叶子路径展开成 `'menu.file'` 这样的联合类型 */
type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends Msg
    ? P extends ''
      ? K
      : `${P}.${K}`
    : Leaves<T[K], P extends '' ? K : `${P}.${K}`>
}[keyof T & string]

export type MessageKey = Leaves<Dict>
export type MessageParams = Record<string, string | number>

/**
 * 语言注册表。
 * `native` 是语言自己的写法，**不翻译**——语言菜单里永远显示母语名，
 * 否则一个德语用户在看到 "German" 之前根本找不到自己那一项。
 */
export const LANGUAGES: ReadonlyArray<{ id: LocaleId; native: string }> = [
  { id: 'zh-CN', native: '简体中文' },
  { id: 'en', native: 'English' },
  { id: 'ja', native: '日本語' },
  { id: 'ko', native: '한국어' },
  { id: 'es', native: 'Español' },
  { id: 'fr', native: 'Français' },
  { id: 'de', native: 'Deutsch' },
]

const DICTS: Record<LocaleId, Dict> = {
  'zh-CN': zhCN,
  en,
  ja,
  ko,
  es,
  fr,
  de,
}

/** 兜底顺序：当前语言 → 英文 → 简体中文 → 键名本身（能把漏翻暴露在界面上，而不是显示空白） */
const FALLBACK_CHAIN: LocaleId[] = ['en', 'zh-CN']

export const DEFAULT_LOCALE: LocaleId = 'zh-CN'

/* ------------------------------------------------------------------ *
 * 扁平化
 * ------------------------------------------------------------------ */
type Flat = Map<string, Msg>

const flatCache = new Map<LocaleId, Flat>()

function flatten(obj: Record<string, unknown>, prefix: string, out: Flat): void {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') out.set(key, v)
    else if (v && typeof v === 'object' && 'one' in v && 'other' in v) out.set(key, v as Plural)
    else if (v && typeof v === 'object') flatten(v as Record<string, unknown>, key, out)
  }
}

function flat(locale: LocaleId): Flat {
  let f = flatCache.get(locale)
  if (!f) {
    f = new Map()
    flatten(DICTS[locale] as unknown as Record<string, unknown>, '', f)
    flatCache.set(locale, f)
  }
  return f
}

/** 某语言的全部键（供校验脚本与调试面板使用） */
export function keysOf(locale: LocaleId): string[] {
  return [...flat(locale).keys()].sort()
}

export function dictOf(locale: LocaleId): Record<string, Msg> {
  return Object.fromEntries(flat(locale))
}

/* ------------------------------------------------------------------ *
 * 当前语言
 * ------------------------------------------------------------------ */
let current: LocaleId = DEFAULT_LOCALE
let preference: LocalePref = 'system'
const listeners = new Set<(id: LocaleId) => void>()

/** 系统语言 → 支持的语言，按 `navigator.languages` 的先后顺序取第一个能匹配上的 */
export function resolveSystemLocale(): LocaleId {
  const tags: string[] =
    typeof navigator !== 'undefined' && Array.isArray(navigator.languages) && navigator.languages.length
      ? [...navigator.languages]
      : typeof navigator !== 'undefined' && navigator.language
        ? [navigator.language]
        : []

  for (const tag of tags) {
    const low = tag.toLowerCase()
    if (low.startsWith('zh')) return 'zh-CN' // 繁体、粤语等一并用简体资源（目前没有单独的 zh-TW 词条）
    const base = low.split('-')[0]
    const hit = LANGUAGES.find((l) => l.id === base)
    if (hit) return hit.id
  }
  return DEFAULT_LOCALE
}

export function getLocale(): LocaleId {
  return current
}

export function getLocalePreference(): LocalePref {
  return preference
}

export function isLocaleId(v: string): v is LocaleId {
  return LANGUAGES.some((l) => l.id === v)
}

/** 语言自身的名字（语言菜单与提示里用），不随界面语言变化 */
export function localeName(id: LocaleId): string {
  return LANGUAGES.find((l) => l.id === id)?.native ?? id
}

function readPref(): LocalePref {
  try {
    const raw = localStorage.getItem(PREF_KEY)
    if (!raw) return 'system'
    const v = JSON.parse(raw) as string
    if (v === 'system' || isLocaleId(v)) return v
    return 'system'
  } catch {
    return 'system'
  }
}

function applyDocumentLang(id: LocaleId): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = id
  // 中日韩需要用不同的字体栈（style.css 里按 [lang] 切换 --font-body 的兜底字族）
  document.documentElement.dataset.lang = id
}

/**
 * 启动时调用一次：读偏好 → 解析 → 设置 `<html lang>` → 刷静态文本。
 * 必须在任何 `t()` 之前跑（main.ts 里紧跟 migrateLegacySettings 之后）。
 */
export function initI18n(): LocaleId {
  preference = readPref()
  current = preference === 'system' ? resolveSystemLocale() : preference
  applyDocumentLang(current)
  return current
}

/** 切换语言。同语言重复调用是空操作（不会重复触发监听）。 */
export function setLocale(next: LocalePref): LocaleId {
  preference = next
  const resolved = next === 'system' ? resolveSystemLocale() : next
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(next))
  } catch {
    /* 隐私模式：本次会话内仍然生效 */
  }
  if (resolved === current) return current
  current = resolved
  applyDocumentLang(current)
  for (const cb of listeners) cb(current)
  return current
}

/** 订阅切语言事件；返回退订函数 */
export function onLocaleChange(cb: (id: LocaleId) => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/* ------------------------------------------------------------------ *
 * 取词
 * ------------------------------------------------------------------ */
function format(tpl: string, params?: MessageParams): string {
  if (!params) return tpl
  return tpl.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = params[name]
    return v === undefined ? whole : String(v)
  })
}

function lookup(key: string): Msg | undefined {
  const hit = flat(current).get(key)
  if (hit !== undefined) return hit
  for (const fb of FALLBACK_CHAIN) {
    const v = flat(fb).get(key)
    if (v !== undefined) return v
  }
  return undefined
}

/**
 * 取词。
 * `{name}` 占位由 params 替换；值是 `{one, other}` 时按 `params.n` 选型
 * （中日韩没有单复数变化，那三种语言里同一句话直接写两遍即可）。
 */
export function t(key: MessageKey, params?: MessageParams): string {
  const v = lookup(key)
  if (v === undefined) return key // 漏翻时把键名显示出来，比空白好定位
  if (typeof v === 'string') return format(v, params)
  const n = Number(params?.n ?? 0)
  return format(n === 1 ? v.one : v.other, params)
}

/** 存在性判断（只给校验脚本/调试用，业务代码不需要） */
export function has(key: string): boolean {
  return lookup(key) !== undefined
}

/* ------------------------------------------------------------------ *
 * 静态 DOM
 * ------------------------------------------------------------------ *
 * index.html 里给写死的文案加标记即可，不需要在 JS 里逐句 setTextContent：
 *   data-i18n="menu.file"         → textContent
 *   data-i18n-title="view.outline" → title（悬浮提示）
 *   data-i18n-aria="sidebar.collapse" → aria-label（读屏）
 */
export function applyStaticDom(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n as MessageKey
    const txt = t(key)
    if (el.textContent !== txt) el.textContent = txt
  })
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    el.title = t(el.dataset.i18nTitle as MessageKey)
  })
  root.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((el) => {
    el.setAttribute('aria-label', t(el.dataset.i18nAria as MessageKey))
  })
}
