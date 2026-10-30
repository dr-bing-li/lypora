/**
 * 打包版「输出 PDF（打印）」路径验收
 *
 * 为什么单独做：PDF 走的是「导出 HTML → 写进隐藏 iframe → iframe.print()」，
 * 公式是否正常取决于那份**独立文档**里有没有 KaTeX 的布局 CSS 与字体（V34），
 * 以及打印前字体是否已就位（V35）。这两点都在真实 Electron 进程里跑一遍才算数。
 *
 * 打印会弹系统对话框，所以这里在 iframe 创建时就把它 contentWindow.print 换成桩，
 * 只验版面不真打印。
 *
 * 用法：node tools/pdfexporttest.mjs
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..')
const EXE = path.join(ROOT, 'release', 'Lypora', 'Lypora.exe')
const PORT = 9361

if (!existsSync(EXE)) {
  console.error(`找不到 ${EXE}，先 node tools/pack-win.mjs`)
  process.exit(2)
}

const pw = await import(pathToFileURL(path.join(ROOT, 'core', 'node_modules', 'playwright-core', 'index.js')).href)
const { chromium } = pw.chromium ? pw : pw.default

const profile = mkdtempSync(path.join(tmpdir(), 'lypora-pdf-'))
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(EXE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`], {
  cwd: ROOT,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
})
let childOut = ''
child.stdout.on('data', (d) => (childOut += d))
child.stderr.on('data', (d) => (childOut += d))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitDevtools() {
  const t0 = Date.now()
  while (Date.now() - t0 < 30000) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      if (r.ok) return r.json()
    } catch {
      /* 还没起来 */
    }
    await sleep(400)
  }
  throw new Error('DevTools 未就绪\n' + childOut.slice(-400))
}

const report = { pass: false, frame: {}, errors: [] }
let browser = null
try {
  await waitDevtools()
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`)
  const ctx = browser.contexts()[0]
  const page = ctx.pages()[0] ?? (await ctx.waitForEvent('page'))
  page.on('pageerror', (e) => report.errors.push('pageerror: ' + e.message))
  await page.waitForSelector('.cm-editor', { timeout: 20000 })
  await sleep(1000)

  // iframe 一创建就把 print 换成桩，避免弹系统打印对话框
  await page.evaluate(() => {
    const origCreate = Document.prototype.createElement
    Document.prototype.createElement = function (tag, ...rest) {
      const el = origCreate.call(this, tag, ...rest)
      if (String(tag).toLowerCase() === 'iframe') {
        window.__iframeStyle = ''
        el.addEventListener(
          'load',
          () => {
            window.__printStubbed = 0
            try {
              el.contentWindow.print = () => (window.__printStubbed += 1)
            } catch {
              /* 同源，正常不会失败 */
            }
          },
          true,
        )
      }
      return el
    }
  })

  await page.evaluate(() => {
    const roots = [...document.querySelectorAll('#menubar-items .menu-root')]
    const fileBtn = roots.find((e) => e.textContent.trim() === '文件')
    fileBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    const pop = document.querySelector('.menu-drop')
    const labels = [...pop.querySelectorAll('.menu-item .mi-label')].map((e) => e.textContent)
    const idx = labels.findIndex((l) => l.includes('PDF'))
    if (idx < 0) throw new Error('菜单里没有 PDF 导出项：' + labels.join('/'))
    pop.querySelectorAll('.menu-item')[idx].click()
  })

  // 打印 iframe 存活约 800ms，抢在移除前抓
  let frame = null
  for (let i = 0; i < 30; i++) {
    frame = page.frames().find((f) => f !== page.mainFrame())
    if (frame) break
    await sleep(40)
  }
  if (!frame) throw new Error('没抓到打印 iframe')

  await frame.evaluate(() => document.fonts?.ready).catch(() => {})
  report.frame = await frame.evaluate(() => {
    const b = document.querySelector('.math-block')
    if (!b) return { error: '打印文档里没有 .math-block' }
    const katex = b.querySelector('.katex')
    const vlistT = b.querySelector('.vlist-t')
    const cs = katex ? getComputedStyle(katex) : null
    const em = parseFloat(getComputedStyle(b).fontSize) || 16
    const rect = b.getBoundingClientRect()
    return {
      docBytes: document.documentElement.outerHTML.length,
      hasFontFace: [...document.styleSheets].some((s) => {
        try {
          return [...s.cssRules].some((r) => r instanceof CSSFontFaceRule)
        } catch {
          return false
        }
      }),
      fontFamily: cs?.fontFamily?.slice(0, 32) ?? null,
      katexFontApplied: !!cs && /KaTeX_Main/.test(cs.fontFamily),
      vlistDisplay: vlistT ? getComputedStyle(vlistT).display : null,
      vlistOk: !!vlistT && getComputedStyle(vlistT).display === 'inline-table',
      fontLoaded: document.fonts.check('16px KaTeX_Main'),
      overflow: Math.round(b.scrollWidth - b.clientWidth),
      heightEm: +(rect.height / em).toFixed(2),
      stacked: rect.height / em > 1.9,
      iframeWidth: window.innerWidth,
    }
  })
  // 应用会在字体就绪后两帧再调 print()，这里等它真的被调用（桩计数在父窗口上）
  for (let i = 0; i < 40 && !(await page.evaluate(() => window.__printStubbed)); i++) await sleep(50)
  report.printCalled = await page.evaluate(() => window.__printStubbed || 0)

  const f = report.frame
  report.pass =
    !f.error &&
    f.hasFontFace &&
    f.katexFontApplied &&
    f.vlistOk &&
    f.fontLoaded === true &&
    f.stacked &&
    Math.abs(f.overflow) <= 1 &&
    report.printCalled === 1 &&
    report.errors.length === 0
} catch (e) {
  report.errors.push('fatal: ' + (e instanceof Error ? e.message : String(e)))
} finally {
  try {
    await browser?.close()
  } catch {
    /* ignore */
  }
  child.kill()
}

console.log(JSON.stringify(report, null, 1))
process.exit(report.pass ? 0 : 1)
