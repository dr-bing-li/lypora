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
    const code = document.querySelector('.cm-line.md-code-line')
    const quote = document.querySelector('.cm-line.md-quote-line')
    const table = document.querySelector('.cm-table-widget table')
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
      const m = /^rgba?\([^)]*?([\d.]+)\)$/.exec(c.trim())
      if (!m) return 1
      return c.trim().startsWith('rgba') ? Number(m[1]) : 1
    }
    const effBg = (el) => {
      let n = el
      while (n) {
        const c = getComputedStyle(n).backgroundColor
        if (c && parseAlpha(c) > 0.02) return c
        n = n.parentElement
      }
      return 'rgb(255,255,255)'
    }
    const chrome = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      return { bg: norm(effBg(el)), fg: norm(getComputedStyle(el).color) }
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
      h1Size: h1 ? getComputedStyle(h1).fontSize : null,
      h1Family: h1 ? getComputedStyle(h1).fontFamily : null,
      h1Weight: h1 ? getComputedStyle(h1).fontWeight : null,
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
async function clickMenu(rootLabel, itemLabel) {
  const root = page.locator('.menu-root', { hasText: rootLabel }).first()
  const rb = await root.boundingBox()
  await page.mouse.move(rb.x + 12, rb.y + rb.height / 2)
  await page.mouse.down()
  await page.mouse.up()
  await page.waitForSelector('.menu-drop', { timeout: 5000 })
  await page.locator('.menu-drop .menu-item', { hasText: itemLabel }).first().click()
  await page.waitForTimeout(500)
}

await clickMenu('主题', 'drake-notion')
const afterMenu = await measure()
await clickMenu('主题', 'Night')
const afterNight = await measure()
await clickMenu('主题', 'Github')
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
