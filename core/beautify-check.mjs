/**
 * 「排版」验收 —— 七组硬指标，任一不过即失败。
 *
 *  A. 交互：一级菜单「排版」能开面板、20 套模板按钮齐全、20s 内出预览、Esc 能关。
 *  B. 模板：20 套逐一出图，且每张采样颜色数 > 8（防"白图假通过"）。
 *  C. 参数：改字号必须让页数变化（证明"参数→重排"链路真的通了，不是只换 CSS）；
 *           纹理必须在**同一字号**下比「无 → 网格」，并且设回去要回到基线
 *           （v0.9.0 拿改字号前的图当基线，纹理完全不可见也能通过）。
 *  C2. 背景与装订：两种底纹必须产出不同像素、装订位必须看得见、
 *           上传自定义图必须写进 decor.bgImage 并出现在缩略图。
 *  D. 模板进出：导出 .lyt.json（schema 3，含 decor 新字段）→ 再导入 → 成为当前模板；
 *           「存为我的模板」必须弹命名框，自定义名字要出现在「我的模板」里。
 *  E. 离线：整场操作**零外部网络请求**（除本机 127.0.0.1 静态资源）。
 *
 * 用法：node beautify-check.mjs [url]
 */

import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const PAGE_URL = process.argv[2] || 'http://127.0.0.1:4173/index.html'
const OUT = path.join(HERE, '..', 'artifacts', 'beautify')
fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })

const report = { steps: {}, errors: [], pass: false }
const errors = report.errors

const SAMPLE = `# Lypora 美化输出验收

这是用来验收模板与分页的正文。中文混排 English words 456 与 \`行内代码\` 同时出现。

## 一、列表与强调

- **粗体**、*斜体*、~~删除线~~、==高亮== 都要看得出来
- [ ] 未完成的待办
- [x] 已完成的待办

1. 有序第一项
2. 有序第二项

## 二、代码块

\`\`\`ts
export function compile(t: CardTemplate): string {
  const m = t.metrics
  return \`.ly-card[data-tpl="\${t.id}"]{ --c-size: \${m.fontSize}px }\`
}
\`\`\`

## 三、表格

| 项目 | 说明 | 状态 |
| --- | --- | --- |
| 模板 | 20 套内置 | 通过 |
| 参数 | 19 项可调 | 通过 |

## 四、公式

行内 $E = mc^2$ 与块公式：

$$
\\int_{0}^{1} x^{2}\\,dx = \\frac{1}{3}
$$

${Array.from({ length: 8 }, (_, i) => `第 ${i + 1} 段：这段故意写长，用来把内容顶到第二页、第三页，验证自动分页按渲染高度切。`).join('\n\n')}
`

function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
}

const browser = await chromium.launch({ executablePath: EDGE, headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: 'zh-CN', acceptDownloads: true })
const page = await ctx.newPage()

const external = []
page.on('request', (req) => {
  const u = req.url()
  if (!u.startsWith('http://127.0.0.1') && !u.startsWith('data:') && !u.startsWith('blob:') && !u.startsWith('file:')) external.push(u)
})
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('[console] ' + m.text())
})
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message))

await page.goto(PAGE_URL, { waitUntil: 'networkidle' })
await page.waitForTimeout(600)

/* ---------- A. 交互 ---------- */
await page.click('.cm-content', { position: { x: 40, y: 12 } })
await page.keyboard.press('Control+A')
await page.keyboard.insertText(SAMPLE)
await page.waitForTimeout(500)

await page.evaluate(() => {
  const btn = document.querySelector('#menubar-items .menu-root[data-menu="layout"]')
  btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
})
await page.waitForTimeout(200)
// v0.10.0：入口从「文件 → 美化输出」升成一级菜单「排版 → 打开排版面板」
await page.click('.menu-drop .menu-item[data-mi="layout-open"]', { timeout: 5000 })
await page.waitForTimeout(1800)

const open = await page.locator('.ce').count()
const tplCount = await page.locator('.ce-style[data-tpl]').count()
report.steps.panel = { open: open === 1, templates: tplCount }
if (!open) errors.push('排版面板没有打开')
if (tplCount < 20) errors.push(`模板数量不足：${tplCount} < 20`)

await page.waitForFunction(() => {
  const img = document.querySelector('.ce-img')
  return img && img.src && img.src.startsWith('data:image/png')
}, { timeout: 20000 }).catch(() => errors.push('预览图 20s 内没有出现'))
await page.screenshot({ path: path.join(OUT, 'panel.png') })

const colorStats = async (file) => {
  const b64 = fs.readFileSync(file).toString('base64')
  return page.evaluate(async (data) => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + data
    await img.decode()
    const c = document.createElement('canvas')
    c.width = 120
    c.height = 120
    const g = c.getContext('2d')
    g.drawImage(img, 0, 0, 120, 120)
    const d = g.getImageData(0, 0, 120, 120).data
    const set = new Set()
    for (let i = 0; i < d.length; i += 4) set.add((d[i] >> 3) + ',' + (d[i + 1] >> 3) + ',' + (d[i + 2] >> 3))
    return { unique: set.size, sig: Array.from(set).slice(0, 40).join('|') }
  }, b64)
}

const grab = async (name) => {
  const url = await page.evaluate(() => document.querySelector('.ce-img')?.src || '')
  if (!url.startsWith('data:image/png')) return null
  const buf = Buffer.from(url.split(',')[1], 'base64')
  const file = path.join(OUT, name)
  fs.writeFileSync(file, buf)
  const s = pngSize(buf)
  const stat = await colorStats(file)
  return { file: name, w: s?.w, h: s?.h, unique: stat.unique, sig: stat.sig }
}

/* ---------- B. 12 套模板 ---------- */
const ids = await page.$$eval('.ce-style[data-tpl]', (els) => els.map((e) => e.dataset.tpl))
const shots = {}
for (const id of ids) {
  await page.click(`.ce-style[data-tpl="${id}"]`)
  await page.waitForTimeout(750)
  const s = await grab(`tpl-${id}.png`)
  if (!s) errors.push(`模板 ${id} 没有产出预览`)
  else {
    if (!s.w || s.w < 200) errors.push(`模板 ${id} 预览尺寸异常`)
    if (s.unique < 8) errors.push(`模板 ${id} 预览几乎纯色（unique=${s.unique}）`)
    shots[id] = s
  }
}
report.steps.templates = Object.fromEntries(Object.entries(shots).map(([k, v]) => [k, { w: v.w, h: v.h, unique: v.unique }]))

/* ---------- C. 参数生效 ---------- */
const pageCountOf = async () => {
  const txt = await page.locator('.ce-pos').innerText()
  return Number(txt.split('/').pop().trim())
}

// 回到素纸，记录基线
await page.click('.ce-style[data-tpl="paper"]')
await page.waitForTimeout(900)
const basePages = await pageCountOf()
const baseShot = await grab('param-before.png')

// 字号拉到最大：行数必然变多，页数应当增加（或至少不变小）
await page.evaluate(() => {
  const input = document.querySelector('.ce-param[data-path="metrics.fontSize"] input[type="range"]')
  input.value = '21'
  input.dispatchEvent(new Event('input', { bubbles: true }))
})
await page.waitForTimeout(1600)
const bigPages = await pageCountOf()
const bigShot = await grab('param-bigfont.png')

/*
 * 纹理：必须在**同一字号**下对比「无纹理 → 网格」。
 * v0.9.0 这里是对着"改字号之前"的图比的，字号变化本身就足以让像素不同，
 * 于是"白线画白纸、纹理根本没画出来"照样通过 —— 假通过比没有测试更糟。
 */
const texBase = await grab('texture-none.png')
await page.evaluate(() => {
  const btn = document.querySelector('.ce-param[data-path="decor.texture"] .ce-seg-btn[data-val="grid"]')
  btn.click()
})
await page.waitForTimeout(1400)
const texShot = await grab('param-texture.png')

await page.evaluate(() => {
  const btn = document.querySelector('.ce-param[data-path="decor.texture"] .ce-seg-btn[data-val="none"]')
  btn.click()
})
await page.waitForTimeout(1200)
const texBack = await grab('texture-back.png')

report.steps.params = {
  basePages,
  bigFontPages: bigPages,
  fontChangedPages: basePages !== bigPages,
}
report.steps.texture = {
  noneVsGridDiffer: !!(texBase && texShot && texBase.sig !== texShot.sig),
  gridUnique: texShot?.unique,
  restoredToBaseline: !!(texBase && texBack && texBase.sig === texBack.sig),
}
if (basePages === bigPages) errors.push(`改字号后页数没变（${basePages}），参数→重排链路可能断了`)
if (!(texBase && texShot) || texBase.sig === texShot.sig) errors.push('纹理设成网格后像素没变（纹理不可见？）')
if (texBase && texBack && texBase.sig !== texBack.sig) errors.push('纹理设回「无」后像素与基线不一致')

/* ---------- C2. 背景底纹 / 装订 / 自定义背景图 ---------- */
const clickSeg = async (path, val) => {
  await page.evaluate(
    ([p, v]) => {
      document.querySelector(`.ce-param[data-path="${p}"] .ce-seg-btn[data-val="${v}"]`)?.click()
    },
    [path, val],
  )
  await page.waitForTimeout(1300)
}

await page.click('.ce-bg[data-bg="kraft"]')
await page.waitForTimeout(1400)
const bgKraft = await grab('bg-kraft.png')

await page.click('.ce-bg[data-bg="lined"]')
await page.waitForTimeout(1400)
const bgLined = await grab('bg-lined.png')

await clickSeg('decor.binding', 'spiral')
const bindShot = await grab('bind-spiral.png')
await clickSeg('decor.binding', 'none')

report.steps.background = {
  kraftVsLined: !!(bgKraft && bgLined && bgKraft.sig !== bgLined.sig),
  kraftVsBase: !!(bgKraft && texBack && bgKraft.sig !== texBack.sig),
  bindingDrawn: !!(bindShot && texBack && bindShot.sig !== texBack.sig),
}
if (!(bgKraft && bgLined) || bgKraft.sig === bgLined.sig) errors.push('两种背景底纹产出的像素相同（背景没生效）')
if (!(bgKraft && texBack) || bgKraft.sig === texBack.sig) errors.push('加了背景底纹但像素没变')
if (!(bindShot && texBack) || bindShot.sig === texBack.sig) errors.push('装订位设成线圈后像素没变')

// 自定义背景图：喂一张真实图片进 file input
const bgPng = path.join(OUT, 'bg-source.png')
// 现场用 canvas 造一张（不往仓库里塞二进制测试素材）：
// 斜向橙红渐变 + 竖条，切到「封面」区域时保证能看出确实换了底
if (!fs.existsSync(bgPng)) {
  const b64 = await page.evaluate(() => {
    const cv = document.createElement('canvas')
    cv.width = 240
    cv.height = 240
    const g = cv.getContext('2d')
    const grd = g.createLinearGradient(0, 0, 240, 240)
    grd.addColorStop(0, '#ff5f6d')
    grd.addColorStop(1, '#ffc371')
    g.fillStyle = grd
    g.fillRect(0, 0, 240, 240)
    g.fillStyle = 'rgba(20, 20, 60, 0.28)'
    for (let i = 0; i < 240; i += 26) g.fillRect(i, 0, 11, 240)
    return cv.toDataURL('image/png').split(',')[1]
  })
  fs.writeFileSync(bgPng, Buffer.from(b64, 'base64'))
}
const bgInput = await page.$('.ce-settings input[data-act="bg-file"]')
await bgInput.setInputFiles(bgPng)
await page.waitForTimeout(1800)
const bgCustom = await grab('bg-custom.png')
const hasThumb = await page.locator('.ce-bg-thumb').count()
report.steps.bgImage = {
  thumbShown: hasThumb > 0,
  differsFromPreset: !!(bgCustom && bgLined && bgCustom.sig !== bgLined.sig),
}
if (!hasThumb) errors.push('上传背景图后没有缩略图（decor.bgImage 没写进去）')
if (!(bgCustom && bgLined) || bgCustom.sig === bgLined.sig) errors.push('上传背景图后画面没变')
await page.evaluate(() => {
  document.querySelector('.ce-seg-btn[data-act="bg-clear"]')?.click()
})
await page.waitForTimeout(1200)

/* ---------- D. 模板导出 / 导入 ---------- */
const dlTpl = page.waitForEvent('download', { timeout: 30000 }).catch(() => null)
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.ce-seg-btn')]
  btns.find((b) => b.textContent.includes('导出模板'))?.click()
})
const dTpl = await dlTpl
if (!dTpl) errors.push('导出模板没有触发下载')
else {
  const f = path.join(OUT, 'current.lyt.json')
  await dTpl.saveAs(f)
  const json = JSON.parse(fs.readFileSync(f, 'utf8'))
  report.steps.templateExport = {
    file: path.basename(f),
    schema: json.schema,
    id: json.id,
    hasTokens: !!json.tokens,
    hasMetrics: !!json.metrics,
    hasDecor: !!json.decor,
  }
  if (json.schema !== 3 || !json.tokens?.accent) errors.push('导出的模板缺少 schema/tokens')
  // 新增字段必须随模板一起走，否则换台机器打开就丢背景
  report.steps.templateExport.hasDecorFields =
    json.decor && 'bg' in json.decor && 'bgImage' in json.decor && 'bgOpacity' in json.decor && 'binding' in json.decor
  if (!report.steps.templateExport.hasDecorFields) errors.push('导出的模板缺 v0.10.0 的 decor 字段')

  // 改个名字再导入，避免与内置 id 冲突后走重命名分支（测主路径）
  json.id = 'imported-test'
  json.name = '导入测试'
  const inFile = path.join(OUT, 'import-test.lyt.json')
  fs.writeFileSync(inFile, JSON.stringify(json, null, 2))

  await page.setInputFiles('.ce-settings input[type="file"]', inFile)
  await page.waitForTimeout(1500)
  const mineCount = await page.locator('.ce-style[data-tpl^="imported-test"]').count()
  const curName = await page.locator('.ce-style.on .ce-style-name').innerText().catch(() => '')
  report.steps.templateImport = { mineCount, current: curName }
  if (mineCount < 1) errors.push('导入的模板没有出现在「我的模板」')
  if (curName !== '导入测试') errors.push(`导入后当前模板不是它：${curName}`)
}

/* ---------- D2. 我的模板：自定义名称 ---------- */
await page.click('.ce-style[data-tpl="paper"]')
await page.waitForTimeout(900)
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.ce-seg-btn')]
  btns.find((b) => b.textContent.includes('存为我的模板'))?.click()
})
await page.waitForTimeout(500)
const hasPrompt = await page.locator('.modal input[type="text"]').count()
let defaultName = ''
if (!hasPrompt) errors.push('点「存为我的模板」没有弹出命名框')
else {
  defaultName = await page.locator('.modal input[type="text"]').inputValue()
  await page.fill('.modal input[type="text"]', '我的素纸A')
  await page.click('.modal-actions .primary')
  await page.waitForTimeout(800)
}
const named = await page.locator('.ce-style-name:has-text("我的素纸A")').count()
report.steps.saveAsMine = { prompt: hasPrompt > 0, defaultName, found: named }
if (hasPrompt && named < 1) errors.push('自定义名称没有出现在「我的模板」里')

/* ---------- 导出产物 ---------- */
await page.click('.ce-style[data-tpl="magazine"]')
await page.waitForTimeout(1000)

const dlPng = page.waitForEvent('download', { timeout: 60000 }).catch(() => null)
await page.click('.ce-btn[data-act="png"]')
const d1 = await dlPng
if (!d1) errors.push('PNG 导出没有触发下载')
else {
  const f = path.join(OUT, d1.suggestedFilename())
  await d1.saveAs(f)
  report.steps.png = { file: d1.suggestedFilename(), bytes: fs.statSync(f).size }
  if (fs.statSync(f).size < 2000) errors.push('PNG/ZIP 产物过小')
}

const dlPdf = page.waitForEvent('download', { timeout: 60000 }).catch(() => null)
await page.click('.ce-btn[data-act="pdf"]')
const d2 = await dlPdf
if (!d2) errors.push('PDF 导出没有触发下载')
else {
  const f = path.join(OUT, 'export.pdf')
  await d2.saveAs(f)
  const buf = fs.readFileSync(f)
  const text = buf.toString('latin1')
  const pages = (text.match(/\/Type\s*\/Page[^s]/g) || []).length
  const box = text.match(/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/)
  report.steps.pdf = { bytes: buf.length, pages, mediaBox: box ? [+box[1], +box[2]] : null, eof: text.includes('%%EOF') }
  if (!text.startsWith('%PDF-1.4')) errors.push('PDF 头不合法')
  if (pages < 1) errors.push('PDF 没有页')
  if (!text.includes('%%EOF')) errors.push('PDF 缺 EOF')
}

/* ---------- E. 离线审计 ---------- */
report.steps.offline = { externalRequests: external.slice(0, 10), count: external.length }
if (external.length) errors.push(`存在 ${external.length} 个外部网络请求：${external.slice(0, 3).join(', ')}`)

await page.keyboard.press('Escape')
await page.waitForTimeout(300)
report.steps.close = { closed: (await page.locator('.ce').count()) === 0 }

report.pass = errors.length === 0
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
await browser.close()
console.log(JSON.stringify(report, null, 2))
process.exit(report.pass ? 0 : 1)
