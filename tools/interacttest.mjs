/**
 * 打包产物交互验收（真进程 + 真实输入管线）
 *
 * 用 CDP 连上 release/Lypora/Lypora.exe，用真实鼠标事件验证两件事：
 *   1) Ctrl + 滚轮：字号连续变大、页面本身没被 zoom（innerWidth 不变）、顶部浮层出现、字号落盘
 *   2) 表格列宽：分隔线可 hover → 拖动后左列变宽、邻列补偿、整表宽度不变 → 重开文档仍生效
 *
 * 为什么单独做：verify.mjs 跑的是 Edge 里的同一份 dist，只覆盖渲染层逻辑；打包版还多一层
 * Electron 外壳（Ctrl+滚轮的页面 zoom 拦截、localStorage 落盘路径），必须真跑一遍。
 *
 * 用法：node tools/interacttest.mjs
 */
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..')
const EXE = path.join(ROOT, 'release', 'Lypora', 'Lypora.exe')
const PORT = 9339
const ART = path.join(ROOT, 'artifacts')

if (!existsSync(EXE)) {
  console.error(`找不到可执行文件：${EXE}，先跑 node tools/pack-win.mjs`)
  process.exit(2)
}

// playwright-core 是 CJS，动态 import 后 chromium 可能挂在 default 上
const pw = await import(
  pathToFileURL(path.join(ROOT, 'core', 'node_modules', 'playwright-core', 'index.js')).href
)
const { chromium } = pw.chromium ? pw : pw.default

const profile = mkdtempSync(path.join(tmpdir(), 'lypora-interact-'))
const env = { ...process.env }
// 宿主会注入 ELECTRON_RUN_AS_NODE，带着它主进程里 ipcMain 是 undefined
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(EXE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`], {
  cwd: ROOT,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
})
let childOut = ''
child.stdout.on('data', (d) => (childOut += d.toString()))
child.stderr.on('data', (d) => (childOut += d.toString()))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitDevtools(timeoutMs = 25000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      if (res.ok) return await res.json()
    } catch {
      /* 窗口还没起来 */
    }
    await sleep(400)
  }
  throw new Error('DevTools 端口未就绪')
}

const report = { pass: false, fontZoom: {}, tableCols: {}, errors: [] }
let browser = null

try {
  await waitDevtools()
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`)
  const ctx = browser.contexts()[0]
  const page = ctx.pages()[0] ?? (await ctx.waitForEvent('page'))
  page.on('pageerror', (e) => report.errors.push('pageerror: ' + e.message))
  await page.waitForSelector('.cm-editor', { timeout: 20000 })
  await sleep(900)

  const fontPx = () =>
    page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--content-font-size').trim(),
    )

  /* ---------- 1. Ctrl + 滚轮 ---------- */
  const fz = report.fontZoom
  fz.initialInnerWidth = await page.evaluate(() => window.innerWidth)
  fz.steps = [await fontPx()]
  await page.mouse.move(700, 460)
  await page.keyboard.down('Control')
  for (let i = 0; i < 5; i++) {
    await page.mouse.wheel(0, -100)
    await sleep(45)
    fz.steps.push(await fontPx())
  }
  fz.osd = await page.evaluate(() => {
    const el = document.getElementById('font-osd')
    return { text: el.textContent, on: el.classList.contains('on') }
  })
  await page.screenshot({ path: path.join(ART, '33-exe-font-zoom.png') })
  await page.keyboard.up('Control')
  await sleep(500)
  fz.finalInnerWidth = await page.evaluate(() => window.innerWidth)
  fz.stored = await page.evaluate(() => localStorage.getItem('lypora:fontSize'))

  const nums = fz.steps.map((v) => parseFloat(v))
  fz.monotonic = nums.every((v, i) => i === 0 || v > nums[i - 1])
  fz.stepOk = nums.slice(1).every((v, i) => v - nums[i] > 0 && v - nums[i] <= 2.6)
  fz.osdOk = /px · \d+%/.test(fz.osd.text) && fz.osd.on
  fz.noPageZoom = fz.initialInnerWidth === fz.finalInnerWidth
  fz.persisted = Math.abs(parseFloat(fz.stored) - nums[nums.length - 1]) < 0.05
  fz.pass = fz.monotonic && fz.stepOk && fz.osdOk && fz.noPageZoom && fz.persisted

  // 复位字号，避免影响列宽断言
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--content-font-size', '16px')
    localStorage.setItem('lypora:fontSize', '16')
    localStorage.removeItem('lypora:tableCols')
  })

  /* ---------- 2. 表格列宽 ---------- */
  const tc = report.tableCols
  const focusTable = async () => {
    await page.evaluate(async () => {
      const sc = document.getElementById('editor-scroll')
      for (let y = 0; y <= sc.scrollHeight; y += 150) {
        sc.scrollTop = y
        await new Promise((r) => setTimeout(r, 25))
        if (document.querySelector('.cm-table-widget')) break
      }
      await new Promise((r) => setTimeout(r, 120))
      document.querySelector('.cm-table-widget')?.scrollIntoView({ block: 'center' })
      await new Promise((r) => setTimeout(r, 200))
    })
    await sleep(350)
  }
  const tableState = () =>
    page.evaluate(() => {
      const w = document.querySelector('.cm-table-widget')
      if (!w) return null
      const stage = w.querySelector('.cm-table-stage')
      return {
        grips: w.querySelectorAll('.cm-col-grip').length,
        cols: w.querySelectorAll('col').length,
        widths: [...w.querySelectorAll('thead th')].map((t) =>
          Math.round(t.getBoundingClientRect().width),
        ),
        tableWidth: Math.round(w.querySelector('table').getBoundingClientRect().width),
        manual: stage.classList.contains('manual'),
        cursor: getComputedStyle(w.querySelector('.cm-col-grip')).cursor,
      }
    })

  await focusTable()
  tc.before = await tableState()
  const box = await page.locator('.cm-table-widget .cm-col-grip').first().boundingBox()
  const gx = box.x + box.width / 2
  const gy = box.y + 40
  await page.mouse.move(gx, gy)
  await sleep(160)
  tc.hoverOpacity = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.cm-col-grip'), '::after').opacity,
  )
  await page.screenshot({ path: path.join(ART, '34-exe-grip-hover.png') })

  await page.mouse.down()
  await page.mouse.move(gx + 70, gy, { steps: 12 })
  await sleep(160)
  tc.during = await page.evaluate(() => ({
    badge: document.querySelector('.cm-col-badge')?.textContent ?? null,
    on: document.querySelector('.cm-col-badge')?.classList.contains('on') ?? false,
    cursor: getComputedStyle(document.body).cursor,
    widths: [...document.querySelector('.cm-table-widget').querySelectorAll('thead th')].map((t) =>
      Math.round(t.getBoundingClientRect().width),
    ),
  }))
  await page.screenshot({ path: path.join(ART, '35-exe-col-drag.png') })
  await page.mouse.up()
  await sleep(350)
  tc.after = await tableState()
  tc.stored = await page.evaluate(() => localStorage.getItem('lypora:tableCols'))

  // 重开文档（reload 等价于重新渲染整篇）后列宽是否还在
  await page.reload({ waitUntil: 'domcontentloaded' })
  await sleep(1200)
  await focusTable()
  tc.afterReload = await tableState()

  const b = tc.before
  const a = tc.after
  tc.gripCountOk = b.grips === b.cols - 1
  tc.cursorOk = b.cursor === 'col-resize'
  tc.hoverOk = Number(tc.hoverOpacity) > 0.2
  tc.dragOk = Math.abs(a.widths[0] - b.widths[0] - 70) <= 8
  tc.neighborCompensated = Math.abs(a.widths[0] + a.widths[1] - (b.widths[0] + b.widths[1])) <= 2
  tc.widthStable = Math.abs(a.tableWidth - b.tableWidth) <= 2
  tc.badgeLive = /^\d+ px · \d+%$/.test(tc.during.badge ?? '') && tc.during.on
  tc.persisted =
    tc.afterReload?.manual === true &&
    tc.afterReload.widths.every((w, i) => Math.abs(w - a.widths[i]) <= 2)
  tc.pass = [
    tc.gripCountOk,
    tc.cursorOk,
    tc.hoverOk,
    tc.dragOk,
    tc.neighborCompensated,
    tc.widthStable,
    tc.badgeLive,
    tc.persisted,
  ].every(Boolean)

  await page.evaluate(() => localStorage.removeItem('lypora:tableCols'))
  report.pass = fz.pass && tc.pass
} catch (e) {
  report.errors.push(String(e && e.stack ? e.stack.split('\n')[0] : e))
} finally {
  try {
    await browser?.close()
  } catch {
    /* CDP 已断 */
  }
  child.kill()
  await sleep(1200)
  try {
    execFileSync('taskkill', ['/F', '/IM', 'Lypora.exe'], { stdio: 'ignore' })
  } catch {
    /* 已经退出 */
  }
}

if (childOut.includes('ERROR') && report.errors.length === 0) {
  // 打包版启动时的 Node 警告不算失败，只留档
  report.childStderr = childOut.split('\n').filter((l) => l.includes('ERROR')).slice(0, 2)
}

console.log(JSON.stringify(report, null, 2))
process.exit(report.pass ? 0 : 1)
