/**
 * v0.11.0 验收：标签 / 未保存标识 / 三键确认 / 只读帮助 / 排版整屏几何。
 *
 * 为什么单开一个脚本：verify.mjs 是"编辑器本身"的回归（渲染、主题、导出），
 * 这些是新加的组织层能力，混进去会让原来的 15 步变成 25 步、任一失败都不知道是谁坏了。
 *
 * 用法：node tabs-check.mjs [url]
 */

import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const PAGE_URL = process.argv[2] || 'http://127.0.0.1:4173/index.html'
// 不删目录：宿主安全删除钩子对目录是 fail-closed（会卡到 ETIMEDOUT），用时间戳子目录
const RUN = new Date().toISOString().replace(/[:.]/g, '-')
const OUT = path.join(HERE, '..', 'artifacts', 'tabs', RUN)
fs.mkdirSync(OUT, { recursive: true })

const report = { steps: {}, errors: [], pass: false }
const errors = report.errors

const browser = await chromium.launch({ executablePath: EDGE, headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 940 }, deviceScaleFactor: 2, locale: 'zh-CN' })
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('[console] ' + m.text())
})
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message))

const fail = async (msg) => {
  errors.push(msg)
  console.log('FAIL ' + msg)
}

const tabs = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('#tabbar .tab-item')].map((e) => ({
      title: e.querySelector('.tb-title')?.textContent ?? '',
      dirty: e.querySelector('.tb-dirty')?.textContent ?? '',
      help: !!e.querySelector('.tb-icon'),
      active: e.classList.contains('active'),
    })),
  )

async function openMenu(id) {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(80)
  await page.locator(`#menubar-items .menu-root[data-menu="${id}"]`).click()
  await page.waitForTimeout(200)
}

async function shot(name) {
  await page.screenshot({ path: path.join(OUT, name + '.png') })
}

try {
  await page.goto(PAGE_URL, { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)

  /* ---------- 1. 标签栏可见，初始一个标签 ---------- */
  const bar = await page.evaluate(() => {
    const el = document.getElementById('tabbar')
    const r = el.getBoundingClientRect()
    return { hidden: el.hidden, h: Math.round(r.height), top: Math.round(r.top) }
  })
  report.steps.bar = { ...bar, tabs: await tabs() }
  if (bar.hidden || bar.h < 20) await fail('标签栏没显示')

  /* ---------- 2. 输入 → 三处 `*`（标题、菜单栏、标签） ---------- */
  await page.locator('.cm-content').click()
  await page.keyboard.type('TABCHECK')
  await page.waitForTimeout(400)
  const dirty = await page.evaluate(() => ({
    title: document.title,
    dot: { hidden: document.getElementById('dirty-dot').hidden, text: document.getElementById('dirty-dot').textContent },
  }))
  report.steps.dirty = { ...dirty, tabs: await tabs() }
  if (!dirty.title.startsWith('* ')) await fail('窗口标题没有 * 前缀')
  if (dirty.dot.hidden || dirty.dot.text !== '*') await fail('菜单栏 * 标记没出现')
  if ((await tabs())[0].dirty !== '*') await fail('标签没有 * 标记')

  /* ---------- 3. Ctrl+N 新标签，切回去原文与撤销历史都在 ---------- */
  await page.keyboard.press('Control+n')
  await page.waitForTimeout(300)
  await page.locator('.cm-content').click()
  await page.keyboard.type('SECOND')
  await page.waitForTimeout(200)
  const afterNew = await tabs()
  report.steps.newTab = afterNew
  if (afterNew.length !== 2) await fail('Ctrl+N 没开新标签')

  await page.locator('#tabbar .tab-item').first().click()
  await page.waitForTimeout(400)
  const back = await page.evaluate(() => document.querySelector('.cm-content').textContent)
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(250)
  const afterUndo = await page.evaluate(() => document.querySelector('.cm-content').textContent)
  report.steps.switchBack = {
    hasFirstEdit: back.includes('TABCHECK'),
    undoRemovedEdit: !afterUndo.includes('TABCHECK'),
  }
  if (!back.includes('TABCHECK')) await fail('切回后内容丢了')
  if (afterUndo.includes('TABCHECK')) await fail('切回后撤销历史丢了（独立 state 没生效）')

  // 撤销回"上次落盘的内容"后，`*` 应该自己消失（dirty 以磁盘内容为准，不是"动过就算脏"）
  const undoClean = await page.evaluate(() => ({
    title: document.title,
    dirty: document.querySelector('.tb-dirty')?.textContent ?? '',
  }))
  report.steps.undoClearsDirty = undoClean
  if (undoClean.dirty === '*' || undoClean.title.startsWith('* ')) await fail('撤销回原文后仍然标着未保存')

  // 再改一次，让这篇重新变成未保存，后面的三键框才有得问
  await page.keyboard.type('DIRTYAGAIN')
  await page.waitForTimeout(300)

  /* ---------- 4. 关未保存标签：取消保留 / 不保存关闭 ---------- */
  await page.locator('#tabbar .tab-item.active .tb-close').click()
  await page.waitForTimeout(300)
  const dlg = await page.locator('.modal-mask[data-role="save-confirm"]').count()
  const dlgText = dlg
    ? await page.locator('.modal-mask[data-role="save-confirm"] .modal h3').textContent()
    : ''
  await shot('confirm')
  await page.locator('.modal-mask[data-role="save-confirm"] [data-act="cancel"]').click()
  await page.waitForTimeout(250)
  const afterCancel = await tabs()
  report.steps.confirmCancel = { dialog: dlg, text: dlgText, tabs: afterCancel.length }
  if (!dlg) await fail('关未保存标签没有弹三键框')
  if (afterCancel.length !== 2) await fail('点了取消标签还是被关了')

  await page.locator('#tabbar .tab-item.active .tb-close').click()
  await page.waitForTimeout(300)
  await page.locator('.modal-mask[data-role="save-confirm"] [data-act="discard"]').click()
  await page.waitForTimeout(350)
  const afterDiscard = await tabs()
  report.steps.confirmDiscard = { tabs: afterDiscard.length }
  if (afterDiscard.length !== 1) await fail('点"不保存"后标签没关掉')

  /* ---------- 5. 帮助：8 篇、只读标签 ---------- */
  await openMenu('help')
  const helpItems = await page.evaluate(() =>
    [...document.querySelectorAll('.menu-drop .menu-item')].map((e) => ({
      id: e.dataset.mi,
      label: e.querySelector('.mi-label')?.textContent ?? '',
    })),
  )
  report.steps.helpMenu = helpItems
  if (helpItems.length !== 8) await fail(`帮助菜单是 ${helpItems.length} 项，应为 8`)
  await page.locator('.menu-drop .menu-item[data-mi="help-shortcuts"]').click()
  await page.waitForTimeout(700)
  const helpTab = await tabs()
  const helpBody = await page.evaluate(() => {
    const el = document.querySelector('.cm-content')
    return {
      before: (el?.textContent ?? '').slice(0, 60),
      // 只读的真实判据是 contenteditable=false（EditorView.editable.of(false) 的落地形态）；
      // 不能用 textContent 长度当判据 —— CM6 是虚拟滚动的，渲染出来的行数会变
      editable: el?.getAttribute('contenteditable'),
      readonly: document.body.classList.contains('tab-readonly'),
    }
  })
  // 只读校验：往正文里打字，不应变成未保存，也不应改内容
  await page.locator('.cm-content').click()
  await page.keyboard.type('XXX')
  await page.waitForTimeout(250)
  const helpAfter = await page.evaluate(() => ({
    title: document.title,
    dirtyMark: document.querySelector('.tab-item.active .tb-dirty')?.textContent ?? '',
  }))
  report.steps.helpTab = { tabs: helpTab, body: helpBody, after: helpAfter }
  await shot('help')
  if (!helpTab.some((t) => t.help)) await fail('帮助没开成带图标的标签')
  if (helpBody.editable !== 'false') await fail('帮助标签的正文不是 contenteditable=false')
  if (helpAfter.title.startsWith('*') || helpAfter.dirtyMark === '*') await fail('帮助标签被算成未保存')

  /* ---------- 6. 设置 → 显示模式三态 ---------- */
  // v0.12.0：设置从顶级降进「文件」，所以要先展开 文件 → 设置 两层再 hover 第三层
  await openMenu('file')
  await page.locator('.menu-drop .menu-item[data-mi="file-settings"]').hover()
  await page.waitForTimeout(220)
  await page.locator('.menu-drop.sub .menu-item[data-mi="settings-display"]').hover()
  await page.waitForTimeout(300)
  // 只量最深的那一层：.menu-drop.sub 现在有两层（设置、显示模式），
  // 直接 querySelectorAll 会把上一层也算进来
  const display = await page.evaluate(() => {
    const pops = [...document.querySelectorAll('.menu-drop.sub')]
    const last = pops[pops.length - 1]
    return [...(last?.querySelectorAll('.menu-item') ?? [])].map((e) => ({
      id: e.dataset.mi,
      label: e.querySelector('.mi-label')?.textContent ?? '',
      checked: e.classList.contains('checked'),
      disabled: e.disabled,
    }))
  })
  report.steps.display = display
  if (display.length !== 3) await fail('显示模式不是三项')
  if (!display.find((d) => d.id === 'settings-display-tabs' && d.checked)) await fail('默认没勾"仅标签页"')
  // 浏览器里开不了真窗口：后两项应置灰
  if (display.some((d) => (d.id === 'settings-display-windows' || d.id === 'settings-display-both') && !d.disabled))
    await fail('没有桌面桥时"仅多窗口"没置灰')
  await page.keyboard.press('Escape')

  /* ---------- 7. 排版整屏几何 ---------- */
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
  await openMenu('layout')
  await page.locator('.menu-drop .menu-item[data-mi="layout-open"]').click()
  await page.waitForTimeout(1200)
  const geo = await page.evaluate(() => {
    const tb = document.getElementById('tabbar')
    const ce = document.querySelector('.ce')?.getBoundingClientRect()
    const mask = document.querySelector('.ce-mask')?.getBoundingClientRect()
    return {
      winW: window.innerWidth,
      winH: window.innerHeight,
      // 面板应从顶栏的下沿开始。v0.11.2 起标签栏并进了菜单栏同一行，
      // 再写「菜单栏底 + 标签栏高」就多算一层，所以直接量内容区上沿。
      chromeBottom: Math.round(document.querySelector('.workspace').getBoundingClientRect().top),
      tabbarNested: !!tb && !!tb.closest('.menubar'),
      mask: mask && { top: Math.round(mask.top), left: Math.round(mask.left), w: Math.round(mask.width), h: Math.round(mask.height) },
      ce: ce && { w: Math.round(ce.width), h: Math.round(ce.height), radius: getComputedStyle(document.querySelector('.ce')).borderRadius },
    }
  })
  report.steps.layoutGeometry = geo
  await shot('layout-full')
  if (geo.mask && geo.mask.top !== geo.chromeBottom) await fail('排版面板没从菜单栏/标签栏下沿开始')
  if (geo.ce && geo.ce.w !== geo.winW) await fail('排版面板没有占满宽度')
  if (geo.ce && geo.ce.radius !== '0px') await fail('排版面板还是圆角弹窗')

  report.pass = errors.length === 0
} catch (e) {
  errors.push('EXCEPTION ' + (e && e.message ? e.message : String(e)))
} finally {
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  await browser.close()
  process.exit(report.pass ? 0 : 1)
}
