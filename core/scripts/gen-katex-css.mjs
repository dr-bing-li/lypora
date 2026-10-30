/**
 * 生成 core/src/io/katex-inline.ts —— 供「导出 HTML / 打印 PDF」内联使用的 KaTeX 样式。
 *
 * 为什么需要它：导出的 HTML 是**独立文档**，不带应用内任何 CSS。
 * KaTeX 的排版全靠 katex.min.css（.vlist / .strut / .sizing 等一系列定位规则）
 * 加 20 个 woff2 字体，缺一样公式就会退化成一串平铺文字（见 docs/04 V34）。
 *
 * 做法：
 *   1. 读 node_modules/katex/dist/katex.min.css；
 *   2. 把每个 @font-face 的 src 收敛成**单个 woff2 的 data: URL**（丢掉 woff/ttf 兜底）；
 *   3. 输出成 TS 模块里的一个字符串常量。
 *
 * 体积：CSS 24KB + woff2 296KB → base64 后约 420KB，只在导出含公式的文档时拼进 HTML。
 * 幂等：内容没变就不重写文件，避免每次构建都动 dist 的 hash。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const CSS_SRC = path.join(ROOT, 'node_modules', 'katex', 'dist', 'katex.min.css')
const FONT_DIR = path.join(ROOT, 'node_modules', 'katex', 'dist', 'fonts')
const OUT = path.join(ROOT, 'src', 'io', 'katex-inline.ts')

if (!existsSync(CSS_SRC)) {
  console.error(`[katex-css] 找不到 ${CSS_SRC}，先 npm i katex`)
  process.exit(1)
}

let css = readFileSync(CSS_SRC, 'utf8')

// src:url(fonts/X.woff2) format("woff2"),url(fonts/X.woff) format("woff"),url(fonts/X.ttf) format("truetype")
let fontCount = 0
css = css.replace(
  /src:\s*url\(fonts\/([^)]+?)\.woff2\)\s*format\("woff2"\),?[^;}]*/g,
  (_m, name) => {
    const file = path.join(FONT_DIR, `${name}.woff2`)
    if (!existsSync(file)) throw new Error(`[katex-css] 缺字体 ${file}`)
    fontCount++
    const b64 = readFileSync(file).toString('base64')
    return `src:url(data:font/woff2;base64,${b64}) format("woff2")`
  },
)

const leftover = css.match(/url\(fonts\//g)
if (leftover) throw new Error(`[katex-css] 还有 ${leftover.length} 处字体引用没内联，正则要跟着 KaTeX 升级改`)

const header = `/* 自动生成，勿手改 —— 由 core/scripts/gen-katex-css.mjs 从 katex@${JSON.parse(readFileSync(path.join(ROOT, 'node_modules', 'katex', 'package.json'), 'utf8')).version} 生成。
   用途：导出 HTML / 打印 PDF 时内联，保证独立文档里的公式与编辑器内一致。
   字体：${fontCount} 个 woff2 已转 base64，无外链。 */\n`

const body = `export const KATEX_CSS = ${JSON.stringify(css)}\n\nexport const KATEX_FONT_FACES = ${fontCount}\n`

const next = header + body
const prev = existsSync(OUT) ? readFileSync(OUT, 'utf8') : ''
const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12)

if (prev && hash(prev) === hash(next)) {
  console.log(`[katex-css] 无变化（${fontCount} 个字体，${(next.length / 1024).toFixed(0)}KB）`)
} else {
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, next, 'utf8')
  console.log(`[katex-css] 已生成 ${path.relative(ROOT, OUT)}（${fontCount} 个字体，${(next.length / 1024).toFixed(0)}KB）`)
}
