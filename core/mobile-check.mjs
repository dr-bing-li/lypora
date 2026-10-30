/**
 * 移动外壳验收 —— Edge（Chromium）以真机尺寸 + 触摸模拟跑，逐项断言布局与交互。
 *
 * 为什么用 Playwright 的 device emulation 而不是等真机：
 *   本机没有连着设备（adb devices 为空），但 WebView 的排版引擎就是 Chromium，
 *   视口尺寸 / DPR / 触摸事件 / `pointer: coarse` 都能如实模拟。
 *   能验的是「布局不溢出、点击区够大、抽屉与面板开合、桌面布局没被改坏」；
 *   验不到的是原生插件（文件读写、分享面板）—— 那部分靠 APK 冷启动 + 手动路径覆盖。
 *
 * 用法：node mobile-check.mjs [url]
 */

import { chromium } from 'playwright-core'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const PAGE_URL = process.argv[2] || 'http://127.0.0.1:4173/index.html'
const OUT = fileURLToPath(new URL('../artifacts/mobile/', import.meta.url))
fs.mkdirSync(OUT, { recursive: true })

/** 覆盖主流尺寸：小屏手机 / 主流手机 / 大屏手机 / 竖屏平板 / 桌面 */
const DEVICES = [
  { id: 'phone-360', width: 360, height: 640, dpr: 3, mobile: true, touch: true, label: '360×640 小屏手机' },
  { id: 'phone-393', width: 393, height: 851, dpr: 2.75, mobile: true, touch: true, label: '393×851 Pixel 5' },
  { id: 'phone-430', width: 430, height: 932, dpr: 3, mobile: true, touch: true, label: '430×932 大屏手机' },
  { id: 'tablet-800', width: 800, height: 1280, dpr: 2, mobile: true, touch: true, label: '800×1280 竖屏平板' },
  { id: 'desktop-1440', width: 1440, height: 900, dpr: 1, mobile: false, touch: false, label: '1440×900 桌面' },
]

const report = { url: PAGE_URL, devices: [], pass: false, errors: [] }

const browser = await chromium.launch({ executablePath: EDGE, headless: true })

for (const dev of DEVICES) {
 const errors = []
 try {
  const ctx = await browser.newContext({
    viewport: { width: dev.width, height: dev.height },
    deviceScaleFactor: dev.dpr,
    isMobile: dev.mobile,
    hasTouch: dev.touch,
  })
  const page = await ctx.newPage()
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('[console] ' + m.text())
  })
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message))

  await page.goto(PAGE_URL, { waitUntil: 'networkidle' })
  await page.waitForTimeout(700)

  const isPhone = dev.width <= 767
  const isNarrow = dev.width <= 860

  const box = async (sel) =>
    page.evaluate((s) => {
      const el = document.querySelector(s)
      if (!el) return null
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
        display: cs.display,
        visible: cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0,
      }
    }, sel)

  const r = {
    id: dev.id,
    label: dev.label,
    checks: {},
    tapTargets: [],
    errors,
  }

  // 1) 无横向溢出（移动端最常见的塌方）
  const overflow = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    bodyScrollW: document.body.scrollWidth,
  }))
  r.overflow = overflow
  r.checks.noHorizontalOverflow = overflow.scrollW <= overflow.clientW + 1 && overflow.bodyScrollW <= overflow.clientW + 1

  // 2) 外壳高度等于视觉视口
  const vp = await page.evaluate(() => {
    const app = document.getElementById('app')
    return {
      appH: Math.round(app.getBoundingClientRect().height),
      vvH: Math.round(window.visualViewport ? window.visualViewport.height : window.innerHeight),
      innerH: window.innerHeight,
    }
  })
  r.viewport = vp
  r.checks.appFillsViewport = Math.abs(vp.appH - vp.vvH) <= 2

  // 3) 底部动作栏
  const dock = await box('#mobile-dock')
  r.dock = dock
  if (isNarrow) {
    r.checks.dockVisible = !!dock && dock.visible
    // 贴着屏幕底部（含安全区，模拟环境里安全区为 0）
    r.checks.dockPinnedBottom = !!dock && Math.abs(dock.y + dock.h - vp.vvH) <= 2
    const acts = await page.$$eval('#mobile-dock .ma-btn', (els) =>
      els.map((el) => {
        const b = el.getBoundingClientRect()
        return { act: el.dataset.act, w: Math.round(b.width), h: Math.round(b.height), label: el.textContent.trim() }
      }),
    )
    r.tapTargets = acts
    r.checks.dockHas6Actions = acts.length === 6
    // Material 建议 48dp；这里断言 ≥44（iOS HIG 下限）
    r.checks.dockTapTargetsOk = acts.every((a) => a.w >= 44 && a.h >= 44)
    // 6 个按钮不能换行（一换行就是布局塌了）
    r.checks.dockSingleRow =
      acts.length > 0 &&
      (await page.evaluate(() => {
        const ys = [...document.querySelectorAll('#mobile-dock .ma-btn')].map((el) =>
          Math.round(el.getBoundingClientRect().y),
        )
        return new Set(ys).size === 1
      }))
  } else {
    r.checks.dockHidden = !dock || !dock.visible
  }

  // 4) 格式化条：窄屏在 dock 里、桌面不出现
  const fmt = await box('#mobile-toolbar')
  r.formatBar = fmt
  if (isNarrow) {
    r.checks.formatBarInDock = await page.evaluate(
      () => document.getElementById('mobile-dock')?.contains(document.getElementById('mobile-toolbar')) === true,
    )
    r.checks.formatBarTargets = await page.evaluate(() => {
      const bs = [...document.querySelectorAll('#mobile-toolbar button')]
      return bs.length > 0 && bs.every((b) => b.getBoundingClientRect().height >= 38)
    })
  } else {
    r.checks.formatBarHidden = !fmt || !fmt.visible
  }

  // 5) 菜单：手机上横向菜单条收起，桌面保留
  const menuRoots = await box('#menubar-items')
  r.checks.menubarHiddenOnPhone = isPhone ? !menuRoots || !menuRoots.visible : !!menuRoots && menuRoots.visible

  // 6) 菜单面板（sheet）
  if (isNarrow) {
    await page.locator('#mobile-dock .ma-btn[data-act="menu"]').tap()
    await page.waitForTimeout(260)
    const sheet = await box('#menu-sheet')
    r.sheet = sheet
    r.checks.sheetOpens = !!sheet && sheet.visible
    const backdropBox = await box('.sheet-backdrop')
    r.sheetBackdrop = backdropBox
    r.checks.sheetBackdrop = !!backdropBox && backdropBox.visible
    const bd = await box('.sheet-backdrop')
    r.sheetBackdrop = bd
    r.checks.sheetBackdrop = !!bd && bd.visible
    const secs = await page.$$eval('#menu-sheet .sheet-section', (els) =>
      els.map((e) => e.dataset.section),
    )
    r.sheetSections = secs
    r.checks.sheetHas7Menus = secs.length === 7
    const rows = await page.$$eval('#menu-sheet .sheet-row', (els) =>
      els.map((e) => ({ h: Math.round(e.getBoundingClientRect().height), text: e.textContent.trim() })),
    )
    r.sheetRowCount = rows.length
    r.checks.sheetRows = rows.length >= 20
    r.checks.sheetRowHitArea = rows.every((x) => x.h >= 44)
    // 面板高度不得超过 78vh，否则小屏上收不起来
    r.checks.sheetMaxHeight = !!sheet && sheet.h <= Math.round(vp.vvH * 0.79)

    // 导出分区跳转：点「导出」，面板应滚到「文件」这一节
    await page.locator('#menu-sheet .sheet-close').tap()
    await page.waitForTimeout(200)
    r.checks.sheetCloses = !(await box('#menu-sheet'))?.visible
    r.checks.backdropHiddenAfterClose = !(await box('.sheet-backdrop'))?.visible
    r.checks.backdropHiddenAfterClose = !(await box('.sheet-backdrop'))?.visible
    await page.locator('#mobile-dock .ma-btn[data-act="export"]').tap()
    await page.waitForTimeout(260)
    r.checks.exportJumpsToFileSection = await page.evaluate(() => {
      const body = document.getElementById('sheet-body')
      const sec = document.querySelector('.sheet-section[data-section="文件"]')
      if (!body || !sec) return false
      return Math.abs(body.scrollTop - Math.max(0, sec.offsetTop - 8)) < 4 || body.scrollTop === 0
    })
    await page.locator('#menu-sheet .sheet-close').tap()
    await page.waitForTimeout(200)
  }

  // 7) 抽屉：点「大纲」展开侧栏 + 遮罩，点遮罩收起
  if (isNarrow) {
    await page.locator('#mobile-dock .ma-btn[data-act="outline"]').tap()
    await page.waitForTimeout(300)
    const sidebar = await box('#sidebar')
    const scrim = await box('.drawer-scrim')
    r.drawer = { sidebar, scrim }
    r.checks.drawerOpens = !!sidebar && sidebar.visible && !(await page.evaluate(() => document.getElementById('sidebar').classList.contains('collapsed')))
    r.checks.drawerScrim = !!scrim && scrim.visible
    r.checks.drawerWidthSane = !!sidebar && sidebar.w <= Math.round(dev.width * 0.86)
    // 侧栏浮在遮罩之上（z 40 > 35），所以要点"抽屉右侧的空白"才算点遮罩
    await page.touchscreen.tap(dev.width - 12, Math.round(dev.height * 0.42))
    await page.waitForTimeout(300)
    r.checks.drawerClosesOnScrim = await page.evaluate(() =>
      document.getElementById('sidebar').classList.contains('collapsed'),
    )
  }

  // 8) 正文可编辑（触摸点一下编辑器再输入）
  if (dev.touch) {
    const editorBox = await box('#editor-host')
    r.editor = editorBox
    if (editorBox) {
      await page.touchscreen.tap(editorBox.x + 40, editorBox.y + 30)
      await page.waitForTimeout(150)
      const focused = await page.evaluate(() => document.activeElement?.classList.contains('cm-content') === true)
      r.checks.editorFocusable = focused
    }
  }

  // 9) 桌面回归：菜单栏存在、工具栏不存在
  if (!isNarrow) {
    r.checks.desktopMenubar = await page.evaluate(
      () => document.querySelectorAll('#menubar-items .menu-root').length === 7,
    )
    r.checks.desktopSidebarDefault = await page.evaluate(
      () => !document.getElementById('sidebar').classList.contains('collapsed'),
    )
  }

  await page.screenshot({ path: `${OUT}${dev.id}.png`, fullPage: false })

  // 交互态截图：只有窄屏才有面板/抽屉
  if (isNarrow) {
    await page.locator('#mobile-dock .ma-btn[data-act="menu"]').tap()
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${OUT}${dev.id}-sheet.png` })
    await page.locator('#menu-sheet .sheet-close').tap()
    await page.waitForTimeout(200)
    await page.locator('#mobile-dock .ma-btn[data-act="outline"]').tap()
    await page.waitForTimeout(320)
    await page.screenshot({ path: `${OUT}${dev.id}-drawer.png` })
  }

  r.ok = Object.values(r.checks).every(Boolean) && errors.length === 0
  report.devices.push(r)
  await ctx.close()
 } catch (err) {
  report.devices.push({ id: dev.id, label: dev.label, checks: { noCrash: false }, crash: String(err && err.message || err), errors })
 }
}

await browser.close()

report.errors = report.devices.flatMap((d) => d.errors)
report.pass = report.devices.every((d) => d.ok)

console.log(JSON.stringify(report, null, 2))
fs.writeFileSync(`${OUT}mobile-report.json`, JSON.stringify(report, null, 2))
process.exit(report.pass ? 0 : 1)
