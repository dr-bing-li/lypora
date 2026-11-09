/**
 * 图片路径的纯逻辑内核 —— 零 import，可在 node 里直接跑用例表
 * ==========================================================================
 * 这里只做两件事：字符串运算 + 路径判定。**不读设置、不探测平台、不碰 IO**。
 * 环境差异全部收敛成 `ResolveEnv` 参数，由 image-path.ts 填充。
 *
 * 这样拆的理由：相对路径解析是这个 bug 的正中央，必须有可重复执行的断言，
 * 而不是"打开软件看一眼好像能显示"。
 * ==========================================================================
 */

export type ImageRefMode = 'reference' | 'embed'
export type ImagePathMode = 'copy' | 'relative' | 'absolute'

export const IMAGE_REF_DEFAULT: ImageRefMode = 'reference'
export const IMAGE_PATH_DEFAULT: ImagePathMode = 'copy'

/** 状态栏按钮的循环顺序：拷贝 → 相对 → 绝对 → 回到拷贝 */
export const IMAGE_PATH_CYCLE: readonly ImagePathMode[] = ['copy', 'relative', 'absolute']

/** 附件目录探测的兜底顺序 */
export const DEFAULT_ASSET_DIRS: readonly string[] = ['assets', 'images', 'img']

export interface ResolveEnv {
  /** 三端外壳。web 表示浏览器/PWA：没有文档磁盘路径，维持旧行为 */
  kind: 'electron' | 'native' | 'web'
  /** native 专用：文档目录的绝对 URI（Documents/Lypora） */
  nativeRoot?: string | null
  /** native 专用：file:// → WebView 可访问 URL（Capacitor.convertFileSrc） */
  toViewUrl?: (uri: string) => string
}

const WIN_ABS = /^[a-zA-Z]:[\\/]/
const DRIVE = /^[a-zA-Z]:/
const URL_LIKE = /^(?:data|blob|https?|file|ftp|ftps|mailto|tel|about):/i

export function isWindowsAbs(p: string): boolean {
  return WIN_ABS.test(p)
}

/** data:/http(s):/file:/# 这些不需要（也不能）拼文档目录 */
export function isUrlLike(src: string): boolean {
  return URL_LIKE.test(src) || src.startsWith('//') || src.startsWith('#')
}

export function toSlashes(p: string): string {
  return p.replace(/\\/g, '/')
}

/** 取所在目录；`C:/a.md` → `C:/`，`/a.md` → `/`，`a.md` → `''` */
export function dirname(p: string): string {
  const s = toSlashes(p)
  const i = s.lastIndexOf('/')
  if (i < 0) return ''
  const head = s.slice(0, i)
  if (!head) return '/'
  if (DRIVE.test(head) && head.length === 2) return head + '/'
  return head
}

/** 消掉 `.` / `..` / 重复斜杠，保留盘符与开头的 `/` */
export function normalizePath(p: string): string {
  const s = toSlashes(p)
  const drive = DRIVE.exec(s)?.[0] ?? ''
  const body = drive ? s.slice(drive.length) : s
  const abs = body.startsWith('/')
  const out: string[] = []
  for (const seg of body.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop()
      else if (!abs) out.push('..')
      continue
    }
    out.push(seg)
  }
  const joined = out.join('/')
  if (drive) return `${drive}/${joined}`
  return abs ? `/${joined}` : joined || '.'
}

export function joinPath(dir: string, rel: string): string {
  if (!dir) return normalizePath(rel)
  return normalizePath(`${toSlashes(dir).replace(/\/+$/, '')}/${toSlashes(rel)}`)
}

/**
 * 把相对路径接到一个 URI 基址上（Android 的 `file:///storage/...` 就属于这种）。
 * 不能直接用 joinPath：normalizePath 会把 `//` 折成 `/`，`file:///x` 会被压成
 * `file:/x`，Capacitor 那边就认不出来了。
 */
export function joinUri(root: string, rel: string): string {
  const m = /^([a-z][a-z0-9+.-]*:\/\/)(.*)$/i.exec(root)
  if (!m) return joinPath(root, rel)
  const base = '/' + m[2].replace(/^\/+/, '')
  return m[1] + normalizePath(`${base}/${toSlashes(rel)}`)
}

/**
 * 求 `target` 相对 `fromDir` 的路径；跨盘（Windows）返回 null。
 * 大小写按敏感比较 —— 这样在 Linux 上才是对的。
 */
export function relativePath(target: string, fromDir: string): string | null {
  const t = normalizePath(target)
  const d = normalizePath(fromDir)
  const driveOf = (p: string) => (DRIVE.exec(p)?.[0] ?? '').toLowerCase()
  if (driveOf(t) !== driveOf(d)) return null
  const tp = t.replace(DRIVE, '').split('/').filter(Boolean)
  const dp = d.replace(DRIVE, '').split('/').filter(Boolean)
  let i = 0
  while (i < dp.length && i < tp.length - 1 && tp[i] === dp[i]) i++
  return [...Array(dp.length - i).fill('..'), ...tp.slice(i)].join('/') || '.'
}

function encodeUriPath(p: string): string {
  // encodeURI 会保留 `#` `?`，但它们出现在文件名里就是 URI 的分隔符，必须再编码一次
  return encodeURI(p).replace(/#/g, '%23').replace(/\?/g, '%3F')
}

/** 本地绝对路径 → file URL（Windows 盘符要补一个前导斜杠） */
export function toFileUrl(p: string): string {
  let s = toSlashes(p)
  if (WIN_ABS.test(s)) s = '/' + s
  if (!s.startsWith('/')) s = '/' + s
  return `file://${encodeUriPath(s)}`
}

/**
 * 把 markdown 里的图片 src 变成可加载的 URL。
 * 纯函数：同样的 (src, docPath, env) 永远得到同样的结果。
 */
export function resolveIn(src: string, docPath: string | undefined, env: ResolveEnv): string {
  const raw = (src || '').trim()
  if (!raw) return raw

  if (isUrlLike(raw)) {
    // Android 的 WebView 不能直接加载 file://，必须换成 _capacitor_file_ 通道
    if (/^file:/i.test(raw) && env.kind === 'native') {
      return env.toViewUrl ? env.toViewUrl(raw) : raw
    }
    return raw
  }

  if (env.kind === 'electron') {
    const abs =
      isWindowsAbs(raw) || raw.startsWith('/')
        ? normalizePath(raw)
        : docPath
          ? joinPath(dirname(docPath), raw)
          : ''
    // 没有文档路径 = 无基准可拼；原样返回，交给 ImageWidget 显示"图片无法显示"占位
    return abs ? toFileUrl(abs) : raw
  }

  if (env.kind === 'native') {
    const root = env.nativeRoot
    if (!root) return raw
    const abs = raw.startsWith('/') ? raw : joinUri(root, raw)
    return env.toViewUrl ? env.toViewUrl(abs) : abs
  }

  // 浏览器 / PWA：没有文档磁盘路径，保持旧行为
  return raw
}

const IMG_REF = /!\[[^\]]*\]\(\s*(?:<)?([^\s)>]+)/g

/**
 * 从正文里推断附件目录：统计所有"相对路径图片引用"的第一段目录名，
 * 出现次数最多的那个胜出（并列时取先出现的）。
 * 用于「已有文档已经用 img/ 放图，别再新建一个 assets/」这个诉求。
 */
export function assetDirFromContent(content: string): string | null {
  const counts = new Map<string, number>()
  for (const m of content.matchAll(IMG_REF)) {
    const src = m[1].trim()
    if (!src || isUrlLike(src) || isWindowsAbs(src) || src.startsWith('/')) continue
    const rel = toSlashes(src).replace(/^\.\//, '')
    // 不含 `/` 说明图片与文档同级，没有"附件目录"这个概念
    if (!rel.includes('/')) continue
    const first = rel.split('/')[0]
    if (!first || first === '.' || first === '..') continue
    counts.set(first, (counts.get(first) ?? 0) + 1)
  }
  let best: string | null = null
  let bestN = 0
  for (const [k, n] of counts) {
    if (n > bestN) {
      best = k
      bestN = n
    }
  }
  return best
}

/** 候选目录列表：正文推断出的排第一，再补默认三件套（去重） */
export function assetDirCandidates(content: string): string[] {
  const detected = assetDirFromContent(content)
  const list = detected ? [detected, ...DEFAULT_ASSET_DIRS] : [...DEFAULT_ASSET_DIRS]
  return [...new Set(list)]
}

/** 仅重名时用的时间戳前缀：20261109-143012 */
export function stampPrefix(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  )
}

/** 文件名里只编码会破坏 markdown 链接的字符，其余保留原样（中文不动） */
export function encodeRefPath(p: string): string {
  return toSlashes(p)
    .replace(/%/g, '%25')
    .replace(/ /g, '%20')
    .replace(/#/g, '%23')
    .replace(/\?/g, '%3F')
}
