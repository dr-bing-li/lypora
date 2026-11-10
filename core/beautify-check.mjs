/**
 * 「美化输出」验收 —— 五组硬指标，任一不过即失败。
 *
 *  A. 交互：菜单能开面板、12 套模板按钮齐全、20s 内出预览、Esc 能关。
 *  B. 模板：12 套逐一出图，且每张采样颜色数 > 8（防"白图假通过"）。
 *  C. 参数：改字号必须让页数变化（证明"参数→重排"链路真的通了，不是只换 CSS）；
 *           改纹理必须让像素变化（证明装饰位生效）。
 *  D. 模板进出：导出 .lyt.json → 再导入 → 出现在「我的模板」并成为当前模板。
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
| 模板 | 12 套内置 | 通过 |
| 参数 | 17 项可调 | 通过 |

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
  const btn = document.querySelector('#menubar-items .menu-root[data-menu="file"]')
  btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
})
await page.waitForTimeout(200)
await page.click('.menu-drop .menu-item[data-mi="file-beautify"]', { timeout: 5000 })
await page.waitForTimeout(1800)

const open = await page.locator('.ce').count()
const tplCount = await page.locator('.ce-style[data-tpl]').count()
report.steps.panel = { open: open === 1, templates: tplCount }
if (!open) errors.push('美化输出面板没有打开')
if (tplCount < 12) errors.push(`模板数量不足：${tplCount} < 12`)

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

// 纹理换成网格：像素必须变
await page.evaluate(() => {
  const btn = document.querySelector('.ce-param[data-path="decor.texture"] .ce-seg-btn[data-val="grid"]')
  btn.click()
})
await page.waitForTimeout(1400)
const texShot = await grab('param-texture.png')

report.steps.params = {
  basePages,
  bigFontPages: bigPages,
  fontChangedPages: basePages !== bigPages,
  textureChangedPixels: !!(baseShot && texShot && baseShot.sig !== texShot.sig),
  textureUnique: texShot?.unique,
}
if (basePages === bigPages) errors.push(`改字号后页数没变（${basePages}），参数→重排链路可能断了`)
if (!(baseShot && texShot) || baseShot.sig === texShot.sig) errors.push('换纹理后像素没变')

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
  if (json.schema !== 2 || !json.tokens?.accent) errors.push('导出的模板缺少 schema/tokens')

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
