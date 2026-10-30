import { chromium } from 'playwright-core'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const PAGE_URL = process.env.PAGE_URL || 'http://127.0.0.1:4173/index.html'
const OUT = fileURLToPath(new URL('../artifacts/', import.meta.url))
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ executablePath: EDGE, headless: true })
const errors = []

const page = await browser.newPage({ viewport: { width: 1440, height: 940 }, deviceScaleFactor: 2 })
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('[console] ' + m.text())
})
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message))

await page.goto(PAGE_URL, { waitUntil: 'networkidle' })
await page.waitForTimeout(800)

/** 逐段滚动，直到目标元素进入 DOM（CM6 虚拟滚动） */
async function scrollUntil(selector) {
  return page.evaluate(async (sel) => {
    const sc = document.getElementById('editor-scroll')
    const max = sc.scrollHeight
    for (let y = 0; y <= max; y += 120) {
      sc.scrollTop = y
      await new Promise((r) => setTimeout(r, 30))
      if (document.querySelector(sel)) {
        sc.scrollTop = Math.max(0, y - 120)
        await new Promise((r) => setTimeout(r, 120))
        return y
      }
    }
    return -1
  }, selector)
}

const count = (sel) => page.locator(sel).count()

const report = { steps: {}, errors }

// ---------- 步骤 1：文档顶部 ----------
await page.evaluate(() => (document.getElementById('editor-scroll').scrollTop = 0))
await page.waitForTimeout(400)
report.steps.top = {
  firstLineText: await page.locator('.cm-line').first().innerText(),
  h1: await count('.md-h1'),
  h2: await count('.md-h2'),
  strong: await count('.md-strong'),
  em: await count('.md-em'),
  strike: await count('.md-strike'),
  inlineCode: await count('.md-code-inline'),
  link: await count('.md-link'),
  quoteLine: await count('.md-quote-line'),
  bullet: await count('.cm-bullet-widget'),
  taskBox: await count('.cm-task-box'),
  mathInline: await count('.cm-math-inline .katex'),
  langLabel: await count('.cm-lang-label'),
  tocItems: await count('.outline-item'),
  statusWords: await page.locator('#st-words').innerText(),
}
await page.screenshot({ path: `${OUT}/01-desktop-top.png` })

// ---------- 步骤 2：代码块 ----------
const yCode = await scrollUntil('.cm-lang-label')
await page.waitForTimeout(300)
report.steps.code = {
  y: yCode,
  codeLine: await count('.md-code-line'),
  langLabel: await count('.cm-lang-label'),
  tokKw: await count('.tok-kw'),
  tokStr: await count('.tok-str'),
  tokCom: await count('.tok-com'),
}
await page.screenshot({ path: `${OUT}/02-desktop-code.png` })

// ---------- 步骤 3：表格 ----------
const yTable = await scrollUntil('.cm-table-widget table')
await page.waitForTimeout(300)
report.steps.table = {
  y: yTable,
  table: await count('.cm-table-widget table'),
  rows: await count('.cm-table-widget tbody tr'),
  th: await count('.cm-table-widget th'),
  firstCell: (await page.locator('.cm-table-widget th').first().innerText().catch(() => '')).trim(),
}
await page.screenshot({ path: `${OUT}/03-desktop-table.png` })

// ---------- 步骤 4：块公式 + 分割线 ----------
const yMath = await scrollUntil('.cm-math-block .katex-display')
await page.waitForTimeout(300)
report.steps.math = {
  y: yMath,
  mathBlock: await count('.cm-math-block .katex-display'),
  hr: await count('.cm-hr-widget hr'),
}
await page.screenshot({ path: `${OUT}/04-desktop-math.png` })

// ---------- 步骤 5：任务复选框可交互 ----------
await page.evaluate(() => (document.getElementById('editor-scroll').scrollTop = 0))
await scrollUntil('.cm-task-box')
await page.waitForTimeout(300)
let toggle = 'skipped'
if ((await count('.cm-task-box')) >= 3) {
  const before = await page.locator('.cm-task-box').nth(2).getAttribute('aria-checked')
  await page.locator('.cm-task-box').nth(2).click()
  await page.waitForTimeout(400)
  const after = await page.locator('.cm-task-box').nth(2).getAttribute('aria-checked')
  toggle = `${before} -> ${after}`
}
report.steps.toggle = toggle
await page.screenshot({ path: `${OUT}/05-desktop-tasks.png` })

// ---------- 步骤 6：源码模式无损 ----------
await page.evaluate(() => (document.getElementById('editor-scroll').scrollTop = 0))
await page.waitForTimeout(200)
await page.mouse.click(700, 300) // 让编辑器拿到焦点
await page.keyboard.press('Control+/')
await page.waitForTimeout(500)
// CM6 虚拟滚动：源码模式也必须逐屏滚动累积文本，否则视口外的表格/代码围栏读不到（V9 同一坑）
const srcText = await page.evaluate(async () => {
  const sc = document.getElementById('editor-scroll')
  const prev = sc.scrollTop
  let acc = ''
  for (let y = 0; y <= sc.scrollHeight; y += 260) {
    sc.scrollTop = y
    await new Promise((r) => setTimeout(r, 40))
    acc += '\n' + (document.querySelector('.cm-content')?.textContent || '')
  }
  sc.scrollTop = prev
  await new Promise((r) => setTimeout(r, 120))
  return acc
})
report.steps.source = {
  hasHeadingMark: srcText.includes('## 行内元素'),
  hasPipe: srcText.includes('| 模块 | 职责 |'),
  hasFence: srcText.includes('```typescript'),
  chip: await page.locator('#chip-mode').innerText(),
}
await page.screenshot({ path: `${OUT}/06-source-mode.png` })
// 退出源码模式：滚动 evaluate 之后焦点可能不在编辑器上，先点回正文再按快捷键，
// 否则快捷键落空，后面所有块级断言都会因为"还在源码模式"而全为 0。
await page.locator('.cm-content').click({ position: { x: 40, y: 24 } })
await page.waitForTimeout(150)
await page.keyboard.press('Control+/')
await page.waitForTimeout(400)
report.steps.source.chipAfterExit = await page.locator('#chip-mode').innerText()

/** 菜单栏操作封装：菜单靠 mousedown 打开，必须用真实鼠标 */
async function openMenu(label) {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(100)
  await page.locator('#menubar-items .menu-root', { hasText: label }).click()
  await page.waitForTimeout(250)
}
async function clickMenuItem(index) {
  await page.locator('.menu-drop .menu-item').nth(index).click()
  await page.waitForTimeout(300)
}

// ---------- 步骤 7：主题（走新菜单栏：主题 → Night） ----------
const themeOrder = ['Github', 'Night', 'Pixyll', 'Whitey', 'Vue', 'Newsprint']
const themeResult = {}
for (let i = 0; i < themeOrder.length; i++) {
  await openMenu('主题')
  await clickMenuItem(i)
  themeResult[themeOrder[i]] = await page.evaluate(() => ({
    id: document.documentElement.dataset.theme,
    bg: getComputedStyle(document.body).backgroundColor,
    fg: getComputedStyle(document.body).color,
  }))
}
// 停在 Night 上截一张深色表格图
await openMenu('主题')
await clickMenuItem(1)
await page.evaluate(() => (document.getElementById('editor-scroll').scrollTop = 0))
await scrollUntil('.cm-table-widget table')
await page.waitForTimeout(300)
report.steps.theme = themeResult
await page.screenshot({ path: `${OUT}/07-theme-night-table.png` })
await openMenu('主题')
await clickMenuItem(0)

// ---------- 步骤 8：专注模式 ----------
await page.evaluate(() => (document.getElementById('editor-scroll').scrollTop = 0))
await page.waitForTimeout(200)
await page.keyboard.press('F8')
await page.waitForTimeout(500)
report.steps.focus = {
  dimmed: await count('.md-focus-dim'),
  active: await page.locator('#btn-focus').evaluate((el) => el.classList.contains('on')),
}
await page.screenshot({ path: `${OUT}/08-focus-mode.png` })
await page.keyboard.press('F8')

// ---------- 步骤 9：导出 HTML 管线 ----------
await page.evaluate(() => (document.getElementById('editor-scroll').scrollTop = 0))
let exportInfo = 'skipped'
try {
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }),
    page.evaluate(() => {
      // 文件菜单里「导出 HTML」是第 7 项（含分隔线不影响 .menu-item 索引）
      const items = [...document.querySelectorAll('#menubar-items .menu-root')]
      const fileBtn = items.find((e) => e.textContent.trim() === '文件')
      fileBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      const pop = document.querySelector('.menu-drop')
      const labels = [...pop.querySelectorAll('.menu-item .mi-label')].map((e) => e.textContent)
      const idx = labels.indexOf('导出 HTML')
      pop.querySelectorAll('.menu-item')[idx].click()
    }),
  ])
  const target = `${OUT}/export-test.html`
  await dl.saveAs(target)
  const html = fs.readFileSync(target, 'utf8')
  exportInfo = {
    suggestedName: dl.suggestedFilename(),
    bytes: html.length,
    hasH1: /<h1>/.test(html),
    hasTable: /<table>/.test(html),
    hasCodeBlock: /class="code-block"/.test(html),
    hasKatex: /class="katex"/.test(html),
    hasTask: /class="task/.test(html),
    hasThemeVars: /--content-width:/.test(html),
  }
} catch (e) {
  exportInfo = 'FAILED: ' + e.message
}
report.steps.export = exportInfo

// ---------- 步骤 10：PC 布局对齐参考实现 ----------
await page.evaluate(() => (document.getElementById('editor-scroll').scrollTop = 0))
await page.waitForTimeout(200)
report.steps.layout = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const sb = document.getElementById('sidebar').getBoundingClientRect()
  const ed = document.querySelector('.editor-wrap').getBoundingClientRect()
  const out = {
    menuRoots: [...document.querySelectorAll('#menubar-items .menu-root')].map((e) => e.textContent.trim()),
    sidebarOnLeft: sb.right <= ed.left + 2,
    sidebarWidth: Math.round(sb.width),
    statusToggles: [...document.querySelectorAll('.statusbar .status-toggle')].map((e) => ({
      label: e.textContent.trim(),
      on: e.classList.contains('on'),
    })),
    noRightOutline: !document.querySelector('.outline'),
  }
  // 切到文件树，验证 panes 互斥
  const filesTab = document.querySelector('#sidebar .tab[data-tab="files"]')
  filesTab.click()
  await sleep(260)
  out.filesTabVisiblePanes = [...document.querySelectorAll('.pane')].filter((x) => !x.hidden).map((x) => x.id)
  out.filesEmptyHint = document.querySelector('#pane-files .empty-hint')?.textContent?.trim().slice(0, 12) ?? null
  document.querySelector('#sidebar .tab[data-tab="outline"]').click()
  await sleep(260)
  out.outlineVisiblePanes = [...document.querySelectorAll('.pane')].filter((x) => !x.hidden).map((x) => x.id)
  return out
})

// ---------- 步骤 11：页面宽度可调（菜单预设 / 全宽 / 拖动把手 / 刷新后保持） ----------
await page.evaluate(() => (document.getElementById('editor-scroll').scrollTop = 0))
const widthOf = () =>
  page.evaluate(() => {
    const host = document.getElementById('editor-host')
    return {
      cssVar: getComputedStyle(document.documentElement).getPropertyValue('--content-width').trim(),
      hostWidth: Math.round(host.getBoundingClientRect().width),
      full: document.body.classList.contains('full-width'),
      gripVisible: document.getElementById('width-grip').offsetParent !== null,
    }
  })
const widthSteps = { initial: await widthOf() }

// 11a 菜单：显示 → 页面宽度 → 宽（1080）
await openMenu('显示')
await page.locator('.menu-drop .menu-item', { hasText: '页面宽度' }).hover()
await page.waitForTimeout(250)
widthSteps.subItems = await page.locator('.menu-drop.sub .menu-item .mi-label').allInnerTexts()
await page.locator('.menu-drop.sub .menu-item', { hasText: '宽（1080）' }).click()
await page.waitForTimeout(350)
widthSteps.wide = await widthOf()
await page.screenshot({ path: `${OUT}/11-width-wide.png` })

// 11b 全宽：把手应当隐藏
await openMenu('显示')
await page.locator('.menu-drop .menu-item', { hasText: '页面宽度' }).hover()
await page.waitForTimeout(200)
await page.locator('.menu-drop.sub .menu-item', { hasText: '全宽' }).click()
await page.waitForTimeout(350)
widthSteps.fullMode = await widthOf()
await page.screenshot({ path: `${OUT}/12-width-full.png` })

// 11c 拖把手：860 → 左拖 110px 应得到 640（居中对称，宽度 = 2×中心距）
await openMenu('显示')
await page.locator('.menu-drop .menu-item', { hasText: '页面宽度' }).hover()
await page.waitForTimeout(200)
await page.locator('.menu-drop.sub .menu-item', { hasText: '标准（860）' }).click()
await page.waitForTimeout(350)
widthSteps.beforeDrag = await widthOf()
const gb = await page.locator('#width-grip').boundingBox()
await page.mouse.move(gb.x + gb.width / 2, 420)
await page.mouse.down()
await page.mouse.move(gb.x + gb.width / 2 - 110, 420, { steps: 14 })
await page.mouse.up()
await page.waitForTimeout(400)
widthSteps.afterDrag = await widthOf()
widthSteps.stored = await page.evaluate(() => localStorage.getItem('lypora:pageWidth'))
await page.screenshot({ path: `${OUT}/13-width-dragged.png` })

// 11d 刷新后仍生效
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(700)
widthSteps.afterReload = await widthOf()
report.steps.width = widthSteps

// 复位到标准，避免影响后续截图
await page.evaluate(() => localStorage.setItem('lypora:pageWidth', '860'))
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(600)

// ---------- 步骤 12：Ctrl + 滚轮平滑调字号 ----------
const fontPx = () =>
  page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--content-font-size').trim())

const zoom = { start: await fontPx() }
await page.mouse.move(760, 460)
await page.keyboard.down('Control')
zoom.wheelSteps = [zoom.start]
for (let i = 0; i < 5; i++) {
  await page.mouse.wheel(0, -100)
  await page.waitForTimeout(40)
  zoom.wheelSteps.push(await fontPx())
}
zoom.osd = await page.evaluate(() => ({
  text: document.getElementById('font-osd').textContent,
  on: document.getElementById('font-osd').classList.contains('on'),
}))
await page.screenshot({ path: `${OUT}/14-font-wheel.png` })
// 触控板式微增量：必须出现小数并逐帧递增（连续、非跳变）
zoom.trackpad = []
for (let i = 0; i < 6; i++) {
  await page.mouse.wheel(0, -12)
  await page.waitForTimeout(18)
  zoom.trackpad.push(await fontPx())
}
await page.keyboard.up('Control')
await page.waitForTimeout(450)
zoom.stored = await page.evaluate(() => localStorage.getItem('lypora:fontSize'))

const wheelNums = zoom.wheelSteps.map((v) => parseFloat(v))
const trackNums = zoom.trackpad.map((v) => parseFloat(v))
zoom.monotonic = wheelNums.every((v, i) => i === 0 || v > wheelNums[i - 1])
zoom.stepSane = wheelNums.slice(1).every((v, i) => v - wheelNums[i] > 0 && v - wheelNums[i] <= 1.6)
zoom.continuous = trackNums.every((v, i) => i === 0 || v > trackNums[i - 1])
zoom.fractional = trackNums.some((v) => Math.abs(v - Math.round(v)) > 0.001)
zoom.osdOk = /px · \d+%/.test(zoom.osd.text) && zoom.osd.on
zoom.pass = zoom.monotonic && zoom.stepSane && zoom.continuous && zoom.fractional && zoom.osdOk
report.steps.fontZoom = zoom

// ---------- 步骤 13：表格列宽拖拽 ----------
await page.evaluate(() => {
  document.documentElement.style.setProperty('--content-font-size', '16px')
  localStorage.setItem('lypora:fontSize', '16')
  localStorage.removeItem('lypora:tableCols')
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(700)

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
  await page.waitForTimeout(300)
}
const tableState = () =>
  page.evaluate(() => {
    const w = document.querySelector('.cm-table-widget')
    if (!w) return null
    const table = w.querySelector('table')
    const stage = w.querySelector('.cm-table-stage')
    const sr = stage.getBoundingClientRect()
    const cells = [...w.querySelectorAll('thead th')]
    const grips = [...w.querySelectorAll('.cm-col-grip')]
    return {
      cols: w.querySelectorAll('col').length,
      grips: grips.length,
      widths: cells.map((t) => Math.round(t.getBoundingClientRect().width)),
      tableWidth: Math.round(table.getBoundingClientRect().width),
      manual: stage.classList.contains('manual'),
      cursor: grips[0] ? getComputedStyle(grips[0]).cursor : null,
      // 每条分隔线的 left 与真实列右边界的偏差（V33：必须恒为 0）
      gripDrift: grips.map((g, i) =>
        cells[i]
          ? Math.round(parseFloat(g.style.left || '0') - (cells[i].getBoundingClientRect().right - sr.left))
          : null,
      ),
    }
  })

const driftOk = (d) => Array.isArray(d) && d.length > 0 && d.every((v) => v !== null && Math.abs(v) <= 1)

await focusTable()
const tcols = { before: await tableState() }
const gripBox = await page.locator('.cm-table-widget .cm-col-grip').first().boundingBox()
const gripX = gripBox.x + gripBox.width / 2
const gripY = gripBox.y + 40
await page.mouse.move(gripX, gripY)
await page.waitForTimeout(150)
tcols.hoverLine = await page.evaluate(() => getComputedStyle(document.querySelector('.cm-col-grip'), '::after').opacity)
await page.screenshot({ path: `${OUT}/15-col-grip-hover.png` })

await page.mouse.down()
await page.mouse.move(gripX + 70, gripY, { steps: 10 })
await page.waitForTimeout(140)
tcols.during = await page.evaluate(() => ({
  badge: document.querySelector('.cm-col-badge')?.textContent ?? null,
  badgeOn: document.querySelector('.cm-col-badge')?.classList.contains('on') ?? false,
  bodyClass: document.body.className,
  widths: [...document.querySelector('.cm-table-widget').querySelectorAll('thead th')].map((t) =>
    Math.round(t.getBoundingClientRect().width),
  ),
}))
// 拖动当下分隔线就要贴住新的列边界（V33：表格总宽不变，RO 不触发，必须主动同步）
tcols.duringGripDrift = (await tableState())?.gripDrift ?? null
await page.screenshot({ path: `${OUT}/16-col-drag.png` })
await page.mouse.up()
await page.waitForTimeout(300)
tcols.after = await tableState()
tcols.stored = await page.evaluate(() => localStorage.getItem('lypora:tableCols'))

/* 同一根分隔线紧接着拖第二次 —— 用户报告的"第一次生效、第二次失效，必须切源码模式
   再切回才能再拖"的回归断言。松手后不做任何切换，直接按新位置再拖 -40px。 */
const grip2 = await page.locator('.cm-table-widget .cm-col-grip').first().boundingBox()
const g2x = grip2.x + grip2.width / 2
const g2y = grip2.y + 40
await page.mouse.move(g2x, g2y)
await page.waitForTimeout(120)
await page.mouse.down()
await page.mouse.move(g2x - 40, g2y, { steps: 8 })
await page.waitForTimeout(140)
const secondDuring = await tableState()
await page.mouse.up()
await page.waitForTimeout(250)
tcols.afterSecond = await tableState()
tcols.secondDrag = {
  widths: [tcols.after.widths, secondDuring?.widths ?? null, tcols.afterSecond?.widths ?? null],
  drift: tcols.afterSecond?.gripDrift ?? null,
  badge: await page.evaluate(() => document.querySelector('.cm-col-badge')?.textContent ?? null),
}
tcols.secondDragWorks =
  !!secondDuring &&
  !!tcols.afterSecond &&
  // 拖动中就已经在变（不是松手才生效）
  Math.abs(secondDuring.widths[0] - (tcols.after.widths[0] - 40)) <= 3 &&
  // 落点正确、相邻列补偿、总宽不变
  Math.abs(tcols.afterSecond.widths[0] - (tcols.after.widths[0] - 40)) <= 8 &&
  Math.abs(tcols.afterSecond.widths[0] + tcols.afterSecond.widths[1] -
    (tcols.after.widths[0] + tcols.after.widths[1])) <= 2 &&
  Math.abs(tcols.afterSecond.tableWidth - tcols.after.tableWidth) <= 2 &&
  driftOk(tcols.afterSecond.gripDrift)

await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(700)
await focusTable()
tcols.afterReload = await tableState()

// 拖动中断：按住分隔线拖到一半切源代码模式 → widget 被销毁，pointerup 不再派发（V31）
const gi = await page.locator('.cm-table-widget .cm-col-grip').first().boundingBox()
await page.mouse.move(gi.x + gi.width / 2, gi.y + 40)
await page.mouse.down()
await page.mouse.move(gi.x + gi.width / 2 + 60, gi.y + 40, { steps: 6 })
await page.waitForTimeout(140)
tcols.interruptDragging = await page.evaluate(() =>
  document.body.classList.contains('col-resizing'),
)
await page.keyboard.press('Control+/')
await page.waitForTimeout(450)
tcols.interrupt = await page.evaluate(() => ({
  body: document.body.className,
  cursor: getComputedStyle(document.body).cursor,
  grips: document.querySelectorAll('.cm-col-grip').length,
}))
await page.mouse.up()
await page.keyboard.press('Control+/')
await page.waitForTimeout(700)
await focusTable()
tcols.afterInterrupt = await tableState()
tcols.interruptClean =
  tcols.interruptDragging === true &&
  !/col-resizing/.test(tcols.interrupt.body) &&
  tcols.interrupt.cursor !== 'col-resize' &&
  tcols.interrupt.grips === 0
// 中断的拖动不落盘：列宽应停在上一次成功保存的值
tcols.interruptDiscarded = tcols.afterInterrupt.widths.every(
  (w, i) => Math.abs(w - tcols.afterReload.widths[i]) <= 2,
)

// 自动布局（没手动拖过）的表：改字号 → 各列重分配、表格总宽仍是 100% 不变。
// 这正是"只观察 table 的 RO 收不到通知"的场景，必须靠观察每个 th 才能吸附（V33）
await page.evaluate(() => localStorage.removeItem('lypora:tableCols'))
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(700)
await focusTable()
const autoBefore = await tableState()
await page.evaluate(() => document.documentElement.style.setProperty('--content-font-size', '22px'))
await page.waitForTimeout(600)
const autoAfter = await tableState()
await page.evaluate(() => document.documentElement.style.setProperty('--content-font-size', '16px'))
await page.waitForTimeout(400)
tcols.autoReflow = {
  widthsBefore: autoBefore.widths,
  widthsAfter: autoAfter.widths,
  drift: autoAfter.gripDrift,
  tableWidth: [autoBefore.tableWidth, autoAfter.tableWidth],
}
tcols.gripAlignsAfterAutoReflow =
  driftOk(autoAfter.gripDrift) &&
  autoAfter.widths.some((w, i) => Math.abs(w - autoBefore.widths[i]) > 3)

const b = tcols.before
const a = tcols.after
const d = tcols.during
tcols.gripCountOk = b.grips === b.cols - 1
tcols.cursorOk = b.cursor === 'col-resize'
tcols.hoverOk = Number(tcols.hoverLine) > 0.2
tcols.dragDeltaOk = Math.abs(a.widths[0] - b.widths[0] - 70) <= 8
tcols.neighborCompensated = Math.abs(a.widths[0] + a.widths[1] - (b.widths[0] + b.widths[1])) <= 2
tcols.thirdUntouched = Math.abs(a.widths[2] - b.widths[2]) <= 1
tcols.widthStable = Math.abs(a.tableWidth - b.tableWidth) <= 2
tcols.badgeLive = /^\d+ px · \d+%$/.test(d.badge ?? '') && d.badgeOn
tcols.duringMatches = Math.abs(d.widths[0] - a.widths[0]) <= 2
tcols.persisted =
  tcols.afterReload.manual === true &&
  tcols.afterReload.widths.every((w, i) => Math.abs(w - tcols.afterSecond.widths[i]) <= 2)
tcols.gripAligned = driftOk(b.gripDrift)
tcols.gripFollowsDrag = driftOk(tcols.duringGripDrift)
tcols.gripAlignsAfterReload = driftOk(tcols.afterReload.gripDrift)
tcols.pass = [
  tcols.gripCountOk,
  tcols.cursorOk,
  tcols.hoverOk,
  tcols.dragDeltaOk,
  tcols.neighborCompensated,
  tcols.thirdUntouched,
  tcols.widthStable,
  tcols.badgeLive,
  tcols.duringMatches,
  tcols.secondDragWorks,
  tcols.persisted,
  tcols.interruptClean,
  tcols.interruptDiscarded,
  tcols.gripAligned,
  tcols.gripFollowsDrag,
  tcols.gripAlignsAfterReload,
  tcols.gripAlignsAfterAutoReflow,
].every(Boolean)
report.steps.tableCols = tcols
await page.evaluate(() => localStorage.removeItem('lypora:tableCols'))

/* ---------- 步骤 15：更名前缀迁移（typorax:* → lypora:*）
   0.4.0 把产品名从旧名改成 Lypora，localStorage 前缀随之变化。
   老用户升级后不该丢字号/主题/列宽：migrateLegacySettings() 负责一次性搬迁。 */
await page.evaluate(() => {
  localStorage.clear()
  localStorage.setItem('typorax:fontSize', '22')
  localStorage.setItem('typorax:pageWidth', '1080')
  localStorage.setItem('typorax.customThemes', '[{"name":"legacy","css":":root{--bg-color:#123456}"}]')
  localStorage.setItem('typorax:tableCols', '{"sig":"x|2":{"r":[0.5,0.5]}}')
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(700)
const mig = await page.evaluate(() => {
  const keys = Object.keys(localStorage).sort()
  return {
    keys,
    newFont: localStorage.getItem('lypora:fontSize'),
    newWidth: localStorage.getItem('lypora:pageWidth'),
    newThemes: localStorage.getItem('lypora.customThemes'),
    newCols: localStorage.getItem('lypora:tableCols'),
    oldLeft: keys.filter((k) => k.startsWith('typorax')),
    fontSizeCss: getComputedStyle(document.documentElement).getPropertyValue('--content-font-size').trim(),
    flag: localStorage.getItem('lypora:migrated'),
  }
})
report.steps.migrate = {
  ...mig,
  valuesMigrated:
    mig.newFont === '22' && mig.newWidth === '1080' && !!mig.newThemes && !!mig.newCols,
  oldKeysRemoved: mig.oldLeft.length === 0,
  appliedToUi: mig.fontSizeCss === '22px',
  flagSet: mig.flag === '1',
  pass:
    mig.newFont === '22' &&
    mig.newWidth === '1080' &&
    !!mig.newThemes &&
    !!mig.newCols &&
    mig.oldLeft.length === 0 &&
    mig.fontSizeCss === '22px' &&
    mig.flag === '1',
}
await page.evaluate(() => localStorage.clear())

// ---------- 移动端 / 平板 ----------
const mobile = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Mobile Safari/537.36',
})
mobile.on('pageerror', (e) => errors.push('[mobile] ' + e.message))
await mobile.goto(PAGE_URL, { waitUntil: 'networkidle' })
await mobile.waitForTimeout(800)
report.steps.mobile = {
  toolbarVisible: await mobile.locator('#mobile-toolbar').isVisible(),
  toolbarButtons: await mobile.locator('#mobile-toolbar button').count(),
  sidebarVisible: await mobile.locator('#sidebar').isVisible(),
}
await mobile.screenshot({ path: `${OUT}/09-mobile.png` })

const tablet = await browser.newPage({ viewport: { width: 834, height: 1112 }, deviceScaleFactor: 2 })
await tablet.goto(PAGE_URL, { waitUntil: 'networkidle' })
await tablet.waitForTimeout(600)
await tablet.screenshot({ path: `${OUT}/10-tablet.png` })

await browser.close()
console.log(JSON.stringify(report, null, 2))
