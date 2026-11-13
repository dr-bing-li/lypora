/**
 * UI 验收：把 design-plans/ui-audit-v0.11.0.md 的 20 项发现固化成断言。
 *
 * 与 tabs-check.mjs 的分工：那边验"功能契约"（标签、脏标记、只读、整屏几何），
 * 这边验"看得清、点得到"——对比度（WCAG 相对亮度）、几何（留白/热区/对齐）、
 * 无障碍（焦点陷阱/对话框语义/焦点环）、以及几处必须中文化的界面文案。
 * 两边都会碰标签栏和排版面板，但断言的角度不重叠。
 *
 * 用法：
 *   node ui-check.mjs                     自动探测 4173，没有就跑 vite preview
 *   node ui-check.mjs --url http://...    指定地址（不自动起服务）
 *   node ui-check.mjs --only contrast     只跑一组（contrast|type|geometry|interactive|layout|mobile|regression）
 *   node ui-check.mjs --quiet             只打印失败项与汇总
 *
 * 退出码：0 全过 / 1 有失败。CI 与本地改完代码都能直接串上。
 */

import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
// 不删目录：宿主安全删除钩子对目录是 fail-closed（会卡到 ETIMEDOUT），用时间戳子目录
const RUN = new Date().toISOString().replace(/[:.]/g, '-')
const OUT = path.join(HERE, '..', 'artifacts', 'ui-check', RUN)

const argv = process.argv.slice(2)
const argOf = (k) => {
  const i = argv.indexOf(k)
  return i >= 0 ? argv[i + 1] : null
}
const QUIET = argv.includes('--quiet')
const ONLY = argOf('--only')
const FIXED_URL = argOf('--url')
const PAGE_URL = FIXED_URL || 'http://127.0.0.1:4173/index.html'

const GROUPS = ['contrast', 'type', 'geometry', 'interactive', 'layout', 'mobile', 'regression']
const enabled = (g) => !ONLY || ONLY === g

/* ---------------- 报告 ---------------- */

const report = { groups: {}, errors: [], pass: false, checks: 0, failed: 0 }
for (const g of GROUPS) report.groups[g] = { pass: 0, fail: 0, checks: [] }

/**
 * 一条断言。ok=true 记 pass，false 记 fail 并把 detail 写进 errors（供 CI 与人读）。
 * detail 一律写成「实测 vs 阈值」，失败时不用回去翻脚本。
 */
function check(group, name, ok, detail) {
  const g = report.groups[group]
  const rec = { id: `${group}/${name}`, ok: !!ok, detail: detail ?? '' }
  g.checks.push(rec)
  report.checks++
  if (ok) {
    g.pass++
    if (!QUIET) console.log(`PASS ${rec.id.padEnd(34)} ${rec.detail}`)
  } else {
    g.fail++
    report.failed++
    report.errors.push(`${rec.id} — ${rec.detail}`)
    console.log(`FAIL ${rec.id.padEnd(34)} ${rec.detail}`)
  }
  return !!ok
}

const warn = (msg) => console.log(`WARN ${msg}`)

/* ---------------- 浏览器内注入的度量工具 ---------------- */

/**
 * 在页面里装 window.__cc（单元素对比度）与 window.__cv（可见性/尺寸）。
 * 背景色向上回溯到第一个 alpha>0.5 的祖先 —— 这些元素大多直接坐在 body 或 chrome 上。
 */
async function installHelpers(page) {
  await page.evaluate(() => {
    const parse = (c) => {
      if (!c) return null
      const m = String(c).match(/rgba?\(([^)]+)\)/)
      if (!m) return null
      const p = m[1].split(/[,/\s]+/).filter(Boolean).map(Number)
      if (p.length < 3 || p.some((n) => Number.isNaN(n))) return null
      return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] }
    }
    const bgOf = (el) => {
      let n = el
      while (n && n !== document.documentElement) {
        const c = parse(getComputedStyle(n).backgroundColor)
        if (c && c.a > 0.5) return c
        n = n.parentElement
      }
      return parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 }
    }
    const lum = (c) => {
      const f = (v) => {
        v /= 255
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
      }
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
    }
    // window.__ratioEl(el) → 传入元素本身算对比度（面板里的元素没有稳定选择器时用）
    window.__ratioEl = (el) => {
      if (!el) return null
      const cs = getComputedStyle(el)
      const fg = parse(cs.color)
      if (!fg) return null
      const bg = bgOf(el)
      const l1 = lum(fg)
      const l2 = lum(bg)
      return {
        text: (el.textContent || '').trim().slice(0, 24),
        color: cs.color,
        bg: `rgb(${bg.r},${bg.g},${bg.b})`,
        fs: cs.fontSize,
        ratio: Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100,
      }
    }
    // window.__cc(sel, idx) → { text, color, bg, fs, ratio, w, h, visible }
    window.__cc = (sel, idx = 0) => {
      const el = document.querySelectorAll(sel)[idx]
      if (!el) return null
      const cs = getComputedStyle(el)
      const fg = parse(cs.color)
      if (!fg) return null
      const bg = bgOf(el)
      const l1 = lum(fg)
      const l2 = lum(bg)
      const hi = Math.max(l1, l2)
      const lo = Math.min(l1, l2)
      const r = el.getBoundingClientRect()
      return {
        sel,
        text: (el.textContent || '').trim().slice(0, 26),
        color: cs.color,
        bg: `rgb(${bg.r},${bg.g},${bg.b})`,
        fs: cs.fontSize,
        ratio: Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100,
        w: Math.round(r.width),
        h: Math.round(r.height),
        visible: !!(r.width && r.height) && cs.visibility !== 'hidden' && cs.display !== 'none',
      }
    }
    // 换行/截断类断言用：可点热区（含伪元素撑开后的盒）
    window.__box = (sel, idx = 0) => {
      const el = document.querySelectorAll(sel)[idx]
      if (!el) return null
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return {
        w: Math.round(r.width),
        h: Math.round(r.height),
        x: Math.round(r.left),
        y: Math.round(r.top),
        bottom: Math.round(r.bottom),
        left: Math.round(r.left),
        right: Math.round(r.right),
        pad: cs.padding,
        radius: cs.borderRadius,
        display: cs.display,
      }
    }
    window.__scrollH = (sel) => {
      const el = document.querySelector(sel)
      return el ? { client: el.clientHeight, scroll: el.scrollHeight, overflowX: el.scrollWidth > el.clientWidth + 1 } : null
    }
  })
}

/* ---------------- 服务 ---------------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function probe(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) })
    return res.ok
  } catch {
    return false
  }
}

/**
 * 没有现成服务就自己起一个，跑完关掉。
 * 「每轮改动后自动执行」的关键：不需要先手动开一个终端跑 vite preview。
 */
async function ensureServer() {
  if (FIXED_URL) return { url: FIXED_URL, child: null }
  const origin = new URL(PAGE_URL).origin
  if (await probe(PAGE_URL)) return { url: PAGE_URL, child: null }
  console.log(`[ui-check] 4173 没在跑，启动 vite preview…`)
  const isWin = process.platform === 'win32'
  const child = spawn(isWin ? 'npx.cmd' : 'npx', ['vite', 'preview', '--port', '4173', '--strictPort', '--host', '127.0.0.1'], {
    cwd: HERE,
    stdio: 'ignore',
    shell: isWin,
  })
  const t0 = Date.now()
  while (Date.now() - t0 < 60000) {
    if (await probe(PAGE_URL)) {
      console.log(`[ui-check] 服务就绪 ${origin}`)
      return { url: PAGE_URL, child }
    }
    await sleep(600)
  }
  throw new Error('vite preview 60s 内没起来（检查 dist 是否已构建）')
}

/* ---------------- 页面 ---------------- */

const THEME_KEY = 'lypora:theme' // store.ts 的 SETTINGS_PREFIX + 'theme'，值是 JSON 字符串

async function newPage(browser, { width = 1440, height = 900, theme = null, locale = 'zh-CN', scale = 1 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, locale })
  const page = await ctx.newPage()
  const errs = []
  page.on('console', (m) => {
    if (m.type() === 'error') errs.push('[console] ' + m.text())
  })
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message))
  if (theme) {
    // 必须在导航到同源页面后写 localStorage；用 addInitScript 更省一次往返
    await ctx.addInitScript(([k, v]) => {
      try {
        localStorage.setItem(k, v)
      } catch {
        /* file:// 下可能不可写，忽略 */
      }
    }, [THEME_KEY, JSON.stringify(theme)])
  }
  await page.goto(PAGE_URL, { waitUntil: 'networkidle' })
  await page.waitForSelector('.cm-content')
  await page.waitForTimeout(700)
  await installHelpers(page)
  page.__errs = errs
  return page
}

async function openMenu(page, id) {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(80)
  await page.locator(`#menubar-items .menu-root[data-menu="${id}"]`).click()
  await page.waitForTimeout(220)
}

/* ====================================================================== */
/*  1. 对比度                                                              */
/* ====================================================================== */

/**
 * 每组 [id, 名称, selector, 阈值, 取色索引]。
 * 阈值：正文与提示类文字 4.5（WCAG AA normal text）；图标/图形 3.0（AA non-text）。
 */
// 状态栏的只读值是裸 <span>（#st-words / #st-lines），分隔符是 .sep；开关是 status-toggle 按钮
const CONTRAST_LIGHT = [
  ['empty-hint', '侧栏空状态提示', '.empty-hint', 4.5, 0],
  ['menu-shortcut', '菜单快捷键提示', '.menu-drop .mi-shortcut', 4.5, 0],
  ['submenu-arrow', '子菜单箭头', '.menu-drop .mi-arrow', 3.0, 0],
  ['statusbar', '状态栏值文字', '#st-words', 4.5, 0],
  ['status-sep', '状态栏分隔符', '.statusbar .sep', 4.5, 0],
  ['status-btn', '状态栏开关文字', '#btn-source', 4.5, 0],
  ['tab-title', '标签标题', '#tabbar .tb-title', 4.5, 0],
  ['doc-body', '正文（回归，应 ≥7）', '.cm-content .cm-line', 7.0, 0],
]

const CONTRAST_DARK = [
  ['empty-hint', '侧栏空状态提示', '.empty-hint', 4.5, 0],
  ['statusbar', '状态栏值文字', '#st-words', 4.5, 0],
  ['status-btn', '状态栏开关文字', '#btn-source', 4.5, 0],
  ['tab-title', '标签标题', '#tabbar .tb-title', 4.5, 0],
  ['doc-body', '正文（回归，应 ≥7）', '.cm-content .cm-line', 7.0, 0],
]

async function runContrast(browser) {
  /* --- 浅色 --- */
  {
    const page = await newPage(browser, { theme: 'github' })
    // 空状态要先切到文件树（大纲默认有内容）
    await page.locator('.sidebar-tabs button[data-tab="files"]').click().catch(() => {})
    await page.waitForTimeout(300)

    // 快捷键提示在「文件」菜单里，子菜单箭头在「设置」菜单里，得分别打开
    await openMenu(page, 'file')
    await page.waitForTimeout(200)
    for (const [id, label, sel, min, idx] of CONTRAST_LIGHT) {
      if (sel.includes('.mi-shortcut') === false && sel.includes('.mi-arrow') === false) continue
      if (sel.includes('.mi-arrow')) continue
      const r = await page.evaluate(([s, i]) => window.__cc(s, i), [sel, idx])
      if (!r || !r.visible) {
        check('contrast', `${id}/light`, false, `${label} 没找到（${sel}）—— 选择器可能随重构变了`)
        continue
      }
      check('contrast', `${id}/light`, r.ratio >= min, `${label} ${r.ratio}:1（需 ≥${min}）${r.color} on ${r.bg}`)
    }
    await openMenu(page, 'settings')
    const arrow = await page.evaluate(() => window.__cc('.menu-drop .mi-arrow', 0))
    check(
      'contrast',
      'submenu-arrow/light',
      !!(arrow && arrow.visible && arrow.ratio >= 3.0),
      arrow ? `子菜单箭头 ${arrow.ratio}:1（需 ≥3）${arrow.color}，宽 ${arrow.w}px` : '设置菜单里找不到 .mi-arrow',
    )
    await page.screenshot({ path: path.join(OUT, 'contrast-menu.png') })
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)

    // 其余元素（空状态、状态栏、标签、正文）与菜单无关
    for (const [id, label, sel, min, idx] of CONTRAST_LIGHT) {
      if (sel.includes('.mi-')) continue
      const r = await page.evaluate(([s, i]) => window.__cc(s, i), [sel, idx])
      if (!r || !r.visible) {
        check('contrast', `${id}/light`, false, `${label} 没找到（${sel}）`)
        continue
      }
      check('contrast', `${id}/light`, r.ratio >= min, `${label} ${r.ratio}:1（需 ≥${min}）${r.color} on ${r.bg}`)
    }
    // 确认框：破坏性警告句
    await page.keyboard.press('Escape')
    await openMenu(page, 'file')
    await page.locator('.menu-drop .menu-item[data-mi="file-create"]').click()
    await page.waitForTimeout(500)
    await page.locator('.cm-content').click()
    await page.keyboard.type('x')
    await page.waitForTimeout(250)
    await page.keyboard.press('Control+w')
    await page.waitForTimeout(500)
    const dlgRatio = await page.evaluate(() => {
      const m = document.querySelector('.modal-mask[data-role="save-confirm"]')
      if (!m) return { found: false }
      // 正文段（不是 h3、不是按钮）就是那句警告
      const p = m.querySelector('.modal p')
      if (!p) return { found: false }
      const save = window.__cc.call(null, '.modal-mask[data-role="save-confirm"] .modal p')
      return { found: true, ...save, mask: getComputedStyle(m).backgroundColor }
    })
    check(
      'contrast',
      'confirm-warning/light',
      !!(dlgRatio.found && dlgRatio.ratio >= 4.5),
      dlgRatio.found ? `确认框警告句 ${dlgRatio.ratio}:1（需 ≥4.5）${dlgRatio.color}` : '没弹出三键确认框',
    )
    await page.screenshot({ path: path.join(OUT, 'contrast-confirm.png') })
    // 遮罩不透明度（DLG-2 后半）
    const maskAlpha = await page.evaluate(() => {
      const m = document.querySelector('.modal-mask[data-role="save-confirm"]')
      if (!m) return null
      const s = getComputedStyle(m).backgroundColor
      const p = String(s).match(/rgba?\(([^)]+)\)/)
      if (!p) return null
      const a = p[1].split(/[,/\s]+/).filter(Boolean).map(Number)[3]
      return a === undefined ? 1 : a
    })
    check('contrast', 'confirm-mask-alpha', maskAlpha != null && maskAlpha >= 0.4, `确认框遮罩 alpha = ${maskAlpha}（需 ≥0.4）`)
    await page.context().close()
  }

  /* --- 深色 --- */
  {
    const page = await newPage(browser, { theme: 'night' })
    await page.locator('.sidebar-tabs button[data-tab="files"]').click().catch(() => {})
    await page.waitForTimeout(300)
    for (const [id, label, sel, min, idx] of CONTRAST_DARK) {
      const r = await page.evaluate(([s, i]) => window.__cc(s, i), [sel, idx])
      if (!r || !r.visible) {
        check('contrast', `${id}/dark`, false, `${label} 没找到（${sel}）`)
        continue
      }
      check('contrast', `${id}/dark`, r.ratio >= min, `${label} ${r.ratio}:1（需 ≥${min}）${r.color} on ${r.bg}`)
    }
    // 排版面板内的分组标题与色值文本（DARK-2）
    await page.keyboard.press('Control+Shift+P')
    await page.waitForTimeout(1200)
    const panel = await page.evaluate(() => {
      // .ce-group 的第一个子元素就是 .ce-label（分组标题）
      const g = document.querySelector('.ce-group')
      const gt = g ? g.firstElementChild : null
      const hex = [...document.querySelectorAll('.ce-hex')].find((e) => window.__cc)
      // 取一个「看起来最淡」的 hex（浅色值 #ffffff 在深底上反而清楚，深色值才难读）
      const hexes = [...document.querySelectorAll('.ce-hex')]
      const darkest = hexes.sort((a, b) => {
        const l = (e) => {
          const m = String(getComputedStyle(e).color).match(/\(([^)]+)\)/)
          if (!m) return 0
          const p = m[1].split(/[,/\s]+/).filter(Boolean).map(Number)
          return 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]
        }
        return l(a) - l(b)
      })[0]
      return { group: window.__ratioEl(gt), hex: window.__ratioEl(darkest) }
    })
    check(
      'contrast',
      'layout-group-title/dark',
      !!(panel.group && panel.group.ratio >= 4.5),
      panel.group ? `排版分组标题「${panel.group.text}」${panel.group.ratio}:1（需 ≥4.5）` : '找不到 .ce-group 标题',
    )
    check(
      'contrast',
      'layout-hex/dark',
      !!(panel.hex && panel.hex.ratio >= 4.5),
      panel.hex ? `色值文本 ${panel.hex.text} ${panel.hex.ratio}:1（需 ≥4.5）` : '找不到 .ce-hex',
    )
    await page.screenshot({ path: path.join(OUT, 'contrast-dark-layout.png') })
    await page.context().close()
  }
}

/* ====================================================================== */
/*  2. 字号刻度                                                            */
/* ====================================================================== */

const CHROME_FONT_LADDER = [11, 12.5, 14, 16]

async function runType(browser) {
  const page = await newPage(browser, { theme: 'github' })
  const sizes = await page.evaluate(() => {
    const host = document.querySelectorAll('.menubar *, .statusbar *, .tabbar *, .sidebar *')
    const map = new Map()
    for (const e of host) {
      if (!(e instanceof HTMLElement)) continue
      const fs = parseFloat(getComputedStyle(e).fontSize)
      if (!fs) continue
      const key = String(Math.round(fs * 100) / 100)
      const label = e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.split(/\s+/)[0] : '')
      if (!map.has(key)) map.set(key, { n: 0, sample: label })
      map.get(key).n++
    }
    return [...map.entries()].sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))
  })
  report.groups.type.ladder = sizes.map(([s, v]) => `${s}px×${v.n}`).join(' ')
  const off = sizes.filter(([s]) => !CHROME_FONT_LADDER.some((x) => Math.abs(x - parseFloat(s)) < 0.16))
  check(
    'type',
    'chrome-ladder',
    off.length === 0,
    off.length ? `刻度外字号 ${off.map(([s, v]) => s + 'px(' + v.sample + '×' + v.n + ')').join(', ')}（只允许 ${CHROME_FONT_LADDER.join('/')}）` : `四档：${sizes.map(([s]) => s).join(' / ')}`,
  )

  // 模板卡片名称
  await page.keyboard.press('Control+Shift+P')
  await page.waitForTimeout(1200)
  const card = await page.evaluate(() => {
    const n = document.querySelector('.ce-style-name')
    const b = document.querySelector('.ce-style')
    if (!n) return null
    return {
      fs: parseFloat(getComputedStyle(n).fontSize),
      w: Math.round(b.getBoundingClientRect().width),
      h: Math.round(b.getBoundingClientRect().height),
    }
  })
  check('type', 'template-name', !!card && card.fs >= 11, card ? `模板卡片名 ${card.fs}px（需 ≥11），卡片 ${card.w}×${card.h}` : '找不到模板卡片')

  /* DARK-3：预览区与参数区的亮度差，压成一层薄雾就分不出来了 */
  const dark = await newPage(browser, { theme: 'night' })
  await dark.keyboard.press('Control+Shift+P')
  await dark.waitForTimeout(1200)
  const layers = await dark.evaluate(() => {
    const parse = (c) => {
      const m = String(c).match(/rgba?\(([^)]+)\)/)
      if (!m) return null
      const p = m[1].split(/[,/\s]+/).filter(Boolean).map(Number)
      return { r: p[0], g: p[1], b: p[2] }
    }
    const lum = (c) => (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255
    const a = parse(getComputedStyle(document.querySelector('.ce-preview')).backgroundColor)
    const b = parse(getComputedStyle(document.querySelector('.ce-settings')).backgroundColor)
    if (!a || !b) return null
    return { a: lum(a), b: lum(b), diff: Math.abs(lum(a) - lum(b)) }
  })
  check(
    'type',
    'layout-layer-dark',
    !!layers && layers.diff >= 0.08,
    layers ? `预览区/参数区亮度差 ${(layers.diff * 100).toFixed(1)}%（需 ≥8%）` : '取不到面板底色',
  )
  await dark.context().close()
  await page.context().close()
}

/* ====================================================================== */
/*  3. 几何                                                                */
/* ====================================================================== */

async function runGeometry(browser) {
  /* --- 正文留白：861–1160px 是笔记本最常见宽度，不能贴边 --- */
  const page = await newPage(browser, { theme: 'github' })
  for (const w of [1440, 1280, 1100, 1024, 900]) {
    await page.setViewportSize({ width: w, height: 860 })
    await page.waitForTimeout(420)
    const g = await page.evaluate(() => {
      // 基准是「编辑区可用区」(.editor-wrap = 侧栏右侧到窗口右侧)；
      // 不能用 .editor-host —— 它本身就是 max-width:860 居中后的盒子，拿它算恒为 0
      const line = document.querySelector('.cm-content .cm-line')
      const wrap = document.querySelector('.editor-wrap')
      const host = document.querySelector('.editor-host')
      const c = line.getBoundingClientRect()
      const wr = wrap.getBoundingClientRect()
      return {
        left: Math.round(c.left - wr.left),
        right: Math.round(wr.right - c.right),
        wrapW: Math.round(wr.width),
        overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
        hostPad: getComputedStyle(host).paddingLeft,
      }
    })
    // 1440 下由居中产生大留白；窄屏由 padding 保底 16px
    const min = w >= 1200 ? 40 : 16
    check('geometry', `doc-gutter@${w}`, g.left >= min && g.right >= min, `左 ${g.left} / 右 ${g.right}（需各 ≥${min}）padding-left=${g.hostPad}`)
    check('geometry', `no-overflow@${w}`, !g.overflowX, `横向溢出=${g.overflowX}`)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(350)

  /* --- 菜单：行高、根按钮、箭头、分组 --- */
  await openMenu(page, 'settings')
  const menu = await page.evaluate(() => {
    const item = document.querySelector('.menu-drop .menu-item')
    const root = document.querySelector('#menubar-items .menu-root')
    const arrow = document.querySelector('.menu-drop .mi-arrow')
    const r = (e) => (e ? e.getBoundingClientRect() : null)
    const groups = document.querySelectorAll('.menu-drop .mi-group')
    return {
      itemH: item ? Math.round(r(item).height) : 0,
      rootH: root ? Math.round(r(root).height) : 0,
      arrow: arrow ? { w: Math.round(r(arrow).width), h: Math.round(r(arrow).height), text: (arrow.textContent || '').trim() } : null,
      groups: groups.length,
      groupTexts: [...groups].map((e) => (e.textContent || '').trim()),
      submenuCount: document.querySelectorAll('.menu-drop .mi-arrow').length,
    }
  })
  check('geometry', 'menu-item-height', menu.itemH >= 28, `菜单项高 ${menu.itemH}px（需 ≥28）`)
  check('geometry', 'menu-root-height', menu.rootH >= 26, `菜单根按钮高 ${menu.rootH}px（需 ≥26）`)
  check('geometry', 'submenu-arrow-size', !!menu.arrow && menu.arrow.w >= 10 && menu.arrow.h >= 10, menu.arrow ? `箭头 ${menu.arrow.w}×${menu.arrow.h}（需 ≥10×10）文本「${menu.arrow.text}」` : '找不到箭头')
  check('geometry', 'settings-groups', menu.groups >= 2 && menu.submenuCount >= 4, `设置菜单分组标题 ${menu.groups} 个（需 ≥2），带子菜单 ${menu.submenuCount} 项`)
  await page.screenshot({ path: path.join(OUT, 'geometry-menu.png') })
  await page.keyboard.press('Escape')

  /* --- 标签关闭热区 --- */
  const closeBox = await page.evaluate(() => window.__box('#tabbar .tab-item .tb-close'))
  check('geometry', 'tab-close-hit', !!closeBox && closeBox.w >= 24 && closeBox.h >= 24, closeBox ? `关闭按钮热区 ${closeBox.w}×${closeBox.h}（需 ≥24×24）` : '找不到关闭按钮')

  /* --- 侧栏页签：选中态必须有指示条（三个页签只有图标，光靠底色认不出） --- */
  const sideTab = await page.evaluate(() => {
    const el = document.querySelector('.sidebar-tabs .tab.active')
    if (!el) return null
    const cs = getComputedStyle(el, '::after')
    const bar = parseFloat(cs.height)
    return {
      exists: cs.content && cs.content !== 'none' && cs.content !== 'normal',
      h: Number.isFinite(bar) ? Math.round(bar) : 0,
      bg: cs.backgroundColor,
      tabs: document.querySelectorAll('.sidebar-tabs .tab').length,
    }
  })
  check('geometry', 'sidebar-tab-indicator', !!sideTab && sideTab.exists && sideTab.h >= 2, sideTab ? `选中页签指示条 ${sideTab.h}px，${sideTab.tabs} 个页签，色 ${sideTab.bg}（需 ≥2px）` : '找不到选中的侧栏页签')

  /* --- 顶栏只有一行：菜单与标签并排（v0.11.2） --- */
  const row = await page.evaluate(() => {
    const mb = document.querySelector('.menubar')
    const tb = document.getElementById('tabbar')
    if (!mb || !tb || tb.hidden) return null
    const R = (e) => e.getBoundingClientRect()
    const m = R(mb)
    const t = R(tb)
    const items = R(document.querySelector('.menubar-items'))
    const fm = document.querySelector('#menubar-items .menu-root')
    const ft = tb.querySelector('.tab-item')
    const cy = (e) => (e.top + e.bottom) / 2
    return {
      nested: tb.closest('.menubar') === mb,
      mbH: Math.round(m.height),
      // 菜单盒子右沿与标签条左沿的水平关系。负数 = 标签条被顶到菜单底下去了
      gapLeft: Math.round(t.left - items.right),
      // 菜单文字与标签的中线是否在同一条水平线上
      centerDiff: fm && ft ? Math.round(Math.abs(cy(R(fm)) - cy(R(ft)))) : 99,
      // 菜单内容是否已经溢出自己的盒子、压在标签上（900px 那次的真实故障）
      menuOverflow: Math.floor(document.querySelector('.menubar-items').scrollWidth - items.width),
    }
  })
  check(
    'geometry',
    'menu-tabs-one-row',
    !!row && row.nested && row.mbH <= 48 && row.gapLeft >= 4 && row.centerDiff <= 4 && row.menuOverflow <= 0,
    row
      ? `顶栏 ${row.mbH}px 单行、标签内嵌=${row.nested}；菜单右沿到标签 ${row.gapLeft}px（需 ≥4）、中线差 ${row.centerDiff}px（需 ≤4）、菜单溢出 ${row.menuOverflow}px（需 ≤0）`
      : '标签栏此时不可见，无法量合并后的顶栏',
  )

  /* --- 状态栏：热区 + 只读值与开关的区分 --- */
  const stat = await page.evaluate(() => {
    const btn = document.querySelector('#btn-source')
    const img = document.querySelector('#btn-image-path')
    const val = document.querySelector('#st-words')
    const g = (e) => (e ? { w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height), color: getComputedStyle(e).color } : null)
    return { source: g(btn), image: g(img), value: g(val) }
  })
  check('geometry', 'statusbar-hit', !!stat.source && stat.source.h >= 26, stat.source ? `状态栏开关热区高 ${stat.source.h}px（需 ≥26）` : '找不到 #btn-source')
  check(
    'geometry',
    'statusbar-distinct',
    !!(stat.value && stat.source && stat.value.color !== stat.source.color),
    stat.value && stat.source ? `只读值 ${stat.value.color} vs 开关 ${stat.source.color}（应不同）` : '取不到状态栏元素',
  )

  /* --- 帮助文档里的表格宽度应与正文行长一致 --- */
  await openMenu(page, 'help')
  await page.locator('.menu-drop .menu-item[data-mi="help-shortcuts"]').click()
  await page.waitForTimeout(800)
  const tbl = await page.evaluate(() => {
    const t = document.querySelector('.cm-content table')
    const line = document.querySelector('.cm-content .cm-line')
    if (!t || !line) return null
    return { table: Math.round(t.getBoundingClientRect().width), line: Math.round(line.getBoundingClientRect().width) }
  })
  check('geometry', 'help-table-width', !!tbl && Math.abs(tbl.table - tbl.line) <= 8, tbl ? `表格 ${tbl.table} vs 行宽 ${tbl.line}（差需 ≤8）` : '帮助页没找到表格')
  await page.context().close()
}

/* ====================================================================== */
/*  4. 交互与无障碍                                                        */
/* ====================================================================== */

async function runInteractive(browser) {
  const page = await newPage(browser, { theme: 'github' })

  /* --- Ctrl+N 必须新增标签（菜单与帮助文档都这么写） --- */
  const count = () => page.evaluate(() => document.querySelectorAll('#tabbar .tab-item').length)
  const base = await count()
  await page.keyboard.press('Control+n')
  await page.waitForTimeout(450)
  const after1 = await count()
  await page.keyboard.press('Control+n')
  await page.waitForTimeout(450)
  const after2 = await count()
  check('interactive', 'ctrl-n-new-tab', after1 === base + 1 && after2 === base + 2, `标签数 ${base} → ${after1} → ${after2}（应每按一次 +1）`)

  /* --- 焦点环：必须有品牌色 outline，而不是浏览器默认黑框 --- */
  const ring = await page.evaluate(() => {
    // 造一个焦点态：给菜单根按钮 focus-visible
    const el = document.querySelector('#menubar-items .menu-root')
    if (!el) return null
    const cs = getComputedStyle(el)
    return { width: cs.outlineWidth, style: cs.outlineStyle, color: cs.outlineColor }
  })
  // focus-visible 只在键盘导航时命中，用 CSSOM 直接查规则更可靠
  const hasRule = await page.evaluate(() =>
    [...document.styleSheets].some((ss) => {
      try {
        return [...ss.cssRules].some((r) => r.cssText && /:focus-visible/.test(r.cssText) && /outline/.test(r.cssText))
      } catch {
        return false
      }
    }),
  )
  check('interactive', 'focus-ring-rule', hasRule, `存在 :focus-visible outline 规则 = ${hasRule}（浏览器默认 ${ring ? ring.width + ' ' + ring.color : '?'}）`)

  /* --- 空状态要有可点的入口 --- */
  await page.locator('.sidebar-tabs button[data-tab="files"]').click()
  await page.waitForTimeout(350)
  const empty = await page.evaluate(() => {
    const host = document.querySelector('#pane-files')
    if (!host) return null
    const btn = [...host.querySelectorAll('button')].map((e) => ({ t: (e.textContent || '').trim(), w: Math.round(e.getBoundingClientRect().width) }))
    const hint = host.querySelector('.empty-hint')
    return { buttons: btn, hint: (hint?.textContent || '').trim().slice(0, 40) }
  })
  check('interactive', 'empty-state-action', !!empty && empty.buttons.length > 0, empty ? `空状态按钮 ${empty.buttons.length} 个 ${JSON.stringify(empty.buttons)}` : '找不到 #pane-files')

  /* --- 搜索面板必须中文化 --- */
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+f')
  await page.waitForTimeout(600)
  const search = await page.evaluate(() => {
    const p = document.querySelector('.cm-panel.cm-search')
    if (!p) return null
    return { text: (p.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120), labels: [...p.querySelectorAll('button,label,input')].map((e) => e.getAttribute('aria-label') || e.textContent || e.getAttribute('placeholder') || '').filter(Boolean).slice(0, 14) }
  })
  const EN = /\b(find|replace|next|prev|previous|match case|regexp|by word|all)\b/i
  check('interactive', 'search-i18n', !!search && !EN.test(search.text), search ? `搜索面板文案：${search.text.slice(0, 80)}` : 'Ctrl+F 没打开搜索面板')
  await page.keyboard.press('Escape')

  /* --- 三键确认框：语义 + 焦点陷阱 + 焦点还原 --- */
  await openMenu(page, 'file')
  await page.locator('.menu-drop .menu-item[data-mi="file-create"]').click()
  await page.waitForTimeout(450)
  await page.locator('.cm-content').click()
  await page.keyboard.type('focus-test')
  await page.waitForTimeout(250)
  await page.keyboard.press('Control+w')
  await page.waitForTimeout(500)

  const semantics = await page.evaluate(() => {
    const m = document.querySelector('.modal-mask[data-role="save-confirm"]')
    if (!m) return null
    const box = m.querySelector('.modal')
    return {
      role: box?.getAttribute('role'),
      ariaModal: box?.getAttribute('aria-modal') || m.getAttribute('aria-modal'),
      labelled: !!(box?.getAttribute('aria-labelledby') || box?.getAttribute('aria-label')),
      activeIn: !!m.contains(document.activeElement),
      activeText: (document.activeElement?.textContent || '').trim().slice(0, 12),
    }
  })
  check('interactive', 'dialog-role', !!(semantics && semantics.role === 'dialog' && semantics.ariaModal === 'true'), semantics ? `role=${semantics.role} aria-modal=${semantics.ariaModal} labelled=${semantics.labelled}` : '没弹出确认框')
  check('interactive', 'dialog-initial-focus', !!(semantics && semantics.activeIn), semantics ? `初始焦点在框内=${semantics.activeIn}（「${semantics.activeText}」）` : '没弹出确认框')

  // Tab 四次，每次都必须还在框内
  const trail = []
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Tab')
    await page.waitForTimeout(90)
    trail.push(
      await page.evaluate(() => {
        const m = document.querySelector('.modal-mask[data-role="save-confirm"]')
        return { in: !!m && m.contains(document.activeElement), t: (document.activeElement?.textContent || '').trim().slice(0, 10) }
      }),
    )
  }
  check('interactive', 'dialog-focus-trap', trail.every((x) => x.in), `Tab×5 焦点轨迹：${trail.map((x) => (x.in ? x.t || '·' : '【跑出框】')).join(' → ')}`)

  // Esc 关闭后焦点应回到打开前的位置（编辑器）
  await page.keyboard.press('Escape')
  await page.waitForTimeout(350)
  const restored = await page.evaluate(() => ({
    role: document.activeElement?.getAttribute('role') || document.activeElement?.className || document.activeElement?.tagName,
    inEditor: !!document.activeElement?.closest('.cm-editor'),
  }))
  check('interactive', 'dialog-focus-restore', restored.inEditor, `关闭后焦点落在 ${restored.role}（应回编辑器）`)

  /* --- 菜单层级：面板打开时菜单必须已关（z-index 倒挂） --- */
  await openMenu(page, 'settings')
  await page.keyboard.press('Control+Shift+P')
  await page.waitForTimeout(1300)
  const zorder = await page.evaluate(() => {
    const drop = document.querySelector('.menu-drop')
    const mask = document.querySelector('.ce-mask')
    return {
      menuOpen: !!drop,
      mask: !!mask,
      dropZ: drop ? getComputedStyle(drop).zIndex : null,
      maskZ: mask ? getComputedStyle(mask).zIndex : null,
    }
  })
  check('interactive', 'panel-closes-menu', !zorder.menuOpen, `开排版面板时菜单仍开着=${zorder.menuOpen}（drop z=${zorder.dropZ} / mask z=${zorder.maskZ}）`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  const errs = page.__errs.filter((e) => !/favicon|ERR_FILE|net::/i.test(e))
  check('interactive', 'no-console-errors', errs.length === 0, errs.length ? errs.slice(0, 3).join(' | ') : '控制台干净')
  await page.context().close()
}

/* ====================================================================== */
/*  5. 排版面板                                                            */
/* ====================================================================== */

async function runLayout(browser) {
  const page = await newPage(browser, { theme: 'github' })
  await page.keyboard.press('Control+Shift+P')
  await page.waitForTimeout(1300)

  /* --- 数值必须能输入，不只是拖（LAYOUT-1） --- */
  const numeric = await page.evaluate(() => {
    const nums = [...document.querySelectorAll('.ce-num')]
    return nums.map((n) => ({
      hasInput: !!n.querySelector('input[type="number"], input[inputmode="numeric"]'),
      hasRange: !!n.querySelector('input[type="range"]'),
      text: (n.textContent || '').trim().slice(0, 12),
    }))
  })
  check(
    'layout',
    'numeric-editable',
    numeric.length > 0 && numeric.every((n) => n.hasInput),
    `${numeric.length} 个数值控件，可输入 ${numeric.filter((n) => n.hasInput).length} 个（应全部可输入）`,
  )

  /* --- 数值列对齐（LAYOUT-4）：右边缘应收在同一条竖线上 --- */
  const aligned = await page.evaluate(() => {
    const rights = [...document.querySelectorAll('.ce-num-val, .ce-hex')].map((e) => Math.round(e.getBoundingClientRect().right))
    if (rights.length < 2) return null
    const uniq = [...new Set(rights)]
    return { n: rights.length, distinct: uniq.length, spread: Math.max(...rights) - Math.min(...rights) }
  })
  check('layout', 'value-column-align', !!aligned && aligned.spread <= 2, aligned ? `${aligned.n} 个数值，右边缘 ${aligned.distinct} 种位置，跨度 ${aligned.spread}px（需 ≤2）` : '找不到数值列')
  await page.screenshot({ path: path.join(OUT, 'layout-desktop.png') })
  await page.context().close()
}

/* ====================================================================== */
/*  6. 手机外壳                                                            */
/* ====================================================================== */

async function runMobile(browser) {
  const page = await newPage(browser, { width: 390, height: 844, theme: 'github', scale: 2 })

  const chrome = await page.evaluate(() => {
    const mb = document.querySelector('.menubar')
    const title = document.querySelector('#doc-title')
    const tool = document.querySelector('#mobile-toolbar')
    const dock = document.querySelector('#mobile-dock')
    const line = document.querySelector('.cm-line')
    const host = document.querySelector('.editor-host')
    const r = (e) => (e ? e.getBoundingClientRect() : null)
    return {
      menubar: mb ? { h: Math.round(r(mb).height), padL: getComputedStyle(mb).paddingLeft } : null,
      title: title ? { x: Math.round(r(title).left), fs: getComputedStyle(title).fontSize, text: (title.textContent || '').trim().slice(0, 30) } : null,
      toolbar: tool ? { h: Math.round(r(tool).height), overflowX: tool.scrollWidth > tool.clientWidth + 1, n: tool.querySelectorAll('button').length, inDock: !!(dock && dock.contains(tool)) } : null,
      dock: dock ? { h: Math.round(r(dock).height) } : null,
      body: line && host ? { left: Math.round(r(line).left - r(host).left), right: Math.round(r(host).right - r(line).right) } : null,
      words: !!document.querySelector('.menubar .mb-words, .menubar .sb-words'),
    }
  })
  check('mobile', 'topbar-height', !!chrome.menubar && chrome.menubar.h >= 44, chrome.menubar ? `手机顶栏高 ${chrome.menubar.h}px（需 ≥44）` : '找不到 .menubar')
  check('mobile', 'topbar-padding', !!chrome.menubar && parseFloat(chrome.menubar.padL) >= 12, chrome.menubar ? `顶栏左内边距 ${chrome.menubar.padL}（需 ≥12）` : '找不到 .menubar')
  check('mobile', 'topbar-words', !!chrome.words, `顶栏有字数显示=${chrome.words}（手机隐藏了状态栏，字数要在这里找得到）`)
  // 格式条被 mobile.ts 搬进了 dock，算总高时不能再加一遍（加了会把 103 报成 153）
  const bottomH = chrome.toolbar?.inDock ? chrome.dock?.h ?? 0 : (chrome.toolbar?.h ?? 0) + (chrome.dock?.h ?? 0)
  const bottomDesc = chrome.toolbar?.inDock
    ? `底栏 ${bottomH}px（含格式条 ${chrome.toolbar.h}px，需 ≤130）`
    : `格式条 ${chrome.toolbar?.h ?? '?'} + dock ${chrome.dock?.h ?? '?'} = ${bottomH}px（需 ≤130）`
  check('mobile', 'bottom-chrome-height', bottomH <= 130, bottomDesc)
  check('mobile', 'toolbar-no-clip', !!chrome.toolbar && !chrome.toolbar.overflowX, chrome.toolbar ? `格式条 ${chrome.toolbar.n} 个按钮，横向溢出=${chrome.toolbar.overflowX}` : '找不到格式条')
  check('mobile', 'body-gutter', !!chrome.body && chrome.body.left >= 16 && chrome.body.right >= 16, chrome.body ? `正文左右 ${chrome.body.left}/${chrome.body.right}（需各 ≥16）` : '取不到正文盒')
  await page.screenshot({ path: path.join(OUT, 'mobile-editor.png') })

  /* --- 菜单面板：要有分区跳转，不能是一条 5000px 长列表 --- */
  await page.locator('#mobile-dock .ma-btn[data-act="menu"]').click().catch(async () => {
    // 兜底：dock 上带 aria-label 的「菜单」
    await page.locator('#mobile-dock button').last().click()
  })
  await page.waitForTimeout(600)
  const sheet = await page.evaluate(() => {
    const s = document.getElementById('menu-sheet')
    const body = document.getElementById('sheet-body')
    if (!s || !body) return null
    const chips = s.querySelectorAll('.sheet-chips button, .sheet-chip')
    return {
      open: !s.hidden,
      rows: s.querySelectorAll('.sheet-row').length,
      contentH: body.scrollHeight,
      clientH: body.clientHeight,
      chips: chips.length,
      sections: s.querySelectorAll('.sheet-section').length,
    }
  })
  check('mobile', 'sheet-open', !!sheet && sheet.open, sheet ? `面板打开=${sheet.open}，${sheet.sections} 分区 ${sheet.rows} 行，内容 ${sheet.contentH}px / 可视 ${sheet.clientH}px` : '打不开菜单面板')
  check('mobile', 'sheet-section-jump', !!sheet && sheet.chips >= 3, sheet ? `分区跳转 chip ${sheet.chips} 个（需 ≥3）` : '找不到分区 chip')
  await page.screenshot({ path: path.join(OUT, 'mobile-sheet.png') })

  /* --- 排版面板：参数区不能被预览挤到没法用 --- */
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  // 手机端排版入口在 dock（DOCK 里 id=layout → data-act="layout"）
  await page.locator('#mobile-dock .ma-btn[data-act="layout"]').click({ timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(1300)
  const measureLayout = () =>
    page.evaluate(() => {
      const prev = document.querySelector('.ce-preview')
      const set = document.querySelector('.ce-settings')
      const mask = document.querySelector('.ce-mask')
      if (!mask) return null
      const mh = mask.getBoundingClientRect().height
      return {
        maskH: Math.round(mh),
        previewH: prev ? Math.round(prev.getBoundingClientRect().height) : 0,
        settingsH: set ? Math.round(set.getBoundingClientRect().height) : 0,
        settingsShare: set ? Math.round((set.getBoundingClientRect().height / mh) * 100) : 0,
        // 只认真正的折叠开关：早先写成 prev.querySelector('button')，
        // 页码翻页箭头也是 button，于是这条永远真 —— 断言等于没写
        hasToggle: !!(prev && prev.querySelector('.ce-prev-toggle')),
        collapsed: document.querySelector('.ce')?.classList.contains('ce-prev-collapsed') ?? false,
      }
    })
  const mob = await measureLayout()
  check('mobile', 'layout-prev-toggle', !!mob && mob.hasToggle, mob ? `预览区有折叠开关=${mob.hasToggle}（参数区要能拿回高度）` : '手机端打不开排版面板')
  if (mob?.hasToggle && !mob.collapsed) {
    await page.locator('.ce-prev-toggle').click()
    await page.waitForTimeout(450)
  }
  const mob2 = (await measureLayout()) ?? mob
  check('mobile', 'layout-params-room', !!mob2 && mob2.settingsShare >= 55, mob2 ? `收起预览后参数区占 ${mob2.settingsShare}%（需 ≥55%）；预览 ${mob2.previewH} / 参数 ${mob2.settingsH} / 面板 ${mob2.maskH}` : '手机端打不开排版面板')
  await page.screenshot({ path: path.join(OUT, 'mobile-layout.png') })
  await page.context().close()
}

/* ====================================================================== */
/*  7. 不回归（审计里"已做得好、改的时候别动"的部分）                      */
/* ====================================================================== */

async function runRegression(browser) {
  const page = await newPage(browser, { theme: 'github' })
  const reg = await page.evaluate(() => {
    // 取 .cm-content 而不是第一条 .cm-line —— 首行是 H1（2em = 32px / 行高 43.2），量出来会误判
    const content = document.querySelector('.cm-content')
    const cs = content ? getComputedStyle(content) : null
    // v0.11.2 起标签条并进菜单行，量标签条自身的高度没意义了（它撑满 40px 的顶栏），
    // 真正要看的是"单个标签的可点高度"是否还是个舒服的目标。
    const item = document.querySelector('#tabbar .tab-item')
    const dot = document.querySelector('.tb-dirty')
    return {
      bodyFs: cs ? parseFloat(cs.fontSize) : 0,
      lineLh: cs ? parseFloat(cs.lineHeight) : 0,
      tabItemH: item ? Math.round(item.getBoundingClientRect().height) : 0,
      dotW: dot ? Math.round(dot.getBoundingClientRect().width) : 0,
    }
  })
  check('regression', 'body-font', reg.bodyFs >= 16 && reg.bodyFs <= 17, `正文字号 ${reg.bodyFs}px`)
  check('regression', 'body-leading', reg.lineLh >= 26 && reg.lineLh <= 32, `正文行高 ${reg.lineLh}px`)
  check('regression', 'tab-item-height', reg.tabItemH >= 30 && reg.tabItemH <= 46, `单个标签高 ${reg.tabItemH}px（合并到菜单行后按标签自身量，需 ≥30）`)
  check('regression', 'dirty-slot', reg.dotW >= 6 && reg.dotW <= 12, `脏标记占位 ${reg.dotW}px（固定占位，防止标签抖动）`)

  // 只读帮助：不能漏出 # 与管道符
  await openMenu(page, 'help')
  await page.locator('.menu-drop .menu-item[data-mi="help-shortcuts"]').click()
  // 帮助是异步建 EditorState（?raw + 编译），给足时间再量
  await page.waitForTimeout(1500)
  await page.waitForFunction(() => document.querySelector('.cm-content')?.getAttribute('contenteditable') === 'false', { timeout: 5000 }).catch(() => {})
  const help = await page.evaluate(() => {
    const el = document.querySelector('.cm-content')
    return {
      editable: el?.getAttribute('contenteditable'),
      leak: /^#\s|^\|/.test((el?.textContent || '').trim()),
      tables: el ? el.querySelectorAll('table').length : 0,
    }
  })
  check('regression', 'help-readonly', help.editable === 'false' && !help.leak, `只读=${help.editable}，源码泄漏=${help.leak}，表格 ${help.tables} 个`)
  await page.context().close()
}

/* ====================================================================== */

let server = { child: null }
let browser = null
try {
  fs.mkdirSync(OUT, { recursive: true })
  server = await ensureServer()
  browser = await chromium.launch({ executablePath: EDGE, headless: true })

  const plan = [
    ['contrast', runContrast],
    ['type', runType],
    ['geometry', runGeometry],
    ['interactive', runInteractive],
    ['layout', runLayout],
    ['mobile', runMobile],
    ['regression', runRegression],
  ]
  for (const [name, fn] of plan) {
    if (!enabled(name)) continue
    if (!QUIET) console.log(`\n—— ${name} ——`)
    await fn(browser)
  }

  report.pass = report.failed === 0
} catch (e) {
  report.errors.push('EXCEPTION ' + (e && e.message ? e.message : String(e)))
  report.pass = false
} finally {
  // 打印分组小结：CI 日志里一眼看出是哪一类崩了
  console.log('\n========== 汇总 ==========')
  for (const g of GROUPS) {
    if (!enabled(g)) continue
    const s = report.groups[g]
    const mark = s.fail === 0 ? 'PASS' : 'FAIL'
    console.log(`${mark} ${g.padEnd(12)} ${s.pass} 过 / ${s.fail} 失败`)
  }
  console.log(`\n断言 ${report.checks} 条，失败 ${report.failed} 条`)
  if (report.errors.length) {
    console.log('\n失败明细：')
    for (const e of report.errors) console.log('  · ' + e)
  }
  console.log(report.pass ? '\n结论：通过' : '\n结论：未通过')
  try {
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
    console.log(`报告：${path.relative(process.cwd(), path.join(OUT, 'report.json'))}`)
  } catch {
    /* 产物目录不可写就算了，不影响退出码 */
  }
  if (browser) await browser.close()
  if (server.child) {
    try {
      server.child.kill('SIGTERM')
    } catch {
      /* ignore */
    }
  }
  process.exit(report.pass ? 0 : 1)
}
