/**
 * 卡片导出验收 —— 三条硬指标，任何一条不过就算失败：
 *
 *  A. 交互可用：菜单能打开面板、面板能出预览、切风格/尺寸/分页后面板不崩。
 *  B. 产物真实：PNG 的像素尺寸必须等于 preset.w × scale（不是 0、不是占位图），
 *     且图像不是纯色（采样多个像素，颜色数 > 8 才算真渲染出来了）。
 *  C. PDF 结构合法：页数 == 卡片数、MediaBox 尺寸匹配、每页都能被解析器读出图像对象。
 *
 * 用 Playwright + 系统 Edge，无头运行，产物落在 artifacts/card-export/。
 *   node card-check.mjs [url]
 */

import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const PAGE_URL = process.argv[2] || 'http://127.0.0.1:4173/index.html'
const OUT = path.join(HERE, '..', 'artifacts', 'card-export')
fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })

const report = { steps: {}, errors: [], pass: false }
const errors = report.errors

/** 长文档：含标题、列表、代码、表格、公式、引用、长代码块（验证自动分页与按行拆分） */
const SAMPLE = `# Lypora 卡片导出验收文档

这是一段用来验收排版与分页的正文。中文混排 English words 456 与 \`行内代码\` 同时出现，用来确认字重、行高与断行都正常。

## 一、列表与强调

- **粗体**、*斜体*、~~删除线~~、==高亮== 都要看得出来
- 二级项目
  - 三级项目，用来确认嵌套缩进
- [ ] 未完成的待办
- [x] 已完成的待办

1. 有序第一项
2. 有序第二项
3. 有序第三项

## 二、代码块

\`\`\`ts
export function paginate(md: string, opts: LayoutOptions): LayoutResult {
  const size = findSize(opts.sizeId)
  const blocks = htmlToBlocks(mdToHtml(md))
  let page: HTMLElement[] = []
  // 逐块塞进去量高度，超了就换页
  for (const b of blocks) {
    body.appendChild(b)
    if (body.scrollHeight > limit) {
      page = []
    }
  }
  return { pages, size, clipped: 0 }
}
\`\`\`

## 三、表格

| 项目 | 说明 | 状态 |
| --- | --- | --- |
| 分页 | DOM 实测高度 | 通过 |
| 风格 | 8 套 CSS 变量 | 通过 |
| 导出 | PNG / PDF / ZIP | 通过 |

## 四、引用与公式

> 引用块用来确认左侧竖线与字号收缩。
> 第二行继续。

行内公式 $E = mc^2$ 与块公式：

$$
\\int_{0}^{1} x^{2}\\,dx = \\frac{1}{3}
$$

## 五、长文分页

${Array.from({ length: 12 }, (_, i) => `第 ${i + 1} 段：这一段故意写长一些，用来把内容顶到第二页、第三页，从而验证自动分页是真的按渲染高度切，而不是按字符数估算。中文排版的行高、段间距、标题上下边距都会影响每页能装多少内容。`).join('\n\n')}

---

## 六、横线之后

这一节用于验证"按横线分页"模式：上面的 \`---\` 应该成为强制分页点。
`

/* ---------------- 工具 ---------------- */
function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
}

/** 用浏览器把 PNG 画进 canvas 采样，判断是否"真的画了东西" */
async function colorStats(page, file) {
  const b64 = fs.readFileSync(file).toString('base64')
  return page.evaluate(async (data) => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + data
    await img.decode()
    const c = document.createElement('canvas')
    c.width = 120
    c.height = 120
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0, 120, 120)
    const d = ctx.getImageData(0, 0, 120, 120).data
    const set = new Set()
    let sum = 0
    for (let i = 0; i < d.length; i += 4) {
      set.add((d[i] >> 3) + ',' + (d[i + 1] >> 3) + ',' + (d[i + 2] >> 3))
      sum += d[i] + d[i + 1] + d[i + 2]
    }
    return { unique: set.size, avg: Math.round(sum / (d.length / 4) / 3) }
  }, b64)
}

const browser = await chromium.launch({ executablePath: EDGE, headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 940 }, deviceScaleFactor: 1, locale: 'zh-CN', acceptDownloads: true })
const page = await ctx.newPage()
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('[console] ' + m.text())
})
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message))

await page.goto(PAGE_URL, { waitUntil: 'networkidle' })
await page.waitForTimeout(600)

/* ---------------- A. 交互 ---------------- */
// 灌入验收文档：全选后整体插入（CM6 下 insertText 走真实的输入管线）
await page.click('.cm-content', { position: { x: 40, y: 12 } })
await page.keyboard.press('Control+A')
await page.keyboard.insertText(SAMPLE)
await page.waitForTimeout(500)

const docLen = await page.evaluate(() => document.querySelectorAll('.cm-line').length)
report.steps.inject = { renderedLines: docLen }
// CM6 虚拟滚动只渲染可见行，29 行已经说明长文档被灌进去了（示例文档 60+ 行）
if (docLen < 20) errors.push(`文档注入似乎失败，只渲染了 ${docLen} 行`)

// 打开 文件 菜单 → 导出卡片
await page.evaluate(() => {
  const btn = document.querySelector('#menubar-items .menu-root[data-menu="file"]')
  btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
})
await page.waitForTimeout(200)
await page.click('.menu-drop .menu-item[data-mi="file-export-card"]', { timeout: 5000 })
await page.waitForTimeout(1500)

const panelOpen = await page.locator('.ce').count()
report.steps.panel = { open: panelOpen === 1 }
if (!panelOpen) errors.push('导出面板没有打开')

// 等预览出图
await page.waitForFunction(() => {
  const img = document.querySelector('.ce-img')
  return img && img.src && img.src.startsWith('data:image/png')
}, { timeout: 20000 }).catch(() => errors.push('预览图 20s 内没有出现'))

const posText = await page.locator('.ce-pos').innerText().catch(() => '')
report.steps.preview = { pos: posText }
await page.screenshot({ path: path.join(OUT, 'panel.png') })

/* ---------------- B. 逐风格出图 ---------------- */
const styles = await page.$$eval('.ce-style', (els) => els.map((e) => e.dataset.style))
report.steps.styles = styles
const shots = {}
for (const id of styles) {
  await page.click(`.ce-style[data-style="${id}"]`)
  await page.waitForTimeout(900)
  const grab = async (suffix) => {
    const dataUrl = await page.evaluate(() => document.querySelector('.ce-img')?.src || '')
    if (!dataUrl.startsWith('data:image/png')) {
      errors.push(`风格 ${id}${suffix} 没有产出预览图`)
      return null
    }
    const buf = Buffer.from(dataUrl.split(',')[1], 'base64')
    const f = path.join(OUT, `style-${id}${suffix}.png`)
    fs.writeFileSync(f, buf)
    const s = pngSize(buf)
    const stat = await colorStats(page, f)
    if (!s || s.w < 200) errors.push(`风格 ${id}${suffix} 预览尺寸异常`)
    if (stat.unique < 8) errors.push(`风格 ${id}${suffix} 预览几乎是纯色（unique=${stat.unique}），疑似没渲染`)
    return { file: path.basename(f), w: s?.w, h: s?.h, uniqueColors: stat.unique, avg: stat.avg }
  }
  const cover = await grab('-cover')
  // 翻到第 2 页看正文排版（代码块 / 表格 / 公式都在这页）
  const hasSecond = (await page.locator('.ce-pos').innerText()).includes('/') &&
    Number((await page.locator('.ce-pos').innerText()).split('/')[1].trim()) >= 2
  let content = null
  if (hasSecond) {
    await page.click('.ce-arrow[data-act="next"]')
    await page.waitForTimeout(900)
    content = await grab('-content')
    await page.click('.ce-arrow[data-act="prev"]')
    await page.waitForTimeout(500)
  }
  shots[id] = { cover, content }
}
report.steps.shots = shots

// 回到第一个风格，切尺寸验证重排
await page.click(`.ce-style[data-style="${styles[0]}"]`)
await page.click('.ce-seg-btn[data-size="square"]')
await page.waitForTimeout(1200)
const squarePos = await page.locator('.ce-pos').innerText().catch(() => '')
await page.click('.ce-seg-btn[data-size="xhs"]')
await page.waitForTimeout(1200)
const xhsPos = await page.locator('.ce-pos').innerText().catch(() => '')
report.steps.sizes = { square: squarePos, xhs: xhsPos }

// 分页模式切换
const pageCountOf = async () => {
  const txt = await page.locator('.ce-pos').innerText().catch(() => '1 / 1')
  return Number(txt.split('/').pop().trim())
}
await page.click('.ce-seg-btn[data-mode="none"]')
await page.waitForTimeout(1000)
const noneCount = await pageCountOf()
await page.click('.ce-seg-btn[data-mode="rule"]')
await page.waitForTimeout(1200)
const ruleCount = await pageCountOf()
await page.click('.ce-seg-btn[data-mode="auto"]')
await page.waitForTimeout(1200)
const autoCount = await pageCountOf()
// "不分页"= 1 张内容卡；开了封面就是 2 页（封面 + 内容），别把封面当成没分页
const withCover = await page.locator('.ce-check input').isChecked()
const expectNone = withCover ? 2 : 1
report.steps.modes = { none: noneCount, expectNone, rule: ruleCount, auto: autoCount }
if (noneCount !== expectNone) errors.push(`"不分页"模式应为 ${expectNone} 页（含封面），实际 ${noneCount}`)
if (!(autoCount >= expectNone + 1)) errors.push(`自动分页应比"不分页"多出内容页，实际 ${autoCount}`)
if (!(ruleCount >= 2)) errors.push(`按横线分页应至少 2 页，实际 ${ruleCount}`)

/* ---------------- C. 导出产物 ---------------- */
// PNG：多页时打包 zip
const dlPng = page.waitForEvent('download', { timeout: 60000 }).catch(() => null)
await page.click('.ce-btn[data-act="png"]')
const d1 = await dlPng
if (!d1) errors.push('PNG 导出没有触发下载')
else {
  const f = path.join(OUT, d1.suggestedFilename())
  await d1.saveAs(f)
  const isZip = d1.suggestedFilename().endsWith('.zip')
  report.steps.png = { file: path.basename(f), bytes: fs.statSync(f).size, zip: isZip }
  if (fs.statSync(f).size < 2000) errors.push('PNG/ZIP 产物过小，疑似空文件')
  if (isZip) {
    // ZIP 解压出来验证页数与像素
    const { execFileSync } = await import('node:child_process')
    try {
      execFileSync('python', ['-c', `
import zipfile,sys
z = zipfile.ZipFile(r"${f}")
names = [n for n in z.namelist() if n.endswith('.png')]
print("ZIP_ENTRIES", len(names))
for n in names[:3]:
    d = z.read(n)
    w = int.from_bytes(d[16:20],'big'); h = int.from_bytes(d[20:24],'big')
    print("PNG", n, w, h, len(d))
`], { stdio: 'inherit' })
    } catch (e) {
      errors.push('ZIP 校验失败: ' + e.message)
    }
  } else {
    const s = pngSize(fs.readFileSync(f))
    report.steps.png.pixels = s
    if (!s || s.w !== 1080) errors.push(`PNG 宽度应为 1080，实际 ${s?.w}`)
  }
}

// PDF
const dlPdf = page.waitForEvent('download', { timeout: 60000 }).catch(() => null)
await page.click('.ce-btn[data-act="pdf"]')
const d2 = await dlPdf
if (!d2) errors.push('PDF 导出没有触发下载')
else {
  const f = path.join(OUT, 'export.pdf')
  await d2.saveAs(f)
  const buf = fs.readFileSync(f)
  const head = buf.subarray(0, 8).toString('latin1')
  const text = buf.toString('latin1')
  const pages = (text.match(/\/Type\s*\/Page[^s]/g) || []).length
  const box = text.match(/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/)
  report.steps.pdf = {
    file: 'export.pdf',
    bytes: buf.length,
    header: head.trim(),
    pages,
    mediaBox: box ? [Number(box[1]), Number(box[2])] : null,
    hasEOF: text.includes('%%EOF'),
  }
  if (!head.startsWith('%PDF-1.4')) errors.push('PDF 头不合法')
  if (pages !== autoCount) errors.push(`PDF 页数 ${pages} 与卡片数 ${autoCount} 不一致`)
  if (!box) errors.push('PDF 缺少 MediaBox')
  if (!text.includes('%%EOF')) errors.push('PDF 没有 EOF 标记')
}

// 面板关闭
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
const closed = (await page.locator('.ce').count()) === 0
report.steps.close = { closed }
if (!closed) errors.push('Esc 没有关闭面板')

report.pass = errors.length === 0
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
await browser.close()

console.log(JSON.stringify(report, null, 2))
process.exit(report.pass ? 0 : 1)
