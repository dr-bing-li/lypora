/**
 * 国际化（i18n）验收 —— 两道关：
 *
 *  A. 静态键比对（Node 端，读的是**真正编译过的词表**）：
 *     用 tsc 把 src/i18n 原样转成 ESM 再 import，逐语言与 zh-CN 比
 *       · 缺失键 / 多余键
 *       · 空值
 *       · 占位符集合不一致（`{name}` 漏了一个就会在界面上剩半句话）
 *       · 单复数形状不一致（zh 是 string、en 是 {one,other} 这种，t() 会崩）
 *
 *  B. 真实渲染（Edge + 七种语言各开一次，读 DOM）：
 *       · <html lang> 与菜单/状态栏/侧栏/面板文字是否真的换了
 *       · 非中日韩语言里不许出现汉字（语言菜单的母语名除外——那是刻意的）
 *       · 不许出现 `{name}` 这类未替换的占位符、不许出现键名本身、不许 undefined
 *       · 显式偏好压过系统语言；「跟随系统」能按 navigator.language 命中
 *       · 切完刷新仍保持（localStorage 持久化）
 *
 * 用例：
 *   node i18n-check.mjs [url]
 */

import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const PAGE_URL = process.argv[2] || 'http://127.0.0.1:4173/index.html'
const OUT = path.join(HERE, '..', 'artifacts', 'i18n')
const TMP = path.join(HERE, '.tmp-i18n')

const IDS = ['zh-CN', 'en', 'ja', 'ko', 'es', 'fr', 'de']
const FILES = { 'zh-CN': 'zh-CN', en: 'en', ja: 'ja', ko: 'ko', es: 'es', fr: 'fr', de: 'de' }

const report = { static: {}, browser: {}, pass: false, errors: [] }
fs.mkdirSync(OUT, { recursive: true })

/* ================================================================== *
 * A. 静态键比对
 * ================================================================== */
function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') out[key] = v
    else if (v && typeof v === 'object' && 'one' in v && 'other' in v) out[key] = v
    else if (v && typeof v === 'object') flatten(v, key, out)
  }
  return out
}

const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')

function staticCheck() {
  /*
   * 刻意不删 TMP。tsc 的产物固定是那 7 个文件名，每次覆盖写，留着不影响下一轮结论；
   * 而删目录这件事在部分环境里会把验收拖死：本机宿主的安全删除钩子对目录删是
   * fail-closed 且会卡到 spawnSync ETIMEDOUT（实测 4 分钟才报错），Windows 上还可能是 EBUSY。
   * 一个跑 40 秒的验收脚本不该因为「清理没做成」变成红的或变成 5 分钟。
   * 目录已加进 .gitignore。
   */
  // tsc 不许"命令行给了文件又读 tsconfig"（TS5112），所以另写一份只含词表的配置
  const tsconfig = path.join(HERE, '.tmp-i18n.tsconfig.json')
  fs.writeFileSync(
    tsconfig,
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          skipLibCheck: true,
          isolatedModules: true,
          noEmit: false,
          declaration: false,
          rootDir: 'src/i18n/locales',
          outDir: '.tmp-i18n',
        },
        include: ['src/i18n/locales/*.ts'],
      },
      null,
      2,
    ),
  )
  try {
    execFileSync(
      process.execPath,
      [path.join(HERE, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', tsconfig],
      { cwd: HERE, stdio: 'pipe' },
    )
  } finally {
    fs.rmSync(tsconfig, { force: true })
  }

  // tsc 不会把扩展名补上，Node 的 ESM 解析需要它
  for (const f of fs.readdirSync(TMP, { recursive: true })) {
    const p = path.join(TMP, String(f))
    if (!p.endsWith('.js')) continue
    const src = fs.readFileSync(p, 'utf8')
    const fixed = src.replace(/from '(\.{1,2}\/[^']+)'/g, (m, spec) => (spec.endsWith('.js') ? m : `from '${spec}.js'`))
    if (fixed !== src) fs.writeFileSync(p, fixed)
  }

  const dicts = {}
  const mods = {}
  return Promise.all(
    IDS.map(async (id) => {
      const mod = await import(pathToFileURL(path.join(TMP, `${FILES[id]}.js`)).href)
      mods[id] = mod.default
      dicts[id] = flatten(mod.default)
      return null
    }),
  ).then(() => {
    const base = dicts['zh-CN']
    const baseKeys = Object.keys(base).sort()
    const per = {}

    for (const id of IDS) {
      const d = dicts[id]
      const keys = Object.keys(d).sort()
      const missing = baseKeys.filter((k) => !(k in d))
      const extra = keys.filter((k) => !(k in base))
      const empty = keys.filter((k) => {
        const v = d[k]
        return typeof v === 'string' ? v.trim() === '' : !v.one?.trim() || !v.other?.trim()
      })
      const shape = keys.filter((k) => {
        const a = base[k]
        const b = d[k]
        if (a === undefined) return false
        return typeof a !== typeof b
      })
      const phBad = []
      for (const k of baseKeys) {
        const a = base[k]
        const b = d[k]
        if (b === undefined) continue
        const as = typeof a === 'string' ? [ph(a)] : [ph(a.one), ph(a.other)]
        const bs = typeof b === 'string' ? [ph(b)] : [ph(b.one), ph(b.other)]
        if (as.join('|') !== bs.join('|')) phBad.push({ key: k, zh: as, loc: bs })
      }
      per[id] = {
        keys: keys.length,
        missing,
        extra,
        empty,
        shapeMismatch: shape,
        placeholderMismatch: phBad,
      }
      for (const m of missing) report.errors.push(`[${id}] 缺键 ${m}`)
      for (const e of extra) report.errors.push(`[${id}] 多余键 ${e}`)
      for (const e of empty) report.errors.push(`[${id}] 空值 ${e}`)
      for (const s of shape) report.errors.push(`[${id}] 形状不一致（string vs 单复数） ${s}`)
      for (const p of phBad) report.errors.push(`[${id}] 占位符不一致 ${p.key}: zh=${p.zh} loc=${p.loc}`)
    }

    report.static = { keyCount: baseKeys.length, locales: per }
    return { dicts, keys: baseKeys }
  })
}

/* ================================================================== *
 * B. 真实渲染
 * ================================================================== */
const CJK = /[\u3040-\u30ff\uac00-\ud7af\u4e00-\u9fff]/

/** 只挑几个「一眼能看出没翻译」的菜单项，与词表逐字比对 */
const SPOT = {
  'file-create': 'file.create',
  'file-open': 'file.open',
  'file-export-html': 'file.exportHtml',
  'edit-undo': 'edit.undo',
  'paragraph-h1': 'paragraph.heading',
  'format-bold': 'format.bold',
  'view-source': 'view.source',
  'lang-system': 'language.followSystem',
  'help-about': 'help.about',
}

// v0.8.0 起多了「设置」：图片引用方式是跨插入/渲染/导出的全局策略，值得一个顶级入口
// v0.10.0：language 降进 settings 成为二级，顶上来的是 layout；总数仍是 9
const MENU_IDS = ['file', 'edit', 'paragraph', 'format', 'view', 'theme', 'layout', 'settings', 'help']

async function collect(page) {
  return page.evaluate(async (menuIds) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const roots = [...document.querySelectorAll('#menubar-items .menu-root')]
    const out = {
      lang: document.documentElement.lang,
      roots: roots.map((b) => ({ id: b.dataset.menu, label: b.textContent.trim() })),
      items: {},
      status: [...document.querySelectorAll('.statusbar .status-toggle')].map((e) => e.textContent.trim()),
      statusWords: document.getElementById('st-words')?.textContent ?? '',
      statusLines: document.getElementById('st-lines')?.textContent ?? '',
      chip: document.getElementById('chip-mode')?.textContent ?? '',
      tabs: [...document.querySelectorAll('#sidebar .tab')].map((e) => e.getAttribute('aria-label')),
      collapse: document.getElementById('btn-collapse-sidebar')?.getAttribute('aria-label'),
      outlineHint: document.querySelector('#outline-body .empty-hint')?.textContent ?? '',
      outlineItems: document.querySelectorAll('#outline-body .outline-item').length,
      dock: [...document.querySelectorAll('#mobile-dock .ma-btn')].map((e) => ({
        act: e.dataset.act,
        label: e.querySelector('span')?.textContent ?? '',
      })),
    }

    // 逐个菜单打开、读项、再关上
    for (const id of menuIds) {
      const btn = roots.find((b) => b.dataset.menu === id)
      if (!btn) continue
      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      await sleep(60)
      const pop = document.querySelector('.menu-drop')
      if (pop) {
        const read = (host) =>
          [...host.querySelectorAll('.menu-item')].map((b) => ({
            mi: b.dataset.mi || '',
            label: b.querySelector('.mi-label')?.textContent ?? '',
            disabled: b.disabled,
          }))
        const flat = read(pop)
        // v0.10.0 起有二级菜单了（设置 → 语言、排版 → 尺寸…），逐项展开再读一遍，
        // 否则「语言」降级后 lang-system 之类的项在顶层根本采不到
        for (const parent of [...pop.querySelectorAll('.menu-item.has-sub')]) {
          parent.dispatchEvent(new MouseEvent('mouseenter'))
          await sleep(70)
          const sub = document.querySelector('.menu-drop.sub')
          if (sub) flat.push(...read(sub))
        }
        out.items[id] = flat
      }
      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      await sleep(40)
    }
    return out
  }, MENU_IDS)
}

function checkRendered(id, dom, dict) {
  const errs = []
  const label = `[${id}]`
  if (dom.lang !== id) errs.push(`${label} html lang = ${dom.lang}`)

  // 1. 顶级菜单：文字必须等于词表，顺序与数量也要对
  const rootLabels = dom.roots.map((r) => r.label)
  if (dom.roots.length !== MENU_IDS.length) errs.push(`${label} 顶级菜单数量 ${dom.roots.length}`)
  for (const r of dom.roots) {
    const want = dict[`menu.${r.id}`]
    if (want === undefined) errs.push(`${label} 未知菜单 id ${r.id}`)
    else if (r.label !== want) errs.push(`${label} 菜单 ${r.id} 显示「${r.label}」应为「${want}」`)
  }

  // 2. 所有菜单项：非空、无占位残留、无键名、无 undefined
  const allItems = Object.entries(dom.items).flatMap(([menu, arr]) => arr.map((x) => ({ menu, ...x })))
  // 顶级下拉里的项（页面宽度那 5 个二级项要 hover 才出现，不计入）
  if (allItems.length < 55) errs.push(`${label} 菜单项只读到 ${allItems.length} 条`)
  for (const it of allItems) {
    const t = it.label.trim()
    if (!t) errs.push(`${label} ${it.mi} 空文案`)
    if (/\{[a-z]\w*\}/i.test(t)) errs.push(`${label} ${it.mi} 占位符没替换：${t}`)
    if (/^(menu|file|edit|paragraph|format|view|theme|language|help|toast|sidebar)\.[a-zA-Z.]+$/.test(t))
      errs.push(`${label} ${it.mi} 显示的是键名：${t}`)
    if (/undefined|null/.test(t)) errs.push(`${label} ${it.mi} 含 undefined/null：${t}`)
  }

  // 3. 拉丁语言里不许出现汉字（语言菜单的母语名是刻意的，排除）
  if (!['zh-CN', 'ja', 'ko'].includes(id)) {
    for (const it of allItems) {
      if (it.mi.startsWith('lang-')) continue
      if (CJK.test(it.label)) errs.push(`${label} ${it.mi} 未翻译：${it.label}`)
    }
    for (const s of [...dom.status, dom.chip, ...dom.tabs, dom.collapse ?? '', dom.outlineHint]) {
      if (CJK.test(s)) errs.push(`${label} 未翻译：${s}`)
    }
    for (const d of dom.dock) if (CJK.test(d.label)) errs.push(`${label} dock.${d.act} 未翻译：${d.label}`)
  }

  // 4. 抽检：菜单项文字 == 词表值（带参数的做一次替换）
  for (const [mi, key] of Object.entries(SPOT)) {
    const hit = allItems.find((x) => x.mi === mi)
    if (!hit) {
      errs.push(`${label} 找不到菜单项 ${mi}`)
      continue
    }
    let want = dict[key]
    if (typeof want !== 'string') want = want.other
    want = want.replace('{level}', '1')
    if (hit.label !== want) errs.push(`${label} ${mi} 显示「${hit.label}」应为「${want}」`)
  }

  // 5. 状态栏/侧栏也要真的换了语言
  const wordsTpl = typeof dict['status.words'] === 'string' ? dict['status.words'] : dict['status.words'].other
  const wordsSuffix = wordsTpl.replace('{value}', '').trim()
  if (!/\d/.test(dom.statusWords) || !dom.statusWords.includes(wordsSuffix))
    errs.push(`${label} 状态栏字数没换：${dom.statusWords}（期望含「${wordsSuffix}」）`)
  // 示例文档有标题，此时读不到空态文案；只有真空态才校验那句提示
  if (dom.outlineItems === 0 && !dom.outlineHint.trim()) errs.push(`${label} 大纲空态没文字`)
  if (dom.outlineItems === 0 && !['zh-CN', 'ja', 'ko'].includes(id) && CJK.test(dom.outlineHint))
    errs.push(`${label} 大纲空态未翻译`)

  return errs
}

async function browserCheck(dicts) {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const ctxErrors = []
  const per = {}

  for (const id of IDS) {
    // 系统语言故意给 en-US：证明"显式偏好 > 系统语言"
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    await ctx.addInitScript((loc) => {
      localStorage.setItem('lypora:locale', JSON.stringify(loc))
    }, id)
    const page = await ctx.newPage()
    page.on('pageerror', (e) => ctxErrors.push(`[${id}] pageerror ${e.message}`))
    await page.goto(PAGE_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(450)

    const dom = await collect(page)
    const errs = checkRendered(id, dom, dicts[id])

    // 切到移动端视口再收一遍 dock / 面板文字
    // 必须真刷新：boot() 只在启动时判断"窄屏默认收起侧栏"，单纯改视口侧栏不会收，
    // 截图里就会一直挂着抽屉（看着像 bug，其实是测试姿势不对）
    await page.setViewportSize({ width: 393, height: 851 })
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    const mobile = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
      const btn = document.querySelector('#mobile-dock .ma-btn[data-act="menu"]')
      btn?.click()
      await sleep(250)
      const sheet = document.getElementById('menu-sheet')
      const out = {
        dock: [...document.querySelectorAll('#mobile-dock .ma-btn')].map((e) => e.querySelector('span')?.textContent ?? ''),
        sheetTitle: sheet?.querySelector('.sheet-title')?.textContent ?? '',
        sections: [...document.querySelectorAll('#menu-sheet .sheet-section')].map((s) => ({
          id: s.dataset.section,
          title: s.querySelector('.sheet-section-title')?.textContent ?? '',
          rows: s.querySelectorAll('.sheet-row').length,
        })),
        sheetRows: [...document.querySelectorAll('#menu-sheet .sheet-row')].map((r) => ({
          mi: r.dataset.mi || '',
          label: r.querySelector('.sr-label')?.textContent ?? '',
        })),
      }
      document.querySelector('#menu-sheet .sheet-close')?.click()
      return out
    })
    if (mobile.sections.length !== MENU_IDS.length)
      errs.push(`[${id}] 移动面板分区 ${mobile.sections.length}`)
    for (const r of mobile.sheetRows) {
      if (!r.label.trim()) errs.push(`[${id}] 面板空行 ${r.mi}`)
      if (/\{[a-z]\w*\}/i.test(r.label)) errs.push(`[${id}] 面板占位符没替换：${r.label}`)
      // 语言那一组用母语名显示，是刻意的，不算未翻译
      if (r.mi.startsWith('lang-')) continue
      if (!['zh-CN', 'ja', 'ko'].includes(id) && CJK.test(r.label)) errs.push(`[${id}] 面板未翻译：${r.label}`)
    }
    if (!['zh-CN', 'ja', 'ko'].includes(id)) {
      for (const d of mobile.dock) if (CJK.test(d)) errs.push(`[${id}] dock 未翻译：${d}`)
      if (CJK.test(mobile.sheetTitle)) errs.push(`[${id}] 面板标题未翻译：${mobile.sheetTitle}`)
    }

    await page.screenshot({ path: path.join(OUT, `mobile-${id}.png`) })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.waitForTimeout(250)
    await page.screenshot({ path: path.join(OUT, `desktop-${id}.png`) })

    per[id] = {
      lang: dom.lang,
      menus: dom.roots.map((r) => r.label),
      items: Object.values(dom.items).flat().length,
      dock: mobile.dock,
      sections: mobile.sections.length,
      errors: errs,
    }
    report.errors.push(...errs)
    await ctx.close()
  }

  // 6. 跟随系统：不给偏好，系统给 de-DE → 期望 de
  {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 }, locale: 'de-DE' })
    const page = await ctx.newPage()
    await page.goto(PAGE_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(400)
    const lang = await page.evaluate(() => document.documentElement.lang)
    const fileMenu = await page.locator('#menubar-items .menu-root[data-menu="file"]').innerText()
    per.systemFollow = { system: 'de-DE', resolved: lang, fileMenu }
    if (lang !== 'de') report.errors.push(`[system] de-DE 应解析为 de，实际 ${lang}`)
    if (fileMenu.trim() !== dicts.de['menu.file']) report.errors.push('[system] 跟随系统后菜单没变')
    await ctx.close()
  }

  // 7. 运行时切换 + 持久化：中文界面里点「语言 → 日本語」→ 刷新仍在
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'zh-CN' })
    const page = await ctx.newPage()
    await page.goto(PAGE_URL, { waitUntil: 'networkidle' })
    await page.waitForTimeout(400)
    const before = await page.evaluate(() => document.documentElement.lang)
    await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
      // v0.10.0：语言降进「设置」成为二级菜单，靠 mouseenter 展开（与 Windows 原生菜单一致）
      const btn = document.querySelector('#menubar-items .menu-root[data-menu="settings"]')
      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      await sleep(80)
      const parent = document.querySelector('.menu-drop .menu-item[data-mi="settings-language"]')
      parent?.dispatchEvent(new MouseEvent('mouseenter'))
      await sleep(150)
      document.querySelector('.menu-drop.sub .menu-item[data-mi="lang-ja"]')?.click()
      await sleep(250)
    })
    const after = await page.evaluate(() => ({
      lang: document.documentElement.lang,
      fileMenu: document.querySelector('#menubar-items .menu-root[data-menu="file"]')?.textContent ?? '',
      status: document.getElementById('st-words')?.textContent ?? '',
    }))
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(400)
    const reloaded = await page.evaluate(() => document.documentElement.lang)
    const stored = await page.evaluate(() => localStorage.getItem('lypora:locale'))
    per.runtimeSwitch = { before, after, reloaded, stored }
    if (after.lang !== 'ja') report.errors.push(`[switch] 运行时切换后 lang=${after.lang}`)
    if (reloaded !== 'ja') report.errors.push(`[switch] 刷新后没保持，lang=${reloaded}`)
    if (stored !== '"ja"') report.errors.push(`[switch] 持久化值异常：${stored}`)
    await ctx.close()
  }

  report.errors.push(...ctxErrors)
  report.browser = per
  await browser.close()
}

/* ================================================================== *
 * main
 * ================================================================== */
const { dicts } = await staticCheck()
await browserCheck(dicts)

report.pass = report.errors.length === 0
const outFile = path.join(OUT, 'i18n-report.json')
fs.writeFileSync(outFile, JSON.stringify(report, null, 2))
// 结尾同样不删 TMP，理由见 staticCheck() 开头。

console.log(JSON.stringify(report, null, 2))
process.exit(report.pass ? 0 : 1)
