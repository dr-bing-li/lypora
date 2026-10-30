/**
 * 第三方主题适配层 —— 把「外部编辑器格式的主题 CSS」转译到本项目的 DOM/变量空间。
 *
 * 本模块只做**格式翻译**：输入是用户自己提供的 .css 文本，输出是等价的、针对本项目
 * 选择器的 CSS。不含任何来自第三方产品的代码、样式表或资源，也没有读取过对方源码。
 * 为兼容存量主题，文件里出现的 `#typora-source` / `#typora-sidebar` 等字符串是**对方
 * DOM 的 id 字面量**（用来在用户提供的 CSS 里匹配），不是本项目的元素。
 *
 * 为什么需要这一层：
 *   这类主题是按参考实现的渲染 DOM 写的：
 *     - 变量名是 --bg-color / --text-color / --accent-color / --code-fence-bg-color …
 *     - 选择器是 #write h1 / #write p / .md-fences / blockquote / table …
 *   本项目的正文是 CM6 的 .cm-content + 每行一个 .cm-line（带装饰类），
 *   变量名是 --bg / --fg / --accent / --code-bg …
 *   直接把主题 CSS 注入进来，**变量名对不上、选择器一条也不命中**，
 *   于是"导入成功但界面毫无变化"。这不是注入失败，是命名空间不兼容。
 *
 * 转译做三件事：
 *   1) 选择器映射：#write → .editor-host，h1..h6 → .cm-line.md-line-hN，
 *      p → .cm-line.md-p，.md-fences → .cm-line.md-code-line …
 *   2) 变量桥接：把主题 --root 里的外部变量摘出来，按映射写成我们的变量；
 *      主题没定义的（如 --bg-side）用 color-mix 从主色推导，保证侧栏/状态栏不发白。
 *   3) 版面保护：行级选择器上丢掉 margin/width/position 这类会破坏 CM6 行盒测量的
 *      声明（只保留横向内边距），#write 的 max-width 转成 --content-width
 *      （这样"显示 → 页面宽度"仍然能覆盖主题宽度）。
 */

export interface ThemeStats {
  /** 是否识别为第三方（参考实现）主题格式：有 #write 或 --bg-color 那套变量名 */
  foreign: boolean
  rules: number
  kept: number
  dropped: number
  vars: number
  /** 从 #write{max-width} 摘到的版心宽度 */
  width?: string
}

export interface TranslateResult {
  css: string
  stats: ThemeStats
}

type Kind = 'line' | 'host' | 'other'

/* ------------------------------------------------------------------ *
 * 选择器映射表
 * ------------------------------------------------------------------ */

/** 裸标签 → 本项目选择器（顺序无关） */
const TAG_MAP: Record<string, string> = {
  h1: '.cm-line.md-line-h1',
  h2: '.cm-line.md-line-h2',
  h3: '.cm-line.md-line-h3',
  h4: '.cm-line.md-line-h4',
  h5: '.cm-line.md-line-h5',
  h6: '.cm-line.md-line-h6',
  p: '.cm-line.md-p',
  li: '.cm-line.md-li',
  ul: '.cm-line.md-li',
  ol: '.cm-line.md-li',
  dl: '.cm-line.md-li',
  dt: '.cm-line.md-li',
  dd: '.cm-line.md-li',
  blockquote: '.cm-line.md-quote-line',
  pre: '.cm-line.md-code-line',
  __PRE_CODE__: '.cm-line.md-code-line',
  code: '.md-code-inline',
  tt: '.md-code-inline',
  a: '.md-link',
  strong: '.md-strong',
  b: '.md-strong',
  em: '.md-em',
  i: '.md-em',
  del: '.md-strike',
  s: '.md-strike',
  strike: '.md-strike',
  // 注意：项目的 .md-mark 是"语法标记变淡"的类，==高亮== 用的是 .md-hl，
  // 别把 mark 映射到 .md-mark（会把 # 号标记涂成高亮块，已踩过）
  mark: '.md-hl',
  hr: '.cm-hr-widget hr',
  img: '.cm-img-widget img',
  table: '.cm-table-widget table',
  thead: '.cm-table-widget thead',
  tbody: '.cm-table-widget tbody',
  tfoot: '.cm-table-widget tfoot',
  tr: '.cm-table-widget tr',
  th: '.cm-table-widget th',
  td: '.cm-table-widget td',
  input: '.cm-task-box',
  content: '.cm-content',
}

/** 类名映射 */
const CLASS_MAP: Record<string, string> = {
  'md-fences': '.cm-line.md-code-line',
  'md-fences-adv-panel': '.cm-lang-label',
  'md-task-list-item': '.cm-line.md-li',
  'task-list-item': '.cm-line.md-li',
  'md-task-list': '.cm-line.md-li',
  'task-list': '.cm-line.md-li',
  'md-image': '.cm-img-widget',
  'md-math-block': '.cm-math-block',
  'md-inline-math': '.cm-math-inline',
  'md-para': '.cm-line.md-p',
  'md-heading': '.cm-line',
}

/** 这些类/ID 在本项目里没有对应物，命中它们的规则直接丢弃（避免污染） */
const DROP_CLASS = [
  'md-toc',
  'md-toc-content',
  'md-toc-item',
  'md-toc-inner',
  'md-toc-h1',
  'md-toc-h2',
  'md-toc-h3',
  'md-toc-h4',
  'md-toc-h5',
  'md-toc-h6',
  'md-alert',
  'footnotes-area',
  'md-def-footnote',
  'md-footnote',
  'md-search-hit',
  'md-search-panel',
  'typora-export',
  'on-focus-mode',
  'md-rawblock',
  'md-meta',
  'md-expand',
  'code-tooltip',
  'md-focus',
  'md-focus-container',
  'sidebar-content',
  'sidebar-tabs',
  'sidebar-footer',
  'sidebar-menu',
  'outline-item',
  'info-panel-tab',
  'megamenu',
  'dropdown-menu',
  'auto-suggest',
  'md-hover-popup',
  'md-emoji',
  'CodeMirror',
]

const DROP_ID = [
  'typora-sidebar',
  'toc-dropmenu',
  'top-titlebar',
  'wobble-menu',
  'md-searchpanel',
  'footer-word-count',
  'outline-content',
  'file-library',
  'spell-check',
  'md-notification',
]

/** 骨架标签：主题里的 header/footer/aside 是给参考实现自己的界面元素写的，
 *  但我们的菜单栏/侧栏/状态栏恰好也是这三个标签，直接放过去会把骨架涂成
 *  主题的侧栏色（曾出现 green-swiss 的米白页面 + 深蓝菜单栏）。
 *  文档区域里不会出现这些标签，所以整段丢掉最安全。 */
const CHROME_TAGS = new Set(['header', 'footer', 'aside', 'nav', 'section', 'main'])

/* ------------------------------------------------------------------ *
 * 变量桥接表
 * ------------------------------------------------------------------ */

/** 外部主题变量 → 本项目变量（按优先级排列，先命中先得） */
const VAR_MAP: Record<string, string[]> = {
  // 有的主题（green-swiss 等）直接用 --bg / --paper-bg 命名页面底色
  '--bg': ['--bg-color', '--window-bg-color', '--background-color', '--bg', '--paper-bg', '--page-bg'],
  '--fg': ['--text-color', '--body-text-color', '--text-primary-color', '--text'],
  '--bg-side': ['--side-bar-bg-color', '--bg-color-dark', '--sidebar-bg-color'],
  '--fg-muted': ['--secondary-text-color', '--text-muted', '--meta-content-color', '--secondary-text'],
  '--fg-faint': ['--md-char-color'],
  '--accent': ['--accent-color', '--primary-color', '--link-color', '--active-file-border-color'],
  '--sel': ['--select-text-bg-color'],
  '--mark-bg': ['--text-highlight-bg'],
  '--code-bg': ['--code-fence-bg-color', '--code-bg-color'],
  '--code-fg': ['--code-fence-text-color', '--code-text-color', '--code-color'],
  '--quote-fg': ['--blockquote-text-color', '--quote-text-color'],
  '--quote-bar': ['--blockquote-accent-color', '--blockquote-border-color', '--quote-border-color'],
  '--border': ['--table-border-color', '--border-color', '--window-border'],
  '--font-body': ['--font-family', '--font-body', '--sans-serif'],
  '--font-mono': ['--monospace', '--font-mono'],
  '--font-head': ['--font-heading', '--heading-font-family', '--serif'],
  '--content-line-height': ['--base-line-height', '--line-height'],
  '--content-font-size': ['--base-font-size', '--font-size'],
}

/** 主题没给、但界面确实需要的变量：从主色推导 */
const DERIVED: Record<string, string> = {
  '--bg-elev': 'color-mix(in srgb, var(--bg) 94%, var(--fg))',
  '--bg-side': 'color-mix(in srgb, var(--bg) 96%, var(--fg))',
  '--fg-muted': 'color-mix(in srgb, var(--fg) 62%, var(--bg))',
  '--fg-faint': 'color-mix(in srgb, var(--fg) 36%, var(--bg))',
  '--border': 'color-mix(in srgb, var(--fg) 18%, var(--bg))',
  '--border-soft': 'color-mix(in srgb, var(--fg) 10%, var(--bg))',
  '--code-bg': 'color-mix(in srgb, var(--fg) 6%, var(--bg))',
  '--code-fg': 'var(--fg)',
  '--quote-fg': 'color-mix(in srgb, var(--fg) 72%, var(--bg))',
  '--quote-bar': 'color-mix(in srgb, var(--fg) 22%, var(--bg))',
  '--sel': 'color-mix(in srgb, var(--accent) 30%, var(--bg))',
  '--accent-soft': 'color-mix(in srgb, var(--accent) 12%, var(--bg))',
  '--mark-bg': 'color-mix(in srgb, #f3d060 55%, var(--bg))',
}

/* ------------------------------------------------------------------ *
 * 声明过滤：行级元素上不能留会破坏 CM6 行盒的盒模型声明
 * ------------------------------------------------------------------ */

const LINE_DROP = new Set([
  'margin',
  'margin-top',
  'margin-bottom',
  'margin-left',
  'margin-right',
  'margin-block',
  'margin-inline',
  'width',
  'height',
  'min-width',
  'max-width',
  'min-height',
  'max-height',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'inset',
  'float',
  'display',
  'overflow',
  'overflow-x',
  'overflow-y',
  'flex',
  'flex-direction',
  'flex-wrap',
  'align-items',
  'justify-content',
  'gap',
  'grid',
  'grid-template-columns',
  'z-index',
  'transform',
  'content',
  'box-shadow',
])

const HOST_DROP = new Set([
  'max-width',
  'width',
  'min-height',
  'max-height',
  'height',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'float',
  'display',
  'overflow',
  'overflow-x',
  'overflow-y',
  'margin',
  'margin-left',
  'margin-right',
  'margin-top',
  'margin-bottom',
  'transform',
])

/* ------------------------------------------------------------------ *
 * 工具
 * ------------------------------------------------------------------ */

function splitTop(s: string, sep: string): string[] {
  const out: string[] = []
  let depth = 0
  let quote: string | null = null
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quote) {
      cur += c
      if (c === '\\') {
        cur += s[++i] ?? ''
        continue
      }
      if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      cur += c
      continue
    }
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth = Math.max(0, depth - 1)
    if (c === sep && depth === 0) {
      out.push(cur)
      cur = ''
      continue
    }
    cur += c
  }
  if (cur.trim()) out.push(cur)
  return out
}

interface Decl {
  prop: string
  value: string
  important: boolean
}

function parseDecls(body: string): Decl[] {
  const out: Decl[] = []
  // 注释必须先剥掉：主题里的 ":root { /* 说明 */ --bg-color: #fff }" 会让
  // 首个声明被并进注释文本，变量采不到（曾因此 --bg 整条丢桥）
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const raw of splitTop(clean, ';')) {
    const i = raw.indexOf(':')
    if (i < 0) continue
    const prop = raw.slice(0, i).trim().toLowerCase()
    if (!prop) continue
    let value = raw.slice(i + 1).trim()
    let important = false
    if (/!\s*important\s*$/i.test(value)) {
      important = true
      value = value.replace(/!\s*important\s*$/i, '').trim()
    }
    if (!value) continue
    out.push({ prop, value, important })
  }
  return out
}

/** 把 padding 简写拆成横向内边距（行级元素只保留横向，纵向交给本项目的版式节奏） */
function horizontalPadding(value: string): { left?: string; right?: string } {
  const parts = value.split(/\s+/)
  if (parts.length === 1) return {}
  if (parts.length === 2) return { left: parts[1], right: parts[1] }
  return { left: parts[3], right: parts[1] }
}

function toCss(decls: Decl[]): string {
  return decls.map((d) => `${d.prop}: ${d.value}${d.important ? ' !important' : ''}`).join('; ')
}

/* ------------------------------------------------------------------ *
 * 选择器
 * ------------------------------------------------------------------ */

interface Comp {
  tag: string | null
  ids: string[]
  classes: string[]
  attrs: string[]
  pseudos: string[]
}

const TOKEN_RE = /#([\w-]+)|\.([\w-]+)|(\[[^\]]*\])|(::?[\w-]+(?:\([^()]*\))?)|([a-zA-Z][\w-]*|\*)/g

function parseCompound(s: string): Comp {
  const comp: Comp = { tag: null, ids: [], classes: [], attrs: [], pseudos: [] }
  TOKEN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TOKEN_RE.exec(s))) {
    if (m[1]) comp.ids.push(m[1])
    else if (m[2]) comp.classes.push(m[2])
    else if (m[3]) comp.attrs.push(m[3])
    else if (m[4]) comp.pseudos.push(m[4])
    else if (m[5]) comp.tag = m[5]
  }
  return comp
}

function mapCompound(raw: string): string[] | null {
  const c = parseCompound(raw)
  // 丢弃：本项目没有对应物的侧栏 / 大纲 / 搜索面板选择器
  for (const id of c.ids) if (DROP_ID.includes(id)) return null
  for (const cls of c.classes) if (DROP_CLASS.includes(cls)) return null
  // 丢弃：裸骨架标签（header/footer/aside…），防止主题误伤我们的界面骨架
  if (c.tag && CHROME_TAGS.has(c.tag) && !c.ids.length && !c.classes.length) return null

  const head: string[] = []
  for (const id of c.ids) {
    if (id === 'write') head.push('.editor-host')
    else if (id === 'typora-source') head.push('.cm-content')
    else head.push(`#${id}`)
  }
  if (c.tag) {
    if (c.tag === '*') head.push('*')
    else if (TAG_MAP[c.tag]) head.push(TAG_MAP[c.tag])
    else head.push(c.tag)
  }
  let tail = ''
  const seenCls = new Set<string>()
  const headStr = head.join('')
  for (const cls of c.classes) {
    if (seenCls.has(cls)) continue
    seenCls.add(cls)
    const mappedCls = CLASS_MAP[cls]
    // pre.md-fences 这类会把同一个目标写两遍，去重后再拼
    if (mappedCls && (tail.includes(mappedCls) || headStr.includes(mappedCls))) continue
    tail += mappedCls ?? `.${cls}`
  }
  // 任务框是 span，不会带 type 属性，属性选择器一并清掉
  if (c.tag !== 'input') for (const a of c.attrs) tail += a
  for (const p of c.pseudos) tail += p

  if (!head.length) head.push('')
  return head.map((h) => h + tail)
}

function splitSelector(sel: string): { comb: string; compound: string }[] {
  const out: { comb: string; compound: string }[] = []
  let cur = ''
  let comb = ''
  for (const ch of sel) {
    if (ch === '>' || ch === '+' || ch === '~') {
      if (cur) {
        out.push({ comb, compound: cur })
        cur = ''
      }
      comb = ch
      continue
    }
    if (/\s/.test(ch)) {
      if (cur) {
        out.push({ comb, compound: cur })
        cur = ''
        comb = ''
      }
      continue
    }
    cur += ch
  }
  if (cur) out.push({ comb, compound: cur })
  return out
}

interface MappedSel {
  sels: string[]
  kind: Kind
}

const MAX_VARIANTS = 12

/**
 * 本项目是**扁平行模型**：引用、列表的正文就在同一行里，没有参考实现那种嵌套的
 * `<blockquote><p>` / `<ul><li><p>`。所以 `blockquote p` 要合并成
 * `.cm-line.md-quote-line.md-p`，否则 "后代的 p" 永远找不到。
 */
function mergeLineCompounds(sel: string): string {
  const isPlainClassCompound = (s: string) => /^(?:\.[\w-]+)+$/.test(s)
  const seq = splitSelector(sel)
  const out: { comb: string; compound: string }[] = []
  for (const item of seq) {
    const prev = out[out.length - 1]
    const canMerge =
      prev &&
      !item.comb &&
      isPlainClassCompound(prev.compound) &&
      isPlainClassCompound(item.compound) &&
      prev.compound.includes('.cm-line') &&
      item.compound.includes('.cm-line')
    if (canMerge) {
      const merged = new Set<string>()
      for (const part of `${prev.compound}${item.compound}`.match(/\.[\w-]+/g) ?? []) merged.add(part)
      prev.compound = [...merged].join('')
      continue
    }
    out.push({ ...item })
  }
  return out.map((o, i) => (i === 0 ? o.compound : `${o.comb ? ` ${o.comb} ` : ' '}${o.compound}`)).join('')
}

export function mapSelector(selector: string): MappedSel | null {
  let s = selector.trim()
  if (!s) return null
  // pre code / pre > code 是"代码块里的代码"，不是行内代码
  s = s.replace(/\bpre\s*>\s*(?:code|tt)\b/g, '__PRE_CODE__')
  s = s.replace(/\bpre\s+(?:code|tt)\b/g, '__PRE_CODE__')

  const seq = splitSelector(s)
  if (!seq.length) return null

  let variants: string[][] = [[]]
  for (const { comb, compound } of seq) {
    const mapped = mapCompound(compound)
    if (!mapped) return null
    const next: string[][] = []
    for (const prefix of variants) {
      for (const m of mapped) next.push([...prefix, (comb ? ` ${comb} ` : prefix.length ? ' ' : '') + m])
    }
    variants = next.slice(0, MAX_VARIANTS)
  }

  const sels = variants.map((v) => mergeLineCompounds(v.join('').trim()))
  const kind: Kind = sels.some((x) => x.includes('.editor-host'))
    ? 'host'
    : sels.some((x) => x.includes('.cm-line'))
      ? 'line'
      : 'other'
  return { sels, kind }
}

/* ------------------------------------------------------------------ *
 * 转译主流程
 * ------------------------------------------------------------------ */

interface Ctx {
  rules: number
  kept: number
  dropped: number
  vars: Record<string, string>
  width?: string
}

function translateRule(prelude: string, body: string, ctx: Ctx, depth: number): string | null {
  const decls = parseDecls(body)
  if (!decls.length) return null

  const parts = splitTop(prelude, ',')
  const sels: string[] = []
  let hostExact = false

  for (const part of parts) {
    const mapped = mapSelector(part)
    if (!mapped) continue
    if (mapped.sels.some((s) => s === '.editor-host')) hostExact = true
    for (const s of mapped.sels) if (!sels.includes(s)) sels.push(s)
  }
  if (!sels.length) return null

  // 行级 / 页面级分开处理：`.editor-host .cm-line.xxx` 仍然是"行"，
  // 只有选择器正好是 `.editor-host` 时才按页面容器处理（曾把行当成页面，
  // 结果 margin 全被放过、行盒被撑变形）
  const kind: Kind = sels.some((s) => s.includes('.cm-line'))
    ? 'line'
    : hostExact
      ? 'host'
      : 'other'

  // #write{max-width} → 版心宽度变量（保留"显示 → 页面宽度"的最终控制权）
  if (hostExact && depth === 0) {
    const mw = decls.find((d) => d.prop === 'max-width')
    if (mw) {
      // 有的主题写 max-width: var(--a4-width)，先在主题自己的变量里解析一层
      const raw = /^var\(/.test(mw.value) ? resolveVar(mw.value, ctx.vars) : mw.value
      if (/^[\d.]+(px|cm|mm|in|pt|em|rem|ch)?$/.test(raw)) ctx.width = raw
    }
  }

  const kept: Decl[] = []
  for (const d of decls) {
    if (kind === 'host' && HOST_DROP.has(d.prop)) continue
    if (kind === 'line') {
      if (d.prop === 'padding') {
        const h = horizontalPadding(d.value)
        if (h.left) kept.push({ prop: 'padding-left', value: h.left, important: d.important })
        if (h.right) kept.push({ prop: 'padding-right', value: h.right, important: d.important })
        continue
      }
      if (d.prop === 'padding-top' || d.prop === 'padding-bottom') continue
      if (LINE_DROP.has(d.prop)) continue
      // 行级元素不设背景图以外的装饰性伪内容已由 content 过滤掉
      if (d.prop.startsWith('margin')) continue
    }
    kept.push(d)
  }
  if (!kept.length) return null
  ctx.kept++
  return `${sels.join(', ')} { ${toCss(kept)} }`
}

function translateRules(src: string, ctx: Ctx, ruleDepth = 0): string {
  let out = ''
  let i = 0
  const n = src.length
  while (i < n) {
    // 跳过空白与注释
    for (;;) {
      const c = src[i]
      if (c === undefined) break
      if (c === ' ' || c === '\n' || c === '\t' || c === '\r') {
        i++
        continue
      }
      if (c === '/' && src[i + 1] === '*') {
        const end = src.indexOf('*/', i + 2)
        i = end < 0 ? n : end + 2
        continue
      }
      break
    }
    if (i >= n) break

    // 读前导（选择器或 at-rule）
    let j = i
    let paren = 0
    let quote: string | null = null
    while (j < n) {
      const c = src[j]
      if (quote) {
        if (c === '\\') {
          j += 2
          continue
        }
        if (c === quote) quote = null
        j++
        continue
      }
      if (c === '"' || c === "'") {
        quote = c
        j++
        continue
      }
      if (c === '(') paren++
      else if (c === ')') paren = Math.max(0, paren - 1)
      else if ((c === '{' || c === ';') && paren === 0) break
      j++
    }
    if (j >= n) break
    const prelude = src.slice(i, j).trim()
    if (src[j] === ';') {
      out += `${prelude};\n`
      i = j + 1
      continue
    }

    // 读块体（配平大括号）
    let k = j + 1
    let brace = 1
    quote = null
    while (k < n && brace > 0) {
      const c = src[k]
      if (quote) {
        if (c === '\\') {
          k += 2
          continue
        }
        if (c === quote) quote = null
        k++
        continue
      }
      if (c === '"' || c === "'") {
        quote = c
        k++
        continue
      }
      if (c === '{') brace++
      else if (c === '}') brace--
      k++
    }
    const body = src.slice(j + 1, k - 1)
    i = k
    if (!prelude) continue

    if (prelude.startsWith('@')) {
      if (/^@(media|supports|layer|container|document)\b/i.test(prelude)) {
        out += `${prelude} {\n${translateRules(body, ctx, ruleDepth + 1)}}\n`
      } else {
        // @font-face / @keyframes / @page 原样保留
        out += `${prelude} {${body}}\n`
      }
      continue
    }

    ctx.rules++
    const rule = translateRule(prelude, body, ctx, ruleDepth)
    if (!rule) {
      ctx.dropped++
      continue
    }
    out += `${rule}\n`
  }
  return out
}

/* ------------------------------------------------------------------ *
 * 变量采集与桥接
 * ------------------------------------------------------------------ */

function collectVars(src: string): Record<string, string> {
  const vars: Record<string, string> = {}
  const re = /(?:^|[\s,}])(:root|html)\s*(?:,\s*html\s*)?\{([^}]*)\}/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    for (const d of parseDecls(m[2])) {
      if (d.prop.startsWith('--')) vars[d.prop] = d.value
    }
  }
  return vars
}

function resolveVar(value: string, vars: Record<string, string>, depth = 0): string {
  if (depth > 4) return value
  const replaced = value.replace(
    /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g,
    (_m, name: string, fallback?: string) => {
      const v = vars[name]
      if (v != null) return resolveVar(v, vars, depth + 1)
      // 采不到就保留引用本身：主题自己的 :root 还在，运行期仍能解析；
      // 早先直接替换成空串，导致 --border 收到 "1px solid" 这种残值
      return fallback != null ? fallback.trim() : `var(${name})`
    },
  )
  return replaced.trim()
}

/* ------------------------------------------------------------------ *
 * 颜色工具：骨架配色的对比度守卫
 *   主题只负责"文档长什么样"，但 --bg-side 常常是深色（参考实现的侧栏就是深蓝），
 *   而 --text-color 是给正文（浅底）用的深色字。直接把 --fg 用到侧栏上就会出现
 *   深底深字（green-swiss 实测 1.42:1，几乎不可读）。所以骨架文字单独算。
 * ------------------------------------------------------------------ */

type RGB = [number, number, number]

function parseColor(v: string | undefined | null): RGB | null {
  if (!v) return null
  const s = v.trim().toLowerCase()
  if (s === 'white') return [255, 255, 255]
  if (s === 'black') return [0, 0, 0]
  let m = /^#([0-9a-f]{3,8})$/.exec(s)
  if (m) {
    const h = m[1]
    if (h.length === 3 || h.length === 4) {
      return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)]
    }
    if (h.length === 6 || h.length === 8) {
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
    }
    return null
  }
  m = /^rgba?\(([^)]+)\)$/.exec(s)
  if (m) {
    const p = m[1].split(/[,/\s]+/).filter(Boolean).map(Number)
    if (p.length >= 3 && p.slice(0, 3).every((n) => !Number.isNaN(n))) {
      return [Math.round(p[0]), Math.round(p[1]), Math.round(p[2])]
    }
    return null
  }
  m = /^color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(s)
  if (m) {
    return [Math.round(+m[1] * 255), Math.round(+m[2] * 255), Math.round(+m[3] * 255)]
  }
  return null
}

const toLinear = (c: number) => {
  const x = c / 255
  return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
}
const relLum = (c: RGB) => 0.2126 * toLinear(c[0]) + 0.7152 * toLinear(c[1]) + 0.0722 * toLinear(c[2])

function contrastOf(a: RGB, b: RGB): number {
  const la = relLum(a)
  const lb = relLum(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

const cssRgb = (c: RGB) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`

function blend(fg: RGB, bg: RGB, t: number): RGB {
  return [
    Math.round(fg[0] + (bg[0] - fg[0]) * t),
    Math.round(fg[1] + (bg[1] - fg[1]) * t),
    Math.round(fg[2] + (bg[2] - fg[2]) * t),
  ]
}

/** 在给定底色上挑一个够清楚的前景色；候选都不合格就按底色亮度自动黑/白 */
function pickFg(bgCss: string | undefined, candidates: (string | undefined)[], min = 4.5): string | null {
  const bg = parseColor(bgCss)
  if (!bg) return null
  for (const cand of candidates) {
    const c = parseColor(cand)
    if (c && contrastOf(c, bg) >= min) return cand as string
  }
  const fallback: RGB = relLum(bg) > 0.5 ? [26, 26, 26] : [242, 242, 242]
  return cssRgb(fallback)
}

/** 次要文字：先尊重主题自己的 muted，太淡就往主前景色靠 */
function dimFg(bgCss: string | undefined, base: string | null, candidate: string | undefined, min: number): string | null {
  const bg = parseColor(bgCss)
  const b = parseColor(base)
  if (!bg || !b) return null
  const c = parseColor(candidate)
  if (c && c && contrastOf(c, bg) >= min) return candidate as string
  for (const t of [0.3, 0.18, 0.08, 0]) {
    const mixed = blend(b, bg, t)
    if (contrastOf(mixed, bg) >= min) return cssRgb(mixed)
  }
  return cssRgb(b)
}

/** 强调色落到某个底色上：够清楚就用原色，不够就往基准前景色靠（保留色相） */
function adaptAccent(
  bgCss: string | undefined,
  accent: string | undefined,
  base: string | null,
  min = 3,
): string | null {
  const bg = parseColor(bgCss)
  const a = parseColor(accent)
  if (!bg || !a) return null
  if (contrastOf(a, bg) >= min) return accent as string
  const b = parseColor(base) ?? (relLum(bg) > 0.5 ? [26, 26, 26] : [242, 242, 242])
  for (const t of [0.3, 0.45, 0.6, 0.75, 0.9]) {
    const mixed = blend(a, b, t)
    if (contrastOf(mixed, bg) >= min) return cssRgb(mixed)
  }
  return cssRgb(b)
}

function buildBridge(vars: Record<string, string>, width?: string): string {
  const out: Record<string, string> = {}
  for (const [ours, sources] of Object.entries(VAR_MAP)) {
    for (const s of sources) {
      const raw = vars[s]
      if (!raw) continue
      const v = resolveVar(raw, vars)
      if (!v) continue
      if (ours === '--content-font-size' && !/^[\d.]+px$/.test(v)) continue
      out[ours] = v
      break
    }
  }
  if (!out['--accent']) out['--accent'] = '#0969da'
  if (!out['--font-head']) out['--font-head'] = 'var(--font-body)'
  for (const [k, v] of Object.entries(DERIVED)) if (!out[k]) out[k] = v
  if (width) out['--content-width'] = width

  // —— 骨架配色：菜单栏/状态栏贴 --bg，侧栏贴 --bg-side，各自单独守对比度 ——
  const sideHint = [
    '--side-bar-text-color',
    '--sidebar-text-color',
    '--control-text-color',
    '--active-file-text-color',
  ]
    .map((k) => (vars[k] ? resolveVar(vars[k], vars) : ''))
    .find((v) => v && parseColor(v))

  const chromeFg = pickFg(out['--bg'], [out['--fg']], 4.5)
  if (chromeFg) {
    out['--fg-chrome'] = chromeFg
    out['--fg-chrome-dim'] = dimFg(out['--bg'], chromeFg, out['--fg-muted'], 4) ?? chromeFg
    out['--fg-chrome-faint'] = dimFg(out['--bg'], chromeFg, out['--fg-faint'], 2.4) ?? chromeFg
  }
  const sideFg = pickFg(out['--bg-side'], [sideHint, out['--fg']], 4.5)
  if (sideFg) {
    out['--fg-side'] = sideFg
    out['--fg-side-dim'] = dimFg(out['--bg-side'], sideFg, out['--fg-muted'], 4) ?? sideFg
    out['--fg-side-faint'] = dimFg(out['--bg-side'], sideFg, out['--fg-faint'], 2.4) ?? sideFg
  }

  // 强调色：主题的 --accent 是为浅色正文区挑的，落在深色侧栏上可能糊掉；
  // 菜单 hover 的实底按钮也一样，需要单独算一个"压在上面看得清"的前景色。
  const accentSide = adaptAccent(out['--bg-side'], out['--accent'], sideFg)
  if (accentSide) {
    out['--accent-side'] = accentSide
    out['--accent-side-soft'] = `color-mix(in srgb, ${accentSide} 22%, ${out['--bg-side']})`
  }
  // 强调色当"文字"用在浅底上（状态栏开关、chip、菜单标题）同样要够清楚
  const accentText = adaptAccent(out['--bg'], out['--accent'], out['--fg'], 4.5)
  if (accentText) out['--accent-text'] = accentText
  const onAccent = pickFg(out['--accent'], [], 4.5)
  if (onAccent) out['--on-accent'] = onAccent

  const body = Object.entries(out)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n')
  // html[data-theme] 的特异性高于 [data-theme='github']，且注入更晚，必定生效
  return `\n/* ---- Lypora 变量桥（由主题适配层生成，勿手改） ---- */\nhtml[data-theme] {\n${body}\n}\n`
}

/* ------------------------------------------------------------------ *
 * 入口
 * ------------------------------------------------------------------ */

export function translateThemeCss(src: string): TranslateResult {
  const stats: ThemeStats = { foreign: false, rules: 0, kept: 0, dropped: 0, vars: 0 }
  if (!src || !src.trim()) return { css: '', stats }

  const vars = collectVars(src)
  const varNames = Object.keys(vars)
  stats.vars = varNames.length
  stats.foreign =
    /#write\b/.test(src) || varNames.some((v) => ['--bg-color', '--text-color', '--accent-color'].includes(v))

  const ctx: Ctx = { rules: 0, kept: 0, dropped: 0, vars }
  let body = ''
  try {
    body = translateRules(src, ctx)
  } catch {
    // 解析失败就退回原文，至少不阻断导入
    return { css: src, stats: { ...stats, foreign: false } }
  }
  stats.rules = ctx.rules
  stats.kept = ctx.kept
  stats.dropped = ctx.dropped
  stats.width = ctx.width

  const bridge = buildBridge(vars, ctx.width)
  return { css: `${body}${bridge}`, stats }
}
