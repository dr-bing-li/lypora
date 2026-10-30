/**
 * 导出公式验收（HTML + 打印/PDF 两条路径）
 *
 * 验的是「导出物自身」而不是应用页面：KaTeX 的 HTML 只是骨架，排版全靠 katex.min.css
 * 与 20 个字体。只要导出文档里缺这份 CSS，公式就会退化成一串平铺文字（V34）。
 *
 * 用法：node export-check.mjs   （需先起 npx vite preview --port 4173）
 * 产物：artifacts/export-math.html / export-screen.png / export-print.png / export-math.pdf
 *       + 终端 JSON 报告
 */
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const URL = 'http://127.0.0.1:4173/index.html'
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const OUT = path.resolve(import.meta.dirname, '..', 'artifacts')
fs.mkdirSync(OUT, { recursive: true })

const report = { pass: false, html: {}, print: {}, pdf: {}, errors: [] }

/** 在任意文档里断言：KaTeX 样式生效、字体到位、公式没被压成一行、没有横向溢出 */
const MATH_PROBE = () => {
  const blocks = [...document.querySelectorAll('.math-block')]
  const b = blocks[0]
  if (!b) return { error: '找不到 .math-block' }
  const katex = b.querySelector('.katex')
  const vlistT = b.querySelector('.vlist-t')
  const cs = katex ? getComputedStyle(katex) : null
  const vcs = vlistT ? getComputedStyle(vlistT) : null
  const rect = b.getBoundingClientRect()
  const em = parseFloat(getComputedStyle(b).fontSize) || 16
  return {
    blocks: blocks.length,
    // KaTeX 样式一旦生效，.katex 的 font-family 首位就是 KaTeX_Main
    fontFamily: cs?.fontFamily?.slice(0, 40) ?? null,
    katexFontApplied: !!cs && /KaTeX_Main/.test(cs.fontFamily),
    // .vlist-t 是 KaTeX 的上下标堆叠容器，样式生效时是 inline-table
    vlistDisplay: vcs?.display ?? null,
    vlistOk: vcs?.display === 'inline-table',
    // 字体真的加载了才算数（数据 URL 也会走 FontFace 加载）
    fontLoaded: document.fonts ? document.fonts.check('16px KaTeX_Main') : null,
    // 断掉的版式会变成一条超宽的单行（用户截图里的横向滚动条就是这么来的）
    overflow: Math.round(b.scrollWidth - b.clientWidth),
    heightPx: Math.round(rect.height),
    heightEm: +(rect.height / em).toFixed(2),
    // 块级公式带上下限，正常高度应明显大于一行
    stacked: rect.height / em > 1.9,
    inlineAboveBaseline: (() => {
      const el = b.querySelector('.katex-display > .katex')
      return el ? Math.round(el.getBoundingClientRect().height) : null
    })(),
  }
}

const judge = (o) =>
  !o.error && o.katexFontApplied && o.vlistOk && o.fontLoaded === true && o.stacked && Math.abs(o.overflow) <= 1

const browser = await chromium.launch({ executablePath: EDGE, headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })
  page.on('pageerror', (e) => report.errors.push('pageerror: ' + e.message))
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.waitForSelector('.cm-editor', { timeout: 20000 })
  await page.waitForTimeout(900)

  /* ---------- 1. 走真实菜单：文件 → 导出 HTML ---------- */
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.evaluate(() => {
      const roots = [...document.querySelectorAll('#menubar-items .menu-root')]
      const fileBtn = roots.find((e) => e.textContent.trim() === '文件')
      fileBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      const pop = document.querySelector('.menu-drop')
      const labels = [...pop.querySelectorAll('.menu-item .mi-label')].map((e) => e.textContent)
      const idx = labels.indexOf('导出 HTML')
      if (idx < 0) throw new Error('菜单里找不到「导出 HTML」')
      pop.querySelectorAll('.menu-item')[idx].click()
    }),
  ])
  const htmlPath = path.join(OUT, 'export-math.html')
  await dl.saveAs(htmlPath)
  const html = fs.readFileSync(htmlPath, 'utf8')
  report.html.file = {
    bytes: html.length,
    hasKatexMarkup: /class="katex"/.test(html),
    hasKatexFontFace: /@font-face/.test(html) && /KaTeX_Main/.test(html),
    fontDataUrls: (html.match(/data:font\/woff2;base64,/g) || []).length,
    externalFontRefs: (html.match(/url\(fonts\//g) || []).length,
  }

  /* ---------- 2. 独立打开导出的文件：等价于「别人收到这个 html 双击打开」 ---------- */
  const filePage = await browser.newPage({ viewport: { width: 1100, height: 900 } })
  filePage.on('pageerror', (e) => report.errors.push('file pageerror: ' + e.message))
  await filePage.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' })
  await filePage.evaluate(() => document.fonts?.ready)
  await filePage.waitForTimeout(400)
  report.html.screen = await filePage.evaluate(MATH_PROBE)
  report.html.pass = judge(report.html.screen)
  await filePage.locator('.math-block').first().screenshot({ path: path.join(OUT, 'export-screen.png') })

  /* ---------- 3. 打印媒体：模拟「打印 / 输出 PDF」时的排版 ---------- */
  await filePage.emulateMedia({ media: 'print' })
  await filePage.waitForTimeout(350)
  report.print.media = await filePage.evaluate(MATH_PROBE)
  report.print.pass = judge(report.print.media)
  await filePage.locator('.math-block').first().screenshot({ path: path.join(OUT, 'export-print.png') })
  await filePage.emulateMedia({ media: 'screen' })

  /* ---------- 4. 真出 PDF：走 Chromium 打印引擎，检查嵌入字体 ---------- */
  const pdfPath = path.join(OUT, 'export-math.pdf')
  await filePage.pdf({ path: pdfPath, format: 'A4', printBackground: true, margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' } })
  const pdfBuf = fs.readFileSync(pdfPath)
  // PDF 里字体名以子集前缀出现（ABCDEF+KaTeX_Main），裸字节里能直接搜到
  report.pdf = {
    bytes: pdfBuf.length,
    pages: (pdfBuf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length,
    hasKatexFont: /KaTeX_/.test(pdfBuf.toString('latin1')),
  }
  report.pdf.pass = report.pdf.bytes > 5000 && report.pdf.hasKatexFont === true

  /* ---------- 5. 应用内的「输出 PDF」路径：抓打印 iframe 的真实文档 ---------- */
  await page.bringToFront()
  await page.evaluate(() => {
    // 打印会弹系统对话框；这里只验版面，先把 iframe 里的 print 置空
    window.__printCalled = 0
    const orig = HTMLIFrameElement.prototype
    void orig
  })
  await page.evaluate(() => {
    const roots = [...document.querySelectorAll('#menubar-items .menu-root')]
    const fileBtn = roots.find((e) => e.textContent.trim() === '文件')
    fileBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    const pop = document.querySelector('.menu-drop')
    const labels = [...pop.querySelectorAll('.menu-item .mi-label')].map((e) => e.textContent)
    const idx = labels.findIndex((l) => l.includes('PDF'))
    if (idx < 0) throw new Error('菜单里找不到 PDF 导出')
    pop.querySelectorAll('.menu-item')[idx].click()
  })
  // 打印 iframe 只存在约 800ms，抢在它被移除前抓住
  const frame = await (async () => {
    for (let i = 0; i < 25; i++) {
      const f = page.frames().find((fr) => fr !== page.mainFrame())
      if (f) return f
      await page.waitForTimeout(40)
    }
    return null
  })()
  if (!frame) {
    report.print.frame = { error: '没抓到打印 iframe' }
  } else {
    await frame.evaluate(() => document.fonts?.ready).catch(() => {})
    report.print.frame = await frame.evaluate(MATH_PROBE).catch((e) => ({ error: String(e).slice(0, 120) }))
    report.print.framePass = judge(report.print.frame)
    try {
      const el = await frame.$('.math-block')
      const html2 = el ? await frame.evaluate(() => document.documentElement.outerHTML.length) : 0
      report.print.frameDocBytes = html2
    } catch {
      /* ignore */
    }
  }

  /* ---------- 6. 反例：不含公式的文档不该被塞进 360KB 的字体 ─---------- */
  await page.bringToFront()
  await page.evaluate(() => {
    const view = document.querySelector('.cm-content')
    view?.focus()
  })
  await page.keyboard.press('Control+a')
  await page.keyboard.type('# 纯文字\n\n没有任何公式的一段话。\n')
  await page.waitForTimeout(600)
  const [dl2] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.evaluate(() => {
      const roots = [...document.querySelectorAll('#menubar-items .menu-root')]
      const fileBtn = roots.find((e) => e.textContent.trim() === '文件')
      fileBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      const pop = document.querySelector('.menu-drop')
      const labels = [...pop.querySelectorAll('.menu-item .mi-label')].map((e) => e.textContent)
      pop.querySelectorAll('.menu-item')[labels.indexOf('导出 HTML')].click()
    }),
  ])
  const plainPath = path.join(OUT, 'export-nomath.html')
  await dl2.saveAs(plainPath)
  const plain = fs.readFileSync(plainPath, 'utf8')
  report.noMath = {
    bytes: plain.length,
    hasKatexCss: /KaTeX_Main/.test(plain),
    hasHeading: /<h1>纯文字<\/h1>/.test(plain),
  }
  report.noMath.pass = !report.noMath.hasKatexCss && report.noMath.bytes < 60_000 && report.noMath.hasHeading

  report.pass =
    report.html.pass &&
    report.print.pass &&
    report.pdf.pass &&
    (report.print.framePass ?? false) &&
    report.noMath.pass &&
    report.errors.length === 0
} catch (e) {
  report.errors.push('fatal: ' + (e instanceof Error ? e.message : String(e)))
} finally {
  await browser.close()
}

console.log(JSON.stringify(report, null, 1))
process.exit(report.pass ? 0 : 1)
