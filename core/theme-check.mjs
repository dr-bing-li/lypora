/**
 * 主题包验收：把第三方主题合集里的 12 套主题
 * 通过**真实导入路径**（#theme-file → FileReader → addCustomTheme → applyTheme → 适配层 → <style>）
 * 逐个导入，再用主题包自带样例内容量各主题的实际渲染结果。
 *
 * 断言口径（期望值独立从 CSS 文本推算，不读适配层的自述）：
 *   1 varsOk       —— 页面上 --bg/--fg 的实算值 == 主题 CSS 里 --bg-color/--text-color 的颜色
 *   2 paintOk      —— body 的底色或背景图相对基准（Github）发生了变化
 *   3 h1Changed    —— H1 的字号/字重/字体至少一项变化
 *   4 contrastOk   —— 正文与底色对比度 ≥ 3（主题不能把字糊掉）
 *   5 brightness   —— 暗色主题底色亮度 < 0.5，亮色 > 0.5
 *   6 widthApplied —— 顶层 #write{max-width} 的值 == --content-width 实算值
 *   7 styleInjected—— 注入的样式层 > 2KB 且带变量桥
 */
import { chromium } from 'playwright-core'
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// 第三方主题合集不进仓库（授权链不完整），由本机自备：缺目录时本脚本直接跳过。
// 用法：THEMES_DIR=/path/to/themes node theme-check.mjs [url]
const THEME_DIR =
  process.env.THEMES_DIR ||
  fileURLToPath(new URL('../.tmp-themes/', import.meta.url))
const ART = fileURLToPath(new URL('../artifacts/themes/', import.meta.url))
const SAMPLE_PATH = fileURLToPath(new URL('../artifacts/theme-sample.md', import.meta.url))

if (!existsSync(THEME_DIR)) {
  console.log(
    JSON.stringify({ skipped: true, reason: '未提供第三方主题合集目录', themeDir: THEME_DIR }, null, 2),
  )
  process.exit(0)
}

/** 主题包自带样例缺失时用内置样例，保证脚本在干净克隆下也能跑 */
const SAMPLE = existsSync(SAMPLE_PATH)
  ? readFileSync(SAMPLE_PATH, 'utf8')
  : [
      '# 主题样例标题',
      '',
      '正文 **加粗** *斜体* `代码` [链接](https://example.com) ==高亮==',
      '',
      '## 二级标题',
      '',
      '- 列表项一',
      '- 列表项二',
      '',
      '| 列 A | 列 B |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      '> 引用块',
      '',
      '```js',
      'const a = 1',
      '```',
      '',
      '$$',
      '\\int_0^1 x^2 dx = \\frac{1}{3}',
      '$$',
      '',
    ].join('\n')
const PAGE_URL = process.argv[2] || 'http://127.0.0.1:4173/'

mkdirSync(ART, { recursive: true })

/* ---------------- 独立解析主题 CSS（不依赖适配层） ---------------- */
function rootVars(css) {
  const vars = {}
  const re = /(?:^|[\s,}])(:root|html)\s*(?:,\s*html\s*)?\{([^}]*)\}/gi
  let m
  while ((m = re.exec(css))) {
    const body = m[2].replace(/\/\*[\s\S]*?\*\//g, '')
    for (const decl of body.split(';')) {
      const i = decl.indexOf(':')
      if (i < 0) continue
      const k = decl.slice(0, i).trim()
      const v = decl.slice(i + 1).trim()
      if (k.startsWith('--') && v) vars[k] = v
    }
  }
  return vars
}

function resolve(value, vars, depth = 0) {
  if (!value || depth > 4) return value
  return value.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g, (_m, n, fb) => {
    if (vars[n] != null) return resolve(vars[n], vars, depth + 1)
    return fb != null ? fb.trim() : ''
  })
}

/** 只认顶层规则的 #write{max-width}（@media 里的断点值不算基础版心） */
function topLevelWriteWidth(css) {
  let width = null
  let prelude = ''
  let body = ''
  let depth = 0
  let inComment = false
  for (let k = 0; k < css.length; k++) {
    const c = css[k]
    if (inComment) {
      if (c === '*' && css[k + 1] === '/') {
        inComment = false
        k++
      }
      continue
    }
    if (c === '/' && css[k + 1] === '*') {
      inComment = true
      k++
      continue
    }
    if (c === '{') {
      depth++
      continue
    }
    if (c === '}') {
      depth--
      if (depth === 0) {
        const sels = prelude
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
        if (sels.includes('#write')) {
          const m = /max-width\s*:\s*([^;}]+)/i.exec(body)
          if (m) width = m[1].trim()
        }
        prelude = ''
        body = ''
      }
      continue
    }
    if (depth === 0) prelude += c
    else if (depth === 1) body += c
  }
  return width
}

function toRgbStr(v) {
  if (!v) return null
  const s = String(v).trim().toLowerCase()
  let m = /^#([0-9a-f]{3})$/.exec(s)
  if (m) {
    const [r, g, b] = m[1].split('').map((c) => parseInt(c + c, 16))
    return `${r},${g},${b}`
  }
  m = /^#([0-9a-f]{6})$/.exec(s)
  if (m) {
    const n = parseInt(m[1], 16)
    return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`
  }
  m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/.exec(s)
  if (m) {
    if (m[4] !== undefined && Number(m[4]) === 0) return null
    return `${Math.round(+m[1])},${Math.round(+m[2])},${Math.round(+m[3])}`
  }
  return null
}

const lumOf = (rgb) => {
  if (!rgb) return null
  const [r, g, b] = rgb.split(',').map(Number)
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

function contrast(a, b) {
  if (!a || !b) return null
  const lin = (c) => {
    const x = c / 255
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  }
  const L = (rgb) => {
    const [r, g, b2] = rgb.split(',').map(Number)
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b2)
  }
  const l1 = L(a)
  const l2 = L(b)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

const DARK = new Set(['chernobyl-blackout', 'rainbow-konayuki', 'warm-snow'])
const files = readdirSync(THEME_DIR)
  .filter((f) => f.endsWith('.css'))
  .sort()

if (!files.length) {
  console.log(
    JSON.stringify({ skipped: true, reason: '目录里没有 .css 主题', themeDir: THEME_DIR }, null, 2),
  )
  process.exit(0)
}

/* ---------------- 浏览器 ---------------- */
const b = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
})
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 160))
})
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message.slice(0, 160)))

await page.goto(PAGE_URL, { waitUntil: 'networkidle' })
await page.waitForSelector('.cm-content', { timeout: 20000 })
await page.waitForTimeout(500)

// 用主题包自带的样例内容当底稿（拖入 → 走真实的 drop 打开路径）
await page.evaluate((md) => {
  const dt = new DataTransfer()
  dt.items.add(new File([md], 'theme-sample.md', { type: 'text/markdown' }))
  window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
}, SAMPLE)
await page.waitForTimeout(900)

const measure = () =>
  page.evaluate(() => {
    const g = (sel, prop) => {
      const el = document.querySelector(sel)
      return el ? getComputedStyle(el)[prop] : null
    }
    const root = getComputedStyle(document.documentElement)
    const h1 = document.querySelector('.cm-line.md-line-h1')
    const h2 = document.querySelector('.cm-line.md-line-h2')
    const code = document.querySelector('.cm-line.md-code-line')
    const quote = document.querySelector('.cm-line.md-quote-line')
    const table = document.querySelector('.cm-table-widget table')
    const th = document.querySelector('.cm-table-widget th')
    const pseudoOf = (el, which) => {
      const s = getComputedStyle(el, which)
      return {
        content: s.content,
        width: s.width,
        bg: s.backgroundColor,
        display: s.display,
      }
    }
    const styleEl = document.getElementById('lypora-custom-theme')
    // 骨架配色：向上找第一个不透明底色，避免 transparent 让对比度算错
    // 注意：color-mix() 的实算值是 color(srgb …)，必须用 canvas 归一化成 rgb 字节
    const cv = document.createElement('canvas')
    cv.width = cv.height = 1
    const cx = cv.getContext('2d', { willReadFrequently: true })
    const norm = (c) => {
      try {
        cx.clearRect(0, 0, 1, 1)
        cx.fillStyle = '#000'
        cx.fillStyle = c
        cx.fillRect(0, 0, 1, 1)
        const d = cx.getImageData(0, 0, 1, 1).data
        return `${d[0]},${d[1]},${d[2]}`
      } catch {
        return null
      }
    }
    const parseAlpha = (c) => {
      const s = String(c).trim()
      let m = /^rgba?\(([^)]*)\)$/.exec(s)
      if (m) {
        const parts = m[1].split(/[,/\s]+/).filter(Boolean)
        if (parts.length < 4) return 1
        return parts[3].endsWith('%') ? Number(parts[3].slice(0, -1)) / 100 : Number(parts[3])
      }
      // color-mix() 的实算值是 color(srgb r g b / a%)，早先没认出来，
      // 于是 12% 的薄纱被当成实底，深色主题的开关一律误报
      m = /^color\([^)]*?\/\s*([\d.]+)(%?)\s*\)$/.exec(s)
      if (m) return m[2] ? Number(m[1]) / 100 : Number(m[1])
      return 1
    }
    /**
     * 实算底色 = 从元素向上把各层半透明底色**逐层叠**出来的结果。
     * 早先是"取第一个不透明层"，可状态栏开关的底色是
     * `color-mix(accent 12%, transparent)`（alpha 0.12），直接拿它去和文字算
     * 对比度等于把 12% 的薄纱当成实底，12 套主题一律误报 1.0:1。
     */
    const effBg = (el) => {
      const layers = []
      let n = el
      while (n) {
        const c = getComputedStyle(n).backgroundColor
        const a = parseAlpha(c)
        if (a > 0.001) layers.push({ c, a })
        if (a >= 0.999) break
        n = n.parentElement
      }
      try {
        cx.clearRect(0, 0, 1, 1)
        // 兜底：一直透明到根就按白纸算
        cx.fillStyle = '#ffffff'
        cx.fillRect(0, 0, 1, 1)
        for (let i = layers.length - 1; i >= 0; i--) {
          cx.fillStyle = layers[i].c
          cx.fillRect(0, 0, 1, 1)
        }
        const d = cx.getImageData(0, 0, 1, 1).data
        return `${d[0]},${d[1]},${d[2]}`
      } catch {
        return '255,255,255'
      }
    }
    const chrome = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      return { bg: effBg(el), fg: norm(getComputedStyle(el).color) }
    }
    return {
      chrome: {
        menubar: chrome('.menubar'),
        menuRoot: chrome('.menu-root'),
        sidebar: chrome('.sidebar'),
        outline: chrome('.outline-item:not(.active)'),
        outlineActive: chrome('.outline-item.active'),
        status: chrome('.statusbar'),
        statusToggle: chrome('.status-toggle.on'),
        statusToggleOff: chrome('#btn-source'),
      },
      bgVar: root.getPropertyValue('--bg').trim(),
      fgVar: root.getPropertyValue('--fg').trim(),
      bodyBg: getComputedStyle(document.body).backgroundColor,
      bodyImage: getComputedStyle(document.body).backgroundImage,
      pColor: g('.cm-line.md-p', 'color'),
      pColorRgb: norm(g('.cm-line.md-p', 'color') || '#000'),
      pFont: g('.cm-line.md-p', 'fontFamily'),
      pFontSize: g('.cm-line.md-p', 'fontSize'),
      h1Size: h1 ? getComputedStyle(h1).fontSize : null,
      h1Family: h1 ? getComputedStyle(h1).fontFamily : null,
      h1Weight: h1 ? getComputedStyle(h1).fontWeight : null,
      // 装饰件落在 ::before/::after 上：自动编号（counter）、左侧色条、圆点
      h1Before: h1 ? pseudoOf(h1, '::before') : null,
      h2Before: h2 ? pseudoOf(h2, '::before') : null,
      headPseudo: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map((tag) => {
        const el = document.querySelector(`.cm-line.md-line-${tag}`)
        return el ? pseudoOf(el, '::before') : null
      }),
      h2After: h2 ? pseudoOf(h2, '::after') : null,
      h1Pos: h1 ? getComputedStyle(h1).position : null,
      th: th ? { top: getComputedStyle(th).borderTopWidth, left: getComputedStyle(th).borderLeftWidth, bg: getComputedStyle(th).backgroundColor } : null,
      quoteB: quote ? { left: getComputedStyle(quote).borderLeftWidth, bg: getComputedStyle(quote).backgroundColor } : null,
      h1Color: h1 ? getComputedStyle(h1).color : null,
      codeBg: code ? getComputedStyle(code).backgroundColor : null,
      quoteBar: quote ? getComputedStyle(quote).borderLeftColor : null,
      tableBorder: table ? getComputedStyle(table).borderTopColor : null,
      hostWidth: Math.round(document.querySelector('.editor-host').getBoundingClientRect().width),
      contentVar: root.getPropertyValue('--content-width').trim(),
      styleLen: (styleEl?.textContent || '').length,
      hasBridge: (styleEl?.textContent || '').includes('变量桥'),
      pCount: document.querySelectorAll('.cm-line.md-p').length,
      lineCount: document.querySelectorAll('.cm-line').length,
    }
  })

const base = await measure()
await page.screenshot({ path: `${ART}/00-baseline-github.png` })

const results = []
for (const f of files) {
  const name = f.replace(/\.css$/, '')
  const css = readFileSync(`${THEME_DIR}/${f}`, 'utf8')
  const vars = rootVars(css)
  const expBg = toRgbStr(resolve(vars['--bg-color'] || vars['--window-bg-color'] || '', vars))
  const expFg = toRgbStr(resolve(vars['--text-color'] || vars['--body-text-color'] || '', vars))
  // 主题若写 max-width: var(--xxx) 且该变量自身又是 var 链（或指向我们的变量），不做宽度断言
  const rawWidth = topLevelWriteWidth(css)
  const expWidth = rawWidth && !resolve(rawWidth, vars).includes('var(') ? resolve(rawWidth, vars) : null

  // —— 期望值从主题 CSS 文本独立推算（不读适配层的自述）——
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '')
  // 标题自动编号：`h2::before { content: counter(heading-h2) }`
  const wantsNumbering = /h[2-6][^{}]*::?before[^{}]*\{[^}]*content:\s*counter\(/i.test(plain)
  // 标题挂装饰件：`#write h1::before { content:''; width:4px … }`（左侧色条 / 圆点）
  // 只认"常态"规则 —— `h3.md-focus:before` 那种是聚焦才出现的参考实现编辑器行为
  const wantsHeadDeco =
    /#write(?![^{}]*md-focus)[^{}]*\bh[1-6][^{}]*::?before[^{}]*\{[^}]*\}/i.test(plain)
  // 三线表：单元格边框被清掉
  const wantsFlatCells = /(?:table[^{}]*(?:tr|th|td)|(?:th|td)\.?[\w-]*)[^{}]*\{[^}]*border:\s*(?:none|0)\b/i.test(
    plain,
  )
  // 基准字号（px 或 pt，var() 先按主题变量解析一层）
  let expFontPx = null
  for (const m2 of plain.matchAll(/(?:^|})\s*(?:#write|html)\s*\{([^}]*)\}/gi)) {
    const d = /font-size:\s*([^;}]+)/i.exec(m2[1])
    if (!d) continue
    const v = resolve(d[1].trim(), vars)
    const n = /^([\d.]+)\s*(px|pt)$/i.exec(v)
    if (n) {
      expFontPx = n[2].toLowerCase() === 'pt' ? (Number(n[1]) * 4) / 3 : Number(n[1])
      break
    }
  }

  await page.setInputFiles('#theme-file', `${THEME_DIR}/${f}`)
  await page.waitForTimeout(750)
  const m = await measure()
  await page.screenshot({ path: `${ART}/${name}.png` })

  const gotBg = toRgbStr(m.bgVar)
  const gotFg = toRgbStr(m.fgVar)
  const lum = lumOf(gotBg)
  const dark = DARK.has(name)
  const cRatio = contrast(m.pColorRgb || toRgbStr(m.pColor), gotBg) ?? 0

  // 骨架（菜单栏 / 侧栏 / 状态栏）可读性：主题只改文档配色时不能把界面文字弄瞎
  const chromeRatio = {}
  for (const [k, v] of Object.entries(m.chrome)) {
    if (!v) continue
    chromeRatio[k] = contrast(v.fg, v.bg) ?? 0
  }
  const chromeMin = Math.min(...Object.values(chromeRatio), 99)

  const checks = {
    varsOk: (expBg ? gotBg === expBg : true) && (expFg ? gotFg === expFg : true),
    // 白底主题的 body 底色和基准一样，不能只看底色：把文字/代码/引用一起比
    paintOk:
      m.bodyBg !== base.bodyBg ||
      m.bodyImage !== base.bodyImage ||
      m.pColor !== base.pColor ||
      m.codeBg !== base.codeBg ||
      m.quoteBar !== base.quoteBar,
    h1Changed:
      m.h1Size !== base.h1Size || m.h1Family !== base.h1Family || m.h1Weight !== base.h1Weight,
    contrastOk: cRatio >= 3,
    brightness: lum == null ? false : dark ? lum < 0.5 : lum > 0.5,
    widthApplied: expWidth ? m.contentVar === expWidth : true,
    styleInjected: m.styleLen > 2000 && m.hasBridge,
    chromeOk: chromeMin >= 3,
    // 主题写了标题自动编号 → 渲染出来的 h2::before 必须真的有内容
    numberingOk: wantsNumbering ? !!m.h2Before && m.h2Before.content !== 'none' : true,
    // 主题给标题挂了 ::before 装饰（色条/圆点）→ 六级标题里至少有一级必须真的画出来
    headDecoOk: wantsHeadDeco
      ? m.headPseudo.some((p) => p && p.content !== 'none')
      : true,
    // 标题上的装饰用绝对定位时，行必须有定位基准，否则色条会跑到整页左上角
    headAnchorOk:
      wantsHeadDeco && m.headPseudo.some((p) => p && p.width !== 'auto' && p.width !== '0px')
        ? m.h1Pos === 'relative'
        : true,
    // 三线表：主题清了单元格边框，渲染就不能还留着网格线
    tableSkinOk: wantsFlatCells ? !!m.th && (m.th.top === '0px' || m.th.left === '0px') : true,
    // 主题自带基准字号 → 正文实算字号必须跟上（用户字号是倍率）
    fontOk: expFontPx == null || Math.abs(parseFloat(m.pFontSize) - expFontPx) <= 0.6,
  }
  const pass = Object.values(checks).every(Boolean)
  results.push({
    theme: name,
    dark,
    expBg: expBg ?? '-',
    gotBg: m.bgVar,
    expFg: expFg ?? '-',
    gotFg: m.fgVar,
    expWidth: expWidth ?? '-',
    h1: `${m.h1Size} / w${m.h1Weight} / ${(m.h1Family || '').split(',')[0]}`,
    h1Color: m.h1Color,
    pColor: m.pColor,
    pFont: (m.pFont || '').split(',')[0],
    codeBg: m.codeBg,
    quoteBar: m.quoteBar,
    tableBorder: m.tableBorder,
    width: `${m.hostWidth}px (${m.contentVar})`,
    contrast: Number(cRatio.toFixed(2)),
    chrome: chromeRatio,
    chromeMin: Number(chromeMin.toFixed(2)),
    styleLen: m.styleLen,
    checks,
    pass,
  })
  console.log(
    `${pass ? 'PASS' : 'FAIL'} ${name.padEnd(22)} bg=${gotBg.padEnd(11)} fg=${(gotFg || '-').padEnd(11)} h1=${String(m.h1Size).padEnd(8)} w=${String(m.hostWidth).padEnd(5)} c=${cRatio.toFixed(1)} chrome=${chromeMin.toFixed(1)}${
      pass ? '' : '  ⇐ ' + Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join(',')
    }`,
  )
  if (chromeMin < 3) console.log('   chrome 明细:', JSON.stringify(chromeRatio))
}

/* ---------------- 切换：菜单选自定义主题 / 切回内置 ---------------- */
/**
 * v0.12.0 起顶级菜单瘦身到 7 项，「主题」进「显示」变成**二级弹层**。
 * 这里走真实的三级路径：开「显示」→ hover「主题」→ 点主题名。
 */
async function clickMenu(rootLabel, subMi, itemLabel) {
  const root = page.locator('.menu-root', { hasText: rootLabel }).first()
  const rb = await root.boundingBox()
  await page.mouse.move(rb.x + 12, rb.y + rb.height / 2)
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForSelector('.menu-drop', { timeout: 5000 })
  const sub = page.locator(`.menu-drop .menu-item[data-mi="${subMi}"]`).first()
  const sb = await sub.boundingBox()
  await page.mouse.move(sb.x + 10, sb.y + sb.height / 2)
  await page.waitForSelector('.menu-drop.sub', { timeout: 5000 })
  const item = page.locator('.menu-drop.sub .menu-item', { hasText: itemLabel }).first()
  await item.click()
  await page.waitForTimeout(500)
}

await clickMenu('显示', 'view-theme', 'drake-notion')
const afterMenu = await measure()
await clickMenu('显示', 'view-theme', 'Night')
const afterNight = await measure()
await clickMenu('显示', 'view-theme', 'Github')
const afterGithub = await measure()

const summary = {
  url: PAGE_URL,
  baseline: {
    bgVar: base.bgVar,
    pColor: base.pColor,
    h1Size: base.h1Size,
    width: base.hostWidth,
    contentVar: base.contentVar,
  },
  results,
  switching: {
    viaMenu: { bgVar: afterMenu.bgVar, styleLen: afterMenu.styleLen },
    builtinNight: { bgVar: afterNight.bgVar, styleLen: afterNight.styleLen },
    backToGithub: {
      bgVar: afterGithub.bgVar,
      styleLen: afterGithub.styleLen,
      matchesBaseline: afterGithub.bgVar === base.bgVar,
    },
  },
  errors,
  pass: results.every((r) => r.pass),
}
writeFileSync(`${ART}/report.json`, JSON.stringify(summary, null, 2))
console.log('\n切换：', JSON.stringify(summary.switching))
console.log('console errors:', errors.length ? errors : 'none')
console.log(`\n总计 ${results.length} 套，通过 ${results.filter((r) => r.pass).length} 套`)

await b.close()
process.exit(summary.pass ? 0 : 1)
