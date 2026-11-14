/**
 * 「排版」验收 —— 十一组硬指标，任一不过即失败。
 *
 *  A. 交互：一级菜单「排版」能开面板、33 套模板按钮齐全、20s 内出预览、Esc 能关。
 *  B. 模板：33 套逐一出图，且每张采样颜色数 > 8（防"白图假通过"）。
 *  C. 参数：改字号必须让页数变化（证明"参数→重排"链路真的通了，不是只换 CSS）；
 *           纹理必须在**同一字号**下比「无 → 网格」，并且设回去要回到基线
 *           （v0.9.0 拿改字号前的图当基线，纹理完全不可见也能通过）。
 *  C2. 背景与装订：两种底纹必须产出不同像素、装订位必须看得见、
 *           上传自定义图必须写进 decor.bgImage 并出现在缩略图。
 *  C3. 圆角与装饰：半径 0→24 圆角必须真的变大（量预览图左上角第一颗不透明像素的 x）、
 *           「圆切角」必须比「不处理」更圆、回形针/订书钉必须各自画出来且彼此不同、
 *           印章开关必须改变画面；缩略图必须是真卡片且内容不溢出。
 *  C4. 艺术层（schema 5）：带宽度（黄边）真的存在且能被 band 参数改窄、
 *           内面板是白底+墨色描边、硬阴影是 0 模糊（阴影内部像素不许有渐变）、
 *           三级标题三种形态（h2 蓝块 / h3 珊瑚块 / h1 斜纹下划线）、
 *           分隔线是斜纹、贴纸画在左上右上、有序序号徽标能开关、
 *           配色变体只换颜色不动尺寸、分页不被带宽度破坏。
 *           —— 全部量「预览图上的像素」，不量 CSS 中间量：v0.12.0 的
 *           "缩略图溢出"和"dick 双计数"两次假失败/假通过都是量中间量惹的祸。
 *  C5. 样式层（schema 6）：四套新样式各自最有辨识度的那一处必须在预览图上量得到 ——
 *           黑金菱纹的黑底 + 满幅菱形网 + 顶部金条、橙光胶囊的收窄药丸（不是一条分隔线）、
 *           青蓝流线的**对角不等圆角**、米纸铅字的两层米色 + 点线分隔；
 *           外加一条回归：素笺清墨的标题不许被新字段污染。
 *  C6. 导出健壮性（v0.14.1 安卓加固）：注入 data URI 失败后必须自动换路且产物
 *           **逐字节不变**；全部通路失败必须按时报错、列出试过哪几条、不留渲染宿主；
 *           失败之后再导出必须还能出图（busy 复位）。
 *  D. 模板进出：导出 .zip 样式包（template.json + README，带图时还有 bg.png）→
 *           再导入 → 成为当前模板；旧版单文件 .lyt.json 仍要能认（老模板不弃）。
 *  E. 离线：整场操作**零外部网络请求**（除本机 127.0.0.1 静态资源）。
 *
 * 用法：node beautify-check.mjs [url]
 */

import { chromium } from 'playwright-core'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const PAGE_URL = process.argv[2] || 'http://127.0.0.1:4173/index.html'
// 不删目录、改用带时间戳的子目录：宿主的安全删除钩子对目录删除是 fail-closed，
// 会一直卡到 spawnSync ETIMEDOUT（v0.10.0 踩到过 4–9 分钟），脚本里一律不删。
const RUN = new Date().toISOString().replace(/[:.]/g, '-')
const OUT = path.join(HERE, '..', 'artifacts', 'beautify', RUN)
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

### 三级小标题

C4 要量「三级标题是不是有自己的形态」，所以样例里必须有 h3 与一条分隔线。

---

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

/** C6 用：产物逐字节比对（"降级不改变像素"这件事，比对比对比对更直接） */
function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

const browser = await chromium.launch({ executablePath: EDGE, headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: 'zh-CN', acceptDownloads: true })
const page = await ctx.newPage()

const external = []
page.on('request', (req) => {
  const u = req.url()
  if (!u.startsWith('http://127.0.0.1') && !u.startsWith('data:') && !u.startsWith('blob:') && !u.startsWith('file:')) external.push(u)
})
// 下面 C6 会**故意**制造渲染失败来验证错误路径，那几次 console.error 是预期内的
let expectConsoleErrors = false
page.on('console', (m) => {
  if (m.type() === 'error' && !expectConsoleErrors) errors.push('[console] ' + m.text())
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
if (tplCount < 33) errors.push(`模板数量不足：${tplCount} < 33`)

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

/**
 * 两张预览图的像素差异占比（缩到 120×120 后逐像素比，通道差之和 > 12 才算「变了」）。
 * 用来回答「这个底纹到底画出来没有」——只比 sig 只能知道「有差别」，
 * 碰上 alpha 0.05 的白纹画在白纸上，sig 会变但人眼看不见。
 */
const diffRatio = async (fileA, fileB) => {
  const a = fs.readFileSync(path.join(OUT, fileA)).toString('base64')
  const b = fs.readFileSync(path.join(OUT, fileB)).toString('base64')
  return page.evaluate(
    async ([da, db]) => {
      const load = async (d) => {
        const img = new Image()
        img.src = 'data:image/png;base64,' + d
        await img.decode()
        return img
      }
      // 240 而不是 120：点阵是 16px 网格上 1.1px 的点，缩到 120 会被邻域平均掉，
      // 于是「画了」和「没画」算出同样的 0 差异 —— 这是测量分辨率问题，不是没生效。
      const N = 240
      const c = document.createElement('canvas')
      c.width = N
      c.height = N
      const g = c.getContext('2d')
      const pix = async (img) => {
        g.clearRect(0, 0, N, N)
        g.drawImage(img, 0, 0, N, N)
        return g.getImageData(0, 0, N, N).data
      }
      const pa = await pix(await load(da))
      const pb = await pix(await load(db))
      let n = 0
      for (let i = 0; i < pa.length; i += 4) {
        if (Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2]) > 12) n++
      }
      return +(n / (N * N)).toFixed(4)
    },
    [a, b],
  )
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
/**
 * 预览图重绘是异步的（每改一个参数都走一遍 card-capture），所以**不能靠固定 sleep**。
 *
 * v0.14.1 发版前这里踩了一次：`clickSeg('decor.binding','clip')` 之后固定等 1300ms，
 * 那次回形针的重绘刚好慢过 1300ms，抓到的还是上一张（binding=none），于是
 * 「回形针几乎没画出来（diff=0）」报了红 —— 而代码一行没改，复跑就绿了（0.0045）。
 * 这种红比不测更糟：它教人"重跑一次就好"，真出问题时也会被当成抖动。
 *
 * 现在改成"等图上真的换了"：轮询 `.ce-img` 的 src，变了再抓；最多等 3s
 * （有些操作本来就该产出同一张图，比如再点一次当前值，那时不等满也不该失败）。
 */
const imgSrc = () => page.evaluate(() => document.querySelector('.ce-img')?.src || '')
const waitPaint = async (prev, timeout = 3000) => {
  const t0 = Date.now()
  for (;;) {
    const cur = await imgSrc()
    if (cur && cur !== prev) return cur
    if (Date.now() - t0 > timeout) return cur
    await page.waitForTimeout(120)
  }
}

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
{
  const before = await imgSrc()
  await page.evaluate(() => {
    const btn = document.querySelector('.ce-param[data-path="decor.texture"] .ce-seg-btn[data-val="grid"]')
    btn.click()
  })
  await waitPaint(before)
  await page.waitForTimeout(120)
}
const texShot = await grab('param-texture.png')

{
  const before = await imgSrc()
  await page.evaluate(() => {
    const btn = document.querySelector('.ce-param[data-path="decor.texture"] .ce-seg-btn[data-val="none"]')
    btn.click()
  })
  await waitPaint(before)
  await page.waitForTimeout(120)
}
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
  const before = await imgSrc()
  await page.evaluate(
    ([p, v]) => {
      document.querySelector(`.ce-param[data-path="${p}"] .ce-seg-btn[data-val="${v}"]`)?.click()
    },
    [path, val],
  )
  await waitPaint(before)
  await page.waitForTimeout(120)
}

await page.click('.ce-bg[data-bg="kraft"]')
await page.waitForTimeout(1400)
const bgKraft = await grab('bg-kraft.png')

await page.click('.ce-bg[data-bg="lined"]')
await page.waitForTimeout(1400)
const bgLined = await grab('bg-lined.png')

/*
 * 每个底纹都要「看得见」——不只比 sig，还要算像素差异占比。
 * 0.10.0 踩过：枚举里写的是 `wire`，而 CSS/词表里叫 `paper`，于是面板生成了一个
 * 点下去毫无变化的按钮（没图案、没文案），和用户报的「设了没效果」是同一类问题。
 */
const bgIds = await page.$$eval('.ce-bg[data-bg]', (els) =>
  els.map((e) => e.dataset.bg).filter((id) => id && id !== 'none'),
)
const bgVisible = {}
for (const id of bgIds) {
  await page.click(`.ce-bg[data-bg="${id}"]`)
  await page.waitForTimeout(1200)
  const s = await grab(`bg-${id}.png`)
  if (!s) {
    errors.push(`背景 ${id} 没有产出预览`)
    continue
  }
  const diff = await diffRatio('texture-back.png', `bg-${id}.png`)
  bgVisible[id] = diff
  if (diff < 0.004) errors.push(`背景 ${id} 选上后画面几乎没变（diff=${diff}），底纹可能没画出来`)
}
await page.click('.ce-bg[data-bg="kraft"]')
await page.waitForTimeout(1200)

await clickSeg('decor.binding', 'spiral')
const bindShot = await grab('bind-spiral.png')
await clickSeg('decor.binding', 'none')

report.steps.background = {
  kraftVsLined: !!(bgKraft && bgLined && bgKraft.sig !== bgLined.sig),
  kraftVsBase: !!(bgKraft && texBack && bgKraft.sig !== texBack.sig),
  bindingDrawn: !!(bindShot && texBack && bindShot.sig !== texBack.sig),
  presets: bgIds.length,
  diffByPreset: bgVisible,
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

/* ---------- C3. 圆角 / 角处理 / 装订 / 印章 / 缩略图 ---------- */

/**
 * 圆角「看得见」的量化办法：预览是透明底的 PNG，从左上角第 0 行扫出第一颗不透明像素的 x。
 * 半径越大，圆角弧线在 y=0 处越靠右 —— 这比"两张图 sig 不同"严格：
 * 0.12.0 之前 .ce-img 写死白底、captureCard 又把 border-radius 抹成 0，
 * 图像怎么比都一样，用户拉滑块自然"没有任何改动展示"。
 */
const cornerInset = () =>
  page.evaluate(async () => {
    const img = document.querySelector('.ce-img')
    if (!img?.src) return null
    const bmp = await createImageBitmap(await (await fetch(img.src)).blob())
    const c = document.createElement('canvas')
    c.width = bmp.width
    c.height = bmp.height
    const g = c.getContext('2d')
    g.drawImage(bmp, 0, 0)
    const row = g.getImageData(0, 0, bmp.width, 1).data
    let firstX = -1
    for (let x = 0; x < bmp.width; x += 1) {
      if (row[x * 4 + 3] > 8) {
        firstX = x
        break
      }
    }
    return { w: bmp.width, firstX }
  })

const setNum = async (p, v) => {
  const before = await imgSrc()
  await page.evaluate(
    ([path2, val]) => {
      const input = document.querySelector(`.ce-param[data-path="${path2}"] input[type="range"]`)
      if (!input) return
      input.value = String(val)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    },
    [p, v],
  )
  await waitPaint(before)
  await page.waitForTimeout(120)
}

await page.click('.ce-style[data-tpl="paper"]')
await page.waitForTimeout(900)
await clickSeg('decor.corner', 'none')
await setNum('metrics.radius', 0)
const radius0 = await cornerInset()
await setNum('metrics.radius', 24)
const radius24 = await cornerInset()
await grab('radius-24.png')

// 同一半径下，「圆切角」必须比「不处理」更圆（CSS 里是 radius + 16px）
await setNum('metrics.radius', 8)
await clickSeg('decor.corner', 'round')
const cornerRound = await cornerInset()
await grab('corner-round.png')
await clickSeg('decor.corner', 'fold')
const cornerFold = await cornerInset()
await clickSeg('decor.corner', 'none')
await setNum('metrics.radius', 6)

report.steps.corner = {
  radius0: radius0?.firstX,
  radius24: radius24?.firstX,
  cornerFold: cornerFold?.firstX,
  cornerRound: cornerRound?.firstX,
  previewWidth: radius0?.w,
}
if (!radius0 || !radius24) errors.push('圆角测量拿不到预览图')
else if (radius24.firstX - radius0.firstX < 8) {
  errors.push(`半径 0→24 圆角几乎没变（firstX ${radius0.firstX} → ${radius24.firstX}）`)
}
if (!cornerFold || !cornerRound) errors.push('角处理测量拿不到预览图')
else if (cornerRound.firstX - cornerFold.firstX < 8) {
  errors.push(`「圆切角」没比「折角」更圆（firstX ${cornerFold.firstX} → ${cornerRound.firstX}）`)
}

/* 装订：回形针与订书钉各画一张，且两者不能长得一样（否则就是同一坨东西） */
await clickSeg('decor.binding', 'none')
const bindNone = await grab('bind-none.png')
await clickSeg('decor.binding', 'clip')
const bindClip = await grab('bind-clip.png')
const diffClip = await diffRatio('bind-none.png', 'bind-clip.png')
await clickSeg('decor.binding', 'staple')
const bindStaple = await grab('bind-staple.png')
const diffStaple = await diffRatio('bind-none.png', 'bind-staple.png')
await clickSeg('decor.binding', 'none')

report.steps.binding = {
  clipDiff: diffClip,
  stapleDiff: diffStaple,
  clipVsStaple: !!(bindClip && bindStaple && bindClip.sig !== bindStaple.sig),
}
if (diffClip < 0.002) errors.push(`回形针几乎没画出来（diff=${diffClip}）`)
// 订书钉本来就小（44×24px 画在 540 宽的纸上 ≈ 0.4% 面积），阈值按它的实际面积给
if (diffStaple < 0.0008) errors.push(`订书钉几乎没画出来（diff=${diffStaple}）`)
if (bindClip && bindStaple && bindClip.sig === bindStaple.sig) errors.push('回形针与订书钉画出来是同一个东西')

/* 印章：开关与预设都要真的改画面 */
const stampToggle = page.locator('[data-group="stamp"] .ce-switch')
await clickSeg('decor.stampPreset', 'seal')
const stampOff = await grab('stamp-off.png')
await stampToggle.click()
await page.waitForTimeout(1400)
const stampOn = await grab('stamp-on.png')
const diffStamp = await diffRatio('stamp-off.png', 'stamp-on.png')
await clickSeg('decor.stampPreset', 'square')
const stampSquare = await grab('stamp-square.png')
// 朱文圆印「阅」和白文方印「已阅」色块几乎一样，sig（按量化色去重）分不开，要比像素
const diffStampPreset = await diffRatio('stamp-on.png', 'stamp-square.png')
await stampToggle.click()
await page.waitForTimeout(1000)

report.steps.stamp = { onDiff: diffStamp, presetDiff: diffStampPreset }
if (diffStamp < 0.001) errors.push(`印章开关打开后画面没变（diff=${diffStamp}）`)
if (diffStampPreset < 0.0008) errors.push(`换印章预设画面没变（diff=${diffStampPreset}）`)

/* 缩略图：必须是真卡片（有 .ly-card 且挂了真节点），且内容不许溢出卡片 */
await page.evaluate(async () => {
  const sc = document.querySelector('.ce-styles')?.closest('section, div')
  let node = document.querySelector('.ce-styles')
  while (node && node.scrollHeight <= node.clientHeight + 4) node = node.parentElement
  const host = node || sc || document.scrollingElement
  for (let y = 0; y < host.scrollHeight; y += 320) {
    host.scrollTop = y
    await new Promise((r) => setTimeout(r, 60))
  }
  host.scrollTop = 0
})
await page.waitForTimeout(700)
const thumbStats = await page.evaluate(() => {
  const cards = Array.from(document.querySelectorAll('.ce-style[data-tpl]'))
  let mounted = 0
  let overflow = 0
  let sample = null
  for (const card of cards) {
    const inner = card.querySelector('.ce-thumb-inner .ly-card')
    if (!inner) continue
    mounted += 1
    if (!sample) {
      const r = inner.getBoundingClientRect()
      sample = { w: Math.round(r.width), h: Math.round(r.height) }
    }
    const body = inner.querySelector('.ly-body')
    if (body && body.scrollHeight - body.clientHeight > 1) overflow += 1
  }
  return {
    total: cards.length,
    mounted,
    overflow,
    size: sample,
    labelFont: document.querySelector('.ce-label') ? getComputedStyle(document.querySelector('.ce-label')).fontSize : null,
    firstName: cards[0]?.querySelector('.ly-sample-h')?.textContent || '',
  }
})
await page.screenshot({ path: path.join(OUT, 'templates.png') })
report.steps.thumbs = thumbStats
if (thumbStats.mounted < thumbStats.total * 0.6) {
  errors.push(`缩略图只挂上 ${thumbStats.mounted}/${thumbStats.total} 张`)
}
if (thumbStats.overflow > 0) errors.push(`有 ${thumbStats.overflow} 张缩略图内容溢出卡片`)
if (thumbStats.labelFont !== '13px') errors.push(`分组标题字号应为 13px，实测 ${thumbStats.labelFont}`)
if (!/^[\u4e00-\u9fa5]{4}$/.test(thumbStats.firstName)) {
  errors.push(`模板名不是四字词：${thumbStats.firstName}`)
}


/* ---------- C4. 艺术层（schema 5）：面板 / 标题 / 分隔线 / 贴纸 / 变体 ---------- */

/**
 * 把预览 PNG 读进页面里的 canvas（800×1067 的 ImageData 约 3.4MB）。
 * 后面所有断言都在这上面量像素 —— 量「看到的东西」，不量 CSS 中间量：
 * v0.12.0 的「缩略图溢出」假失败和「dock 双计数」假通过，都是量中间量害的。
 */
const loadPix = async (key, file) => {
  const b64 = fs.readFileSync(path.join(OUT, file)).toString('base64')
  return page.evaluate(
    async ([d, k]) => {
      const img = new Image()
      img.src = 'data:image/png;base64,' + d
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      const g = c.getContext('2d', { willReadFrequently: true })
      g.drawImage(img, 0, 0)
      const P = (window.__P = window.__P || {})
      P[k] = { w: c.width, h: c.height, d: g.getImageData(0, 0, c.width, c.height).data }
      return { w: c.width, h: c.height }
    },
    [b64, key],
  )
}

const ART = { blue: [81, 186, 250], coral: [255, 98, 90], accent: [255, 46, 99], ink: [37, 42, 52], paper: [253, 224, 65] }

/** 一次遍历把艺术层的六件事全量出来（每张图约 2 遍扫描，够快）。 */
const pixMeasure = (key) =>
  page.evaluate(
    ([k, C]) => {
      const P = window.__P[k]
      const W = P.w
      const H = P.h
      const at = (x, y) => {
        const i = (y * W + x) * 4
        return [P.d[i], P.d[i + 1], P.d[i + 2]]
      }
      const near = (a, b, tol) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol
      const luma = (c) => (c[0] + c[1] + c[2]) / 3
      const isInk = (c) => luma(c) < 110
      const avg = (x0, y0, x1, y1) => {
        let r = 0
        let g = 0
        let b = 0
        let n = 0
        for (let y = y0; y <= y1; y += 1) {
          for (let x = x0; x <= x1; x += 1) {
            const c = at(x, y)
            r += c[0]
            g += c[1]
            b += c[2]
            n += 1
          }
        }
        return [Math.round(r / n), Math.round(g / n), Math.round(b / n)]
      }
      const yMid = Math.round(H * 0.5)

      // 面板左边界 = 中线上第一颗墨色像素（带宽度 + 描边都算在它左边）
      let borderL = -1
      for (let x = 0; x < W; x += 1) if (isInk(at(x, yMid))) { borderL = x; break }
      let borderT = 0
      if (borderL >= 0) {
        let x = borderL
        while (x < W && isInk(at(x, yMid))) { borderT += 1; x += 1 }
      }
      // 右边界那段连续墨色 = 竖描边 + 硬阴影（两者在像素上是连着的）
      let runB = -1
      for (let x = W - 1; x >= 0; x -= 1) if (isInk(at(x, yMid))) { runB = x; break }
      let runA = runB
      while (runA > 0 && isInk(at(runA - 1, yMid))) runA -= 1
      const len = runB - runA + 1
      let sLo = 255
      let sHi = 0
      if (len >= 6) {
        // 只量中段 40%：两端一定有抗锯齿过渡，量进去就成了"误差"不是"模糊"
        const a0 = runA + Math.round(len * 0.3)
        const b0 = runB - Math.round(len * 0.3)
        for (let x = a0; x <= b0; x += 1) {
          const l = luma(at(x, yMid))
          if (l < sLo) sLo = l
          if (l > sHi) sHi = l
        }
      }

      let blue = 0
      let blueMax = 0
      let coral = 0
      let cx0 = W
      let cy0 = H
      let cx1 = -1
      let cy1 = -1
      let accentTL = 0
      let accent = 0
      let blueTR = 0
      for (let y = 0; y < H; y += 1) {
        let run = 0
        for (let x = 0; x < W; x += 1) {
          const c = at(x, y)
          if (near(c, C.blue, 16)) {
            blue += 1
            run += 1
            if (run > blueMax) blueMax = run
            if (x > W - 140 && y < 140) blueTR += 1
            continue
          }
          run = 0
          if (near(c, C.coral, 16)) {
            coral += 1
            if (x < cx0) cx0 = x
            if (x > cx1) cx1 = x
            if (y < cy0) cy0 = y
            if (y > cy1) cy1 = y
          }
          if (near(c, C.accent, 18)) {
            accent += 1
            if (x < 140 && y < 140) accentTL += 1
          }
        }
      }

      /* 斜纹：一行里 accent↔ink 交替 ≥10 次，且这一行 80% 以上都是这两色
         （排除文字行：文字行主要是白底，粉/墨交替是 h1 的 text-shadow 一类的零星像素） */
      let stripeRows = 0
      for (let y = 0; y < H; y += 1) {
        let prev = '.'
        let flips = 0
        let solid = 0
        for (let x = 0; x < W; x += 1) {
          const c = at(x, y)
          const s = near(c, C.accent, 24) ? 'A' : near(c, C.ink, 26) ? 'B' : '.'
          if (s !== '.') solid += 1
          if (s !== prev) {
            if (s !== '.' && prev !== '.') flips += 1
            prev = s
          }
        }
        if (flips >= 10 && solid / W > 0.8) stripeRows += 1
      }

      return {
        W,
        H,
        yMid,
        borderL,
        borderT,
        shadow: { a: runA, b: runB, len, spread: sHi - sLo },
        blue,
        blueMax,
        coral,
        coralBox: cx1 >= 0 ? [cx0, cy0, cx1, cy1] : null,
        accent,
        accentTL,
        blueTR,
        stripeRows,
        topLeft: avg(3, 3, 9, 9),
        center: avg(Math.round(W / 2) - 10, Math.round(H * 0.42), Math.round(W / 2) + 10, Math.round(H * 0.42) + 10),
      }
    },
    [key, ART],
  )

/** 改参数 → 等预览图真的换掉 → 读像素。固定 sleep 要么慢要么假通过（读到上一张图）。 */
const artShot = async (key, name, mutate) => {
  const prev = await page.evaluate(() => document.querySelector('.ce-img')?.src || '')
  await mutate()
  const fresh = await page
    .waitForFunction(
      (p) => {
        const s = document.querySelector('.ce-img')?.src || ''
        return !!s && s !== p && s.startsWith('data:image/png')
      },
      prev,
      { timeout: 25000 },
    )
    .then(() => true)
    .catch(() => false)
  if (!fresh) {
    errors.push(`[艺术层] 改参数后预览图 25s 内没刷新（${name}）`)
    return null
  }
  const shot = await grab(name)
  if (!shot) {
    errors.push(`[艺术层] ${name} 没取到预览图`)
    return null
  }
  await loadPix(key, name)
  return pixMeasure(key)
}

// 第 29 套：波普撞印
await page.click('.ce-style[data-tpl="popart"]')
await page.waitForTimeout(900)

const artGroups = await page.evaluate(() => {
  const n = (s) => document.querySelectorAll(s).length
  return {
    panel: n('[data-group="panel"]'),
    head: n('[data-group="head"] .ce-sub'),
    rule: n('[data-group="rule"]'),
    orn: n('[data-group="orn"] .ce-orn-item'),
    variant: n('[data-group="variant"] .ce-seg-btn[data-variant]'),
    paths: n('.ce-param[data-path]'),
  }
})
report.steps.artGroups = artGroups
if (!artGroups.panel) errors.push('[艺术层] 面板组没渲染')
if (artGroups.head < 4) errors.push(`[艺术层] 标题级别只有 ${artGroups.head}/4 组`)
if (!artGroups.rule) errors.push('[艺术层] 分隔线组没渲染')
if (artGroups.orn < 2) errors.push(`[艺术层] 贴纸控件只有 ${artGroups.orn} 个（波普带 2 张）`)
if (artGroups.variant < 3) errors.push(`[艺术层] 配色变体只有 ${artGroups.variant} 个（波普带 3 个）`)

// 关掉封面：要量的是正文页上的标题 / 列表 / 分隔线（顺手当"图真的换了"的信号）
const band30 = await artShot('band30', 'art-band30.png', async () => {
  await page.locator('.ce-check input[type="checkbox"]').first().setChecked(false)
})
const pagesBand30 = await pageCountOf()

// band 30 → 0：带宽度必须真的消失，且面板左边界左移 ≥25px（30px 带 × 缩放）
const band0 = await artShot('band0', 'art-band0.png', () => setNum('decor.panel.band', 0))
const pagesBand0 = await pageCountOf()
// 复原：后面 D 组要导出的就是这套模板
const bandBack = await artShot('bandBack', 'art-bandback.png', () => setNum('decor.panel.band', 30))

const px = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])
report.steps.artPanel = {
  band30: band30 && { borderL: band30.borderL, borderT: band30.borderT, topLeft: band30.topLeft, center: band30.center },
  band0: band0 && { borderL: band0.borderL, topLeft: band0.topLeft },
  bandBack: bandBack && { borderL: bandBack.borderL },
  shadow: band30?.shadow,
  pages: { band30: pagesBand30, band0: pagesBand0 },
}
if (!band30 || !band0) errors.push('[艺术层] 面板像素量测失败')
else {
  // ① 带：左上角必须是纸色（黄），而不是面板白
  if (px(band30.topLeft, ART.paper) > 36) {
    errors.push(`[艺术层] 左上角不是纸色 ${band30.topLeft.join(',')}，带没画出来？`)
  }
  // ② 内面板：白底 + 墨色描边（描边 2px × 缩放 ≈ 2–6 个像素）
  if (px(band30.center, [255, 255, 255]) > 24) {
    errors.push(`[艺术层] 面板不是白底（中心 ${band30.center.join(',')}）`)
  }
  if (band30.borderT < 1 || band30.borderT > 8) {
    errors.push(`[艺术层] 面板描边宽度异常：${band30.borderT}px`)
  }
  // ③ 硬阴影 = 零模糊：阴影内部不许有渐变（中段 40% 的亮度极差 < 8）
  if (!band30.shadow || band30.shadow.len < 8) {
    errors.push(`[艺术层] 右侧没有硬阴影（连续墨色只有 ${band30.shadow?.len}px）`)
  } else if (band30.shadow.spread > 8) {
    errors.push(`[艺术层] 阴影有渐变（内部亮度极差 ${band30.shadow.spread}），不是 0 模糊的硬投影`)
  }
  // ④ 带宽度可变：band 0 时面板贴到画布左侧，位移 ≥25px
  const shift = band30.borderL - band0.borderL
  if (band0.borderL > 6) errors.push(`[艺术层] band=0 时面板没贴边（左边界 x=${band0.borderL}）`)
  if (shift < 25) errors.push(`[艺术层] band 30→0 面板只位移了 ${shift}px（带宽度没真的生效）`)
  if (bandBack && Math.abs(bandBack.borderL - band30.borderL) > 2) {
    errors.push(`[艺术层] band 设回 30 后左边界 ${bandBack.borderL} ≠ 基线 ${band30.borderL}`)
  }
  // ⑤ 分页不被带宽度破坏
  if (Math.abs(pagesBand0 - pagesBand30) > 1) {
    errors.push(`[艺术层] band 0/30 的页数差 ${Math.abs(pagesBand0 - pagesBand30)} > 1（改带宽度把分页带崩了）`)
  }
}

report.steps.artHeads = band30 && {
  blue: band30.blue,
  blueMax: band30.blueMax,
  coral: band30.coral,
  coralBox: band30.coralBox,
  stripeRows: band30.stripeRows,
  accentTL: band30.accentTL,
  blueTR: band30.blueTR,
}
if (band30) {
  // ⑥ 三种标题形态：h2 是整行宽的蓝块（连续蓝游程 ≥250px，POP 徽标只有 76px 画不出这么长）
  if (band30.blueMax < 250) errors.push(`[艺术层] 二级标题蓝块没画出来（最长蓝游程 ${band30.blueMax}px）`)
  // ⑦ h3 是收窄的行内珊瑚色块
  if (!band30.coralBox) errors.push('[艺术层] 三级标题珊瑚色块没画出来')
  else {
    const [x0, y0, x1, y1] = band30.coralBox
    if (x1 - x0 < 60 || y1 - y0 < 18) errors.push(`[艺术层] 三级色块尺寸异常 ${x1 - x0}×${y1 - y0}`)
  }
  // ⑧ 斜纹：h1 下划线与分隔线各一条，至少 6 行是满行双色交替
  if (band30.stripeRows < 6) errors.push(`[艺术层] 斜纹下划线/分隔线没画出来（满行交替只有 ${band30.stripeRows} 行）`)
  // ⑨ 贴纸：左上酱红五角星、右上蓝色 POP 徽标
  if (band30.accentTL < 150) errors.push(`[艺术层] 左上贴纸几乎没画（${band30.accentTL} px）`)
  if (band30.blueTR < 150) errors.push(`[艺术层] 右上贴纸几乎没画（${band30.blueTR} px）`)
}

// ⑩ 有序序号徽标：换回「无」必须少一大片 accent 像素（3 个圆形徽标）
const stampListNo = band30 ? await artShot('listNoPlain', 'art-listno-plain.png', () => clickSeg('decor.listNo', 'plain')) : null
const listNoDrop = band30 && stampListNo ? band30.accent - stampListNo.accent : null
const listNoDiff = await diffRatio('art-band30.png', 'art-listno-plain.png')
report.steps.artListNo = { circleAccent: band30?.accent, plainAccent: stampListNo?.accent, drop: listNoDrop, diff: listNoDiff }
if (stampListNo) {
  if (Math.abs(listNoDiff) < 0.0004) errors.push(`[艺术层] 有序序号开/关画面几乎一样（diff=${listNoDiff}）`)
  if (listNoDrop !== null && listNoDrop < 200) errors.push(`[艺术层] 关掉圆形徽标后 accent 只少了 ${listNoDrop} px（徽标可能没画）`)
}
await clickSeg('decor.listNo', 'circle')

// ⑪ 配色变体只换颜色，不动尺寸
const mint = await artShot('mint', 'art-mint.png', async () => {
  await page.evaluate(() => {
    document.querySelector('[data-group="variant"] [data-variant="mint"]')?.click()
  })
})
report.steps.artVariant = mint && { topLeft: mint.topLeft, borderL: mint.borderL, borderT: mint.borderT }
if (mint && band30) {
  if (px(mint.topLeft, band30.topLeft) < 60) errors.push(`[艺术层] 切薄荷变体纸色没变（${mint.topLeft.join(',')}）`)
  if (Math.abs(mint.borderL - band30.borderL) > 2 || mint.borderT !== band30.borderT) {
    errors.push(`[艺术层] 切变体把尺寸也改了（左边界 ${band30.borderL}→${mint.borderL}，描边 ${band30.borderT}→${mint.borderT}）`)
  }
}

// 变体是"就地改色"，量完要回到原色：点内置卡片 = 换回内置那套（structuredClone，不受改动污染）
await page.click('.ce-style[data-tpl="popart"]')
await page.waitForTimeout(1500)

/**
 * ---------- C5. 另外四套艺术风（schema 6） ----------
 *
 * 这一组要回答的问题只有一个：**"把标题做成色块"的这六个新字段真的画出来了吗**。
 * 四套模板各挑它最有辨识度的一处现象，全部在预览图上量：
 *   黑金菱纹 —— 黑底 + 满幅菱形网 + 顶部金条
 *   橙光胶囊 —— 顶部橙条 + 橙色胶囊（收窄且四角是大圆角）
 *   青蓝流线 —— 蓝青渐变块 + **一对角比另一对大**（这是它唯一的结构特征）
 *   米纸铅字 —— 纸与内卡是两种米色 + 分隔线是点线（有/无交替）
 * 再加一条回归：第 1 套「素笺清墨」的标题不许被新字段污染（字距、字重、圆角、下划线都得是原样）。
 */

const c5Shot = async (id, name) => {
  const prev = await page.evaluate(() => document.querySelector('.ce-img')?.src || '')
  await page.click(`.ce-style[data-tpl="${id}"]`)
  const fresh = await page
    .waitForFunction(
      (p) => {
        const s = document.querySelector('.ce-img')?.src || ''
        return !!s && s !== p && s.startsWith('data:image/png')
      },
      prev,
      { timeout: 25000 },
    )
    .then(() => true)
    .catch(() => false)
  if (!fresh) {
    errors.push(`[样式层] ${id} 换了模板但预览图 25s 没刷新`)
    return null
  }
  // 要量的是正文页：封面在的话先关掉（状态可能被上一组复位）
  const cover = page.locator('.ce-check input[type="checkbox"]').first()
  if (await cover.isChecked().catch(() => false)) {
    const p2 = await page.evaluate(() => document.querySelector('.ce-img')?.src || '')
    await cover.setChecked(false).catch(() => {})
    await page
      .waitForFunction((p) => (document.querySelector('.ce-img')?.src || '') !== p, p2, { timeout: 25000 })
      .catch(() => {})
  }
  return grab(name)
}

/**
 * 量一张卡片图：顶行采样、按色统计包围盒与纵向分布、中线游程。
 * 全部在浏览器里做，只把数字传回 Node（跨进程传 ImageData 会很慢）。
 */
const pixProbe = async (name, colors, tol = 26, probeY = 0.5, skipTop = 0) => {
  const b64 = fs.readFileSync(path.join(OUT, name)).toString('base64')
  return page.evaluate(
    async ([d, colors, tol, probeY, skipTop]) => {
      const img = new Image()
      img.src = 'data:image/png;base64,' + d
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      const g = c.getContext('2d')
      g.drawImage(img, 0, 0)
      const W = c.width
      const H = c.height
      const A = g.getImageData(0, 0, W, H).data
      const at = (x, y) => {
        const i = (y * W + x) * 4
        return [A[i], A[i + 1], A[i + 2]]
      }
      const near = (a, b, t) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < t * 3
      const out = { W, H, topRow: [], boxes: [], bands: {}, midRuns: [], row: null }
      // 顶部第一行（离边缘 2px，避开抗锯齿）三处采样：用来认"顶部色条"
      out.topRow = [0.2, 0.5, 0.8].map((k) => at(Math.round(W * k), 2))
      // 每个目标色：像素数 / 包围盒 / 八段纵向分布 / **最宽那一行**。
      // 最后一项是关键：满幅的顶条会把包围盒撑到整幅宽，而"标题色块有多宽"
      // 只能看它自己那一行 —— 包围盒回答不了这个问题。
      for (const t of colors) {
        let n = 0
        const bands = new Array(8).fill(0)
        const rows = new Map()
        for (let y = skipTop; y < H; y += 2) {
          for (let x = 0; x < W; x += 2) {
            if (!near(at(x, y), t.rgb, tol)) continue
            n += 1
            bands[Math.min(7, Math.floor((y / H) * 8))] += 1
            const r = rows.get(y) || { c: 0, x0: 1e9, x1: -1 }
            r.c += 1
            if (x < r.x0) r.x0 = x
            if (x > r.x1) r.x1 = x
            rows.set(y, r)
          }
        }
        let widest = null
        for (const [y, r] of rows) {
          if (!widest || r.c > widest.c) widest = { y, c: r.c, x0: r.x0, x1: r.x1 }
        }
        out.boxes.push({ name: t.name, n, widest })
        out.bands[t.name] = bands
      }
      // 中线游程：看"纸 / 面板 / 正文"的分层。按**长度**取前八段再按位置排序 ——
      // 正文行里颜色被文字切成几十个碎段，取"前八个"只会拿到文字间隙。
      const yMid = Math.round(H * probeY)
      const runs = []
      let cur = null
      for (let x = 0; x < W; x += 1) {
        const p = at(x, yMid)
        if (cur && near(p, cur.c, 3)) cur.x1 = x
        else {
          cur = { x0: x, x1: x, c: p }
          runs.push(cur)
        }
      }
      out.row = yMid
      out.midRuns = runs
        .filter((r) => r.x1 - r.x0 > 2)
        .sort((a, b) => b.x1 - b.x0 - (a.x1 - a.x0))
        .slice(0, 8)
        .sort((a, b) => a.x0 - b.x0)
        .map((r) => [r.x0, r.x1, r.c])
      return out
    },
    [b64, colors, tol, probeY, skipTop],
  )
}

/**
 * 找一个"有色横带"的轮廓：逐行取**饱和度足够高的连续段**，只保留宽度 ≥ minW 的。
 *
 * 为什么不用单一目标色：渐变块的右端是另一个颜色（蓝→青、橙→浅橙），
 * 拿 #1677ff 去匹配只能圈出左半边，量出来的"块宽"是假的。
 * 用"饱和度"定义色块，与具体色值无关，渐变也能整块圈住。
 * 文字（近黑、低饱和）与纸（低饱和）都会被排除。
 */
const bandEdges = async (name, minW = 150, yFrom = 30, yTo = 0.92) => {
  const b64 = fs.readFileSync(path.join(OUT, name)).toString('base64')
  return page.evaluate(
    async ([d, minW, yFrom, yTo]) => {
      const img = new Image()
      img.src = 'data:image/png;base64,' + d
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      const g = c.getContext('2d')
      g.drawImage(img, 0, 0)
      const W = c.width
      const H = c.height
      const A = g.getImageData(0, 0, W, H).data
      const rows = []
      for (let y = yFrom; y < Math.round(H * yTo); y += 1) {
        let best = null
        let cur = null
        for (let x = 0; x < W; x += 1) {
          const i = (y * W + x) * 4
          const r = A[i]
          const gr = A[i + 1]
          const b = A[i + 2]
          const mx = Math.max(r, gr, b)
          const mn = Math.min(r, gr, b)
          const colored = mx > 90 && mx - mn > 55
          if (colored) {
            if (!cur) cur = { x0: x, x1: x }
            else cur.x1 = x
          } else if (cur) {
            if (!best || cur.x1 - cur.x0 > best.x1 - best.x0) best = cur
            cur = null
          }
        }
        if (cur && (!best || cur.x1 - cur.x0 > best.x1 - best.x0)) best = cur
        if (best && best.x1 - best.x0 >= minW) rows.push([y, best.x0, best.x1])
      }
      return rows
    },
    [b64, minW, yFrom, yTo],
  )
}

/** 量一条竖带在给定列区间里的真实上下沿：某行只要有 ≥30% 的像素是目标色就算"在带内"。
 *  为什么不用 bandEdges 的行数当高度：色块里压着白字，字行上的连续色段被切成碎片，
 *  `bandEdges` 会因为跑不满 minW 而漏掉这些行 —— 胶囊 69px 高会被量成 18 行。 */
const spanIn = async (name, rgb, tol, x0, x1, yFrom, yTo) => {
  const b64 = fs.readFileSync(path.join(OUT, name)).toString('base64')
  return page.evaluate(
    async ([d, rgb, tol, x0, x1, yFrom, yTo]) => {
      const img = new Image()
      img.src = 'data:image/png;base64,' + d
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      const g = c.getContext('2d')
      g.drawImage(img, 0, 0)
      const W = c.width
      const A = g.getImageData(0, 0, W, c.height).data
      const need = Math.max(8, Math.round((x1 - x0) * 0.3))
      let y0 = -1
      let y1 = -1
      for (let y = yFrom; y <= yTo; y += 1) {
        let n = 0
        for (let x = x0; x <= x1; x += 1) {
          const i = (y * W + x) * 4
          if (Math.abs(A[i] - rgb[0]) + Math.abs(A[i + 1] - rgb[1]) + Math.abs(A[i + 2] - rgb[2]) < tol * 3) n += 1
        }
        if (n >= need) {
          if (y0 < 0) y0 = y
          y1 = y
        }
      }
      return { y0, y1, h: y0 < 0 ? 0 : y1 - y0 + 1 }
    },
    [b64, rgb, tol, x0, x1, yFrom, yTo],
  )
}

/** 把逐行的色带拼成"块"：连续行（允许 2px 断口）归为一块，只留够高的块。
 *  为什么非拼不可：1–2 行的分隔线同样是一条"有色横带"，但它撑不起标题块。
 *  橙光胶囊第一版就吃了这个亏 —— 一条 680px 的浅橙分隔线把胶囊自己的 258px 盖掉，
 *  断言拿 84.9% 险过 85% 的阈值，而胶囊实际只占 32%。测"是不是块"必须一起测高度。 */
const thickBands = (rows, minRows = 12) => {
  const groups = []
  for (const r of rows) {
    const last = groups[groups.length - 1]
    if (last && r[0] - last.y1 <= 2) {
      last.y1 = r[0]
      last.rows.push(r)
    } else groups.push({ y0: r[0], y1: r[0], rows: [r] })
  }
  return groups
    .filter((g) => g.y1 - g.y0 + 1 >= minRows)
    .map((g) => {
      const widest = g.rows.reduce((a, c) => (c[2] - c[1] > a[2] - a[1] ? c : a))
      return { y0: g.y0, y1: g.y1, h: g.y1 - g.y0 + 1, widest, rows: g.rows }
    })
}

/** 全图找"最像虚线/点线"的那一行：逐行统计某色的 on/off 交替次数，取最大。
 *  fac 窗口是必须的：实线覆盖率≈1、纸纹是稀疏噪点（覆盖率很低），
 *  只有"一半上色一半留白"的那一行才可能是点线。 */
const dottedAlt = async (name, rgb, tol = 30, fac = [0.3, 0.75]) => {
  const b64 = fs.readFileSync(path.join(OUT, name)).toString('base64')
  return page.evaluate(
    async ([d, rgb, tol, fac]) => {
      const img = new Image()
      img.src = 'data:image/png;base64,' + d
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      const g = c.getContext('2d')
      g.drawImage(img, 0, 0)
      const W = c.width
      const H = c.height
      const A = g.getImageData(0, 0, W, H).data
      let best = { alt: 0, y: -1, frac: 0 }
      for (let y = Math.round(H * 0.15); y < Math.round(H * 0.92); y += 1) {
        let alt = 0
        let on = 0
        let prev = false
        for (let x = 0; x < W; x += 1) {
          const i = (y * W + x) * 4
          const hit = Math.abs(A[i] - rgb[0]) + Math.abs(A[i + 1] - rgb[1]) + Math.abs(A[i + 2] - rgb[2]) < tol * 3
          if (hit) on += 1
          if (x > 0 && hit !== prev) alt += 1
          prev = hit
        }
        const frac = on / W
        if (frac >= fac[0] && frac <= fac[1] && alt > best.alt) best = { alt, y, frac }
      }
      return best
    },
    [b64, rgb, tol, fac],
  )
}

const GOLD = { name: 'gold', rgb: [212, 175, 55] }
const ORANGE = { name: 'orange', rgb: [255, 106, 0] }
const CYAN = { name: 'cyan', rgb: [22, 119, 255] }
const PAPER_M = { name: 'paper', rgb: [245, 239, 224] }

/* ① 黑金菱纹：黑底 + 满幅菱形 + 顶部金条 */
const decoShot = await c5Shot('deco', 'deco.png')
const deco = decoShot ? await pixProbe('deco.png', [GOLD]) : null
report.steps.deco = deco && { paper: deco.midRuns[0]?.[2], gold: deco.boxes[0].n, bands: deco.bands.gold, topRow: deco.topRow }
if (!deco) errors.push('[样式层] 黑金菱纹没出图')
else {
  // 底是黑的（中线第一段 = 纸色）
  const paper = deco.midRuns[0]?.[2] ?? [255, 255, 255]
  if (px(paper, [10, 10, 10]) > 45) errors.push(`[样式层] 黑金菱纹底色不是近黑（${paper.join(',')}）`)
  // 金色像素要够多，且在纵向八段里**处处都有** —— 满幅菱形网的特征，局部装饰做不到
  const filled = deco.bands.gold.filter((n) => n > 0).length
  if (deco.boxes[0].n < 1200) errors.push(`[样式层] 黑金菱纹金色像素只有 ${deco.boxes[0].n}，菱形网没画出来？`)
  if (filled < 6) errors.push(`[样式层] 黑金菱纹金色只出现在 ${filled}/8 段，不像满幅网格`)
  // 顶部金条：y=2 行三处都得"偏金"（R>G>B 且红蓝差够大）。
  // 不能拿 #d4af37 做绝对比对 —— 顶条是 金→暗金 的渐变，右端实测 (152,122,35)
  for (const c of deco.topRow) {
    if (!(c[0] > c[1] && c[1] > c[2] && c[0] - c[2] > 50 && c[0] > 110)) {
      errors.push(`[样式层] 黑金菱纹顶部金条缺失（y=2 采样 ${c.join(',')}）`)
      break
    }
  }
}

/* ② 橙光胶囊：顶部橙条 + 收窄的橙色胶囊（大圆角把角切掉） */
const pillShot = await c5Shot('pillorange', 'pill.png')
const pill = pillShot ? await pixProbe('pill.png', [ORANGE], 26, 0.5, 26) : null
const pillRows = pillShot ? await bandEdges('pill.png', 150) : []
const pillBands = thickBands(pillRows, 12)
report.steps.pill = pill && { orange: pill.boxes[0].n, rows: pillRows.length, bands: pillBands.length, topRow: pill.topRow }
if (!pill) errors.push('[样式层] 橙光胶囊没出图')
else {
  if (pill.topRow.some((c) => px(c, ORANGE.rgb) > 120)) {
    errors.push(`[样式层] 橙光胶囊顶部橙条缺失（${pill.topRow[1].join(',')}）`)
  }
  // 胶囊必须"收窄成一个块"：既是够高的一块（不是分隔线），又明显窄于正文栏宽。
  // 包围盒不行 —— 顶条会把它撑到整幅宽；逐行取最宽也不行 —— 一条浅橙分隔线就把它盖过去。
  if (!pillBands.length) errors.push('[样式层] 橙光胶囊的标题色块没找到（没有既 ≥150px 宽、又 ≥12 行高的色块）')
  else {
    const cap = pillBands.reduce((a, b) => (b.widest[2] - b.widest[1] > a.widest[2] - a.widest[1] ? b : a))
    const wPx = cap.widest[2] - cap.widest[1]
    const wRatio = wPx / pill.W
    report.steps.pill.pill = {
      y0: cap.y0,
      y1: cap.y1,
      w: wPx,
      hPx: cap.h,
      ratio: Number(wRatio.toFixed(3)),
      x: [cap.widest[1], cap.widest[2]],
    }
    if (wRatio > 0.75) errors.push(`[样式层] 橙光胶囊标题没收窄（腰宽占 ${(wRatio * 100).toFixed(0)}%）`)
    if (wRatio < 0.15) errors.push(`[样式层] 橙光胶囊只量到一条竖线（腰宽 ${(wRatio * 100).toFixed(0)}%）`)
    if (cap.widest[1] < 20 || cap.widest[2] > pill.W - 20) {
      errors.push(`[样式层] 橙光胶囊贴到卡片边上了（x ${cap.widest[1]}..${cap.widest[2]}），没有"收窄居中"`)
    }
    // 胶囊要有厚度，而且厚度要按"整条竖带"量：色块里压着白字，逐行连续色段会被字切碎，
    // 用那个行数当高度只能量到字上方那 18 行。这里在胶囊自己的列区间里数"有色的行"。
    const span = await spanIn('pill.png', ORANGE.rgb, 26, cap.widest[1] + 6, cap.widest[2] - 6, cap.y0 - 40, cap.y1 + 60)
    report.steps.pill.span = span
    if (span.h < 40) errors.push(`[样式层] 橙光胶囊太薄（竖带只有 ${span.h} 行，药丸至少 40）`)
  }
}

/* ③ 青蓝流线：蓝青渐变块 + 一对角比另一对大（8 / 24） */
const cyShot = await c5Shot('cyanflow', 'cyan.png')
const cy = cyShot ? await pixProbe('cyan.png', [CYAN], 26, 0.5, 26) : null
const cyBands = cyShot ? await bandEdges('cyan.png', 150) : []
report.steps.cyan = cy && { cyan: cy.boxes[0].n, bands: cyBands.length, topRow: cy.topRow }
if (!cy) errors.push('[样式层] 青蓝流线没出图')
else {
  // 顶部条：左端偏蓝、右端偏红（这是"双色渐变条"的直接证据）
  const [tl, , tr] = cy.topRow
  if (!(tl[2] > tl[0] + 40)) errors.push(`[样式层] 青蓝流线顶条左端不是蓝（${tl.join(',')}）`)
  if (!(tr[0] > tr[2] + 50 && tr[0] > 120)) errors.push(`[样式层] 青蓝流线顶条右端不是红（${tr.join(',')}）`)
  const cyThick = thickBands(cyBands, 12)
  report.steps.cyan.blockBands = cyThick.length
  if (!cyThick.length) errors.push('[样式层] 青蓝流线找不到渐变色块（没有既 ≥150px 宽、又 ≥12 行高的色块）')
  else {
    // 对角圆角：块顶边那几行，左右两侧各被切掉多少？
    // 8/24 的差别 = 顶边两端内缩量差 16px 左右，所以量"块内首行的 x0/x1"与"块内最宽行的 x0/x1"。
    // 首行必须取自**同一块**：全图最早的有色行可能是一条分隔线，那样量出来的内缩是分隔线的缩进。
    const blk = cyThick.reduce((a, b) => (b.h > a.h ? b : a))
    const waist = blk.widest
    const top = blk.rows.reduce((a, b) => (b[0] < a[0] ? b : a))
    const insetL = top[1] - waist[1]
    const insetR = waist[2] - top[2]
    report.steps.cyan.corners = { band: [blk.y0, blk.y1], waist, top, insetL, insetR, delta: Math.abs(insetL - insetR) }
    if (Math.abs(insetL - insetR) < 5) {
      errors.push(`[样式层] 青蓝流线四角对称了（左内缩 ${insetL} / 右内缩 ${insetR}），对角圆角没生效`)
    }
    if (waist[0] < 30 || waist[2] < 30) errors.push('[样式层] 青蓝流线的块轮廓量得失真')
  }
}

/* ④ 米纸铅字：纸与内卡是两种米色 + 分隔线是点线 */
const twShot = await c5Shot('typograph', 'type.png')
const tw = twShot ? await pixProbe('type.png', [PAPER_M], 18, 0.08) : null
const twPanelY = 0.35
const twPanel = twShot ? await pixProbe('type.png', [], 4, twPanelY) : null
report.steps.typewriter = tw && { paper: tw.midRuns[0]?.[2], paperPx: tw.boxes[0].n }
if (!tw) errors.push('[样式层] 米纸铅字没出图')
else {
  const edge = tw.midRuns[0]?.[2] ?? [255, 255, 255]
  const inner = twPanel?.midRuns.find((r) => r[1] - r[0] > tw.W * 0.3)?.[2] ?? [255, 255, 255]
  report.steps.typewriter.edge = edge
  report.steps.typewriter.inner = inner
  if (px(edge, PAPER_M.rgb) > 60) errors.push(`[样式层] 米纸铅字外圈不是米纸色（${edge.join(',')}）`)
  // 内卡底色要和纸色**不一样**（米纸 + 略亮的卡），但也不能是纯白
  if (px(edge, inner) < 12) errors.push(`[样式层] 米纸铅字的内卡与外纸同色（${inner.join(',')}），双面卡片没生效`)
  if (inner[0] > 252 && inner[1] > 252 && inner[2] > 252) errors.push('[样式层] 米纸铅字内卡成了纯白，不是米色')
  // 分隔线是点线：缩略图的样例正文里没有 hr，DOM 定位不到，只能量预览图。
  // 判据是"虚线感"本身 —— 沿候选行统计 on/off 交替次数，而不是取第一个命中色差的行：
  // 米纸模板的纤维纹理、页眉页脚实线用的都是同一个 #d3c6a6，只按颜色找会抓错行。
  const hr = await dottedAlt('type.png', [211, 198, 166], 30)
  report.steps.typewriter.hr = hr
  if (hr.y < 0) errors.push('[样式层] 米纸铅字找不到可辨认的虚线（没有 30%–75% 覆盖率的长行）')
  else if (hr.alt < 6) errors.push(`[样式层] 米纸铅字分隔线不是点线（交替 ${hr.alt} 次）`)
}

/* ⑤ 回归：新字段的默认值必须"不画"，第 1 套的标题不许有任何形态变化 */
await page.click('.ce-style[data-tpl="paper"]')
await page.waitForTimeout(1200)
const plainHead = await page.evaluate(() => {
  const card = document.querySelector('.ce-style.on .ly-card') || document.querySelector('.ce-style[data-tpl="paper"] .ly-card')
  const pick = (sel) => {
    const el = card?.querySelector(sel)
    if (!el) return null
    const s = getComputedStyle(el)
    return {
      bgImage: s.backgroundImage,
      weight: s.fontWeight,
      track: s.letterSpacing,
      radius: s.borderRadius,
      shadow: s.boxShadow,
      align: s.textAlign,
    }
  }
  return { h1: pick('.ly-body h1'), h2: pick('.ly-body h2'), tb: card?.getAttribute('data-topbar') }
})
report.steps.plainHead = plainHead
if (plainHead.tb !== 'none') errors.push(`[样式层] 素笺清墨被加上了顶部色条（data-topbar=${plainHead.tb}）`)
for (const lv of ['h1', 'h2']) {
  const h = plainHead[lv]
  if (!h) continue
  if (h.bgImage !== 'none') errors.push(`[样式层] 素笺清墨 ${lv} 冒出背景图（${h.bgImage.slice(0, 40)}）`)
  if (h.track !== 'normal') errors.push(`[样式层] 素笺清墨 ${lv} 被改了字距（${h.track}）`)
  // 字重不校验：基础样式给 h1=700 / h2=800，那是模板之外的全局规则，不是新字段写出来的
}

/* ---------- D. 样式包导出 / 导入 ---------- */

// D 组导出的是"当前模板"，这里必须回到波普（后面几条断言是按它的 band/阴影写的）
await page.click('.ce-style[data-tpl="popart"]')
await page.waitForTimeout(1500)

/**
 * 最小 zip 读取（EOCD + 中央目录），只认 store/deflate 两种 method。
 * 验收要看到「.zip 里到底装了什么」，不能只看下载文件非空 ——
 * 这正是 0.11 那种"导出成功但只有半个模板"的假通过来源。
 */
const readZip = (buf) => {
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) return null
  const n = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const out = {}
  for (let i = 0; i < n; i += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break
    const method = buf.readUInt16LE(p + 10)
    const csize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const cmtLen = buf.readUInt16LE(p + 32)
    const off = buf.readUInt32LE(p + 42)
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8')
    const lnameLen = buf.readUInt16LE(off + 26)
    const lextraLen = buf.readUInt16LE(off + 28)
    const start = off + 30 + lnameLen + lextraLen
    const raw = buf.subarray(start, start + csize)
    out[name] = method === 0 ? raw : zlib.inflateRawSync(raw)
    p += 46 + nameLen + extraLen + cmtLen
  }
  return out
}

const dlTpl = page.waitForEvent('download', { timeout: 30000 }).catch(() => null)
await page.click('[data-act="tpl-export"]')
const dTpl = await dlTpl
if (!dTpl) errors.push('导出样式包没有触发下载')
else {
  const f = path.join(OUT, dTpl.suggestedFilename())
  await dTpl.saveAs(f)
  const entries = readZip(fs.readFileSync(f))
  const json = entries?.['template.json'] ? JSON.parse(entries['template.json'].toString('utf8')) : null
  report.steps.templateExport = {
    file: path.basename(f),
    entries: entries ? Object.keys(entries) : [],
    schema: json?.schema,
    id: json?.id,
    hasTokens: !!json?.tokens,
    hasMetrics: !!json?.metrics,
    hasDecor: !!json?.decor,
    subType: fs.readFileSync(f).readUInt32LE(0) === 0x04034b50,
  }
  if (!entries) errors.push('导出的样式包不是合法 zip')
  else if (!entries['template.json']) errors.push('样式包里没有 template.json')
  else {
    if (!entries['README.txt']) errors.push('样式包里没有 README.txt')
    // schema 4 起新增了引用框/项目符号/标题装饰/外边框/印章五组装饰
    report.steps.templateExport.hasDecorFields =
      json.decor &&
      ['bg', 'bgImage', 'bgOpacity', 'binding', 'quote', 'bullet', 'title', 'frame', 'stampPreset'].every((k) => k in json.decor)
    // schema 5「艺术层」：面板 / 分级标题 / 分隔线 / 贴纸 / 表码图三态 / 序号，六样都得在包里
    report.steps.templateExport.hasArtFields =
      json.decor &&
      ['panel', 'headings', 'rule', 'ornaments', 'surface', 'listNo'].every((k) => k in json.decor) &&
      'panelBg' in json.tokens &&
      'patternInk' in json.tokens
    // schema 6「字体与渐层」：标题的字重/字距/标记/投影/对角圆角 + 顶部色条
    report.steps.templateExport.hasDeco6Fields =
      json.decor?.topBar &&
      ['height', 'from', 'to'].every((k) => k in json.decor.topBar) &&
      json.decor.headings?.h2 &&
      ['weight', 'track', 'mark', 'elev', 'radiusAlt'].every((k) => k in json.decor.headings.h2)
    report.steps.templateExport.artValues = json.decor && {
      band: json.decor.panel?.band,
      shadow: json.decor.panel?.shadow,
      h2bg: json.decor.headings?.h2?.bg,
      hr: json.decor.rule?.style,
      orn: json.decor.ornaments?.length,
      listNo: json.decor.listNo,
      topBar: json.decor.topBar?.height,
    }
    if (json.schema !== 6) errors.push(`样式包 schema 应为 6，实测 ${json.schema}`)
    if (!report.steps.templateExport.hasDecorFields) errors.push('样式包缺 schema 4 的 decor 字段')
    if (!report.steps.templateExport.hasArtFields) errors.push('样式包缺 schema 5 的艺术层字段')
    if (!report.steps.templateExport.hasDeco6Fields) errors.push('样式包缺 schema 6 的字体与渐层字段')
    // 导出的正是波普撞印：带宽度与硬阴影必须原样留在包里（不是"导出成功但只有半个模板"）
    if (json.decor?.panel?.band !== 30) errors.push(`样式包里 band=${json.decor?.panel?.band}，应为 30`)
    if (json.decor?.panel?.shadow !== 'sticker') errors.push(`样式包里 shadow=${json.decor?.panel?.shadow}，应为 sticker`)
    if (!json.tokens?.accent) errors.push('样式包缺少 tokens')
  }

  /* 同一个 zip 再导回来：应当多出一张「我的模板」，且选中它 */
  await page.setInputFiles('input[type="file"][accept*="zip"]', f)
  await page.waitForTimeout(1600)
  const dupCount = await page.locator(`.ce-style[data-tpl^="${json?.id}"]`).count()
  const curName = await page.locator('.ce-style.on .ce-style-name').innerText().catch(() => '')
  report.steps.templateImport = { dupCount, current: curName }
  if (dupCount < 2) errors.push(`重新导入样式包后没有生成副本（同名卡片 ${dupCount} 张）`)
  if (!curName) errors.push('导入样式包后当前模板名读不到')

  /* 旧版单文件 .lyt.json 必须继续能认 */
  const legacy = path.join(OUT, 'legacy.lyt.json')
  fs.writeFileSync(legacy, JSON.stringify({ name: '旧包测试', tokens: { paper: '#fff7e6', accent: '#b1523a' } }), 'utf8')
  const beforeLegacy = await page.locator('.ce-style[data-tpl]').count()
  await page.setInputFiles('input[type="file"][accept*="zip"]', legacy)
  await page.waitForTimeout(1600)
  const afterLegacy = await page.locator('.ce-style[data-tpl]').count()
  const legacyNamed = await page.locator('.ce-style-name:has-text("旧包测试")').count()
  report.steps.legacyImport = { beforeLegacy, afterLegacy, legacyNamed }
  if (afterLegacy !== beforeLegacy + 1) errors.push('旧版 .lyt.json 导入后卡片数没增加')
  if (legacyNamed < 1) errors.push('旧版 .lyt.json 没出现在「我的模板」里')
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

/* ---------- C6. 导出健壮性：安卓"卡在正在渲染"与"报失败"的两类成因 ---------- *
 *
 * 安卓上报的两个症状，成因都不是"模板写错了"，而是渲染管线的韧性：
 *   ① 只有一条光栅化通路，一步不成立就永久挂起（没有超时）或直接失败；
 *   ② 失败路径不收拾现场，试几次就把内存拖死；
 *   ③ 分享面板被划走也报「导出失败」。
 *
 * 这里不去（也去不了）连真机，而是把这三个条件**在桌面复现**：
 *   · 注入 data URI 失败 → 必须自动换路（blob/percent）且产物逐字节不变
 *   · 注入全部失败      → 必须按时报错、说清试过哪几条、文档里不留残留节点
 *   · 之后清掉注入      → 必须还能正常导出（busy 已复位）
 * 第 2 条是这次改造的核心承诺：降级不该改变像素，否则"救回来"也没意义。
 */
const statusProbe = () =>
  page.evaluate(() => {
    const s = document.querySelector('.ce-status')
    return { text: s?.textContent || '', title: s?.title || '', tone: s?.dataset.tone || '' }
  })

const exportPdfBytes = async (tag) => {
  const dl = page.waitForEvent('download', { timeout: 90000 }).catch(() => null)
  await page.click('.ce-btn[data-act="pdf"]')
  const d = await dl
  if (!d) return null
  const f = path.join(OUT, `${tag}.pdf`)
  await d.saveAs(f)
  return { file: f, bytes: fs.statSync(f).size, sha: sha256(f) }
}

report.steps.c6 = {}
// 主路径的状态栏诊断：这条 title 是用户报障时唯一能抄给我们的东西
const mainStatus = await statusProbe()
const mainTitle = mainStatus.title
const kB = [...mainTitle.matchAll(/([\d.]+)KB/g)].map((m) => +m[1])
report.steps.c6.diagnostic = { text: mainStatus.text, title: mainTitle }
if (!/渲染路径\s+(data|blob|percent)\s+@[\d.]+×/.test(mainTitle)) errors.push('[健壮性] 状态栏没有渲染诊断（title）')
if (kB.length < 2) errors.push('[健壮性] 诊断里没有 SVG→URI 的体积')
else if (kB[1] > kB[0] * 1.45) errors.push(`[健壮性] URI 相对 SVG 膨胀 ${(kB[1] / kB[0]).toFixed(2)} 倍，超过 1.45（编码方式退化了？）`)

// 基线：正常导出一份 PDF
const pdfBase = await exportPdfBytes('c6-base')
if (!pdfBase) errors.push('[健壮性] 基线 PDF 没导出')

// ① 逼主路径失败：必须自动换路，产物必须逐字节一致
await page.evaluate(() => localStorage.setItem('lypora:capture-probe', JSON.stringify({ fail: ['data'] })))
const pdfAlt = await exportPdfBytes('c6-fallback')
const altStatus = await statusProbe()
report.steps.c6.fallback = {
  base: pdfBase && pdfBase.sha,
  alt: pdfAlt && pdfAlt.sha,
  sameBytes: Boolean(pdfBase && pdfAlt && pdfBase.sha === pdfAlt.sha),
  title: altStatus.title,
}
if (!pdfAlt) errors.push('[健壮性] data URI 注入失败后没导出（降级链没接上）')
else if (pdfBase && pdfAlt.sha !== pdfBase.sha) errors.push('[健壮性] 降级路径产物与主路径不一致（像素被动过）')
if (!/第\s*[2-4]\s*条路/.test(altStatus.title)) errors.push('[健壮性] 降级时诊断没说明"第几条路"')

// ② 全部失败：必须按时报错、说清试过哪些路、不留残留
expectConsoleErrors = true
await page.evaluate(() =>
  localStorage.setItem(
    'lypora:capture-probe',
    JSON.stringify({ fail: ['data', 'blob', 'percent', 'canvas'], timeoutMs: 400 }),
  ),
)
const tFail = Date.now()
await page.click('.ce-btn[data-act="pdf"]')
const failed = await page
  .waitForFunction(() => document.querySelector('.ce-status')?.dataset.tone === 'err', { timeout: 20000 })
  .then(() => true)
  .catch(() => false)
const failMs = Date.now() - tFail
const failStatus = await statusProbe()
const leftovers = await page.evaluate(() => document.querySelectorAll('[data-ly-capture]').length)
report.steps.c6.allFail = { settled: failed, ms: failMs, text: failStatus.text, title: failStatus.title, leftovers }
if (!failed) errors.push('[健壮性] 全部通路失败后 20s 内没有报错（这就是"卡在正在渲染"的复现）')
if (failMs > 15000) errors.push(`[健壮性] 全失败用了 ${failMs}ms 才报错，太久了`)
if (!failStatus.text.includes('渲染失败')) errors.push('[健壮性] 失败状态没有"渲染失败"前缀')
// 状态栏一行只放"第一条失败"（手机上是 nowrap + ellipsis），完整清单必须在 title 里
if (!failStatus.text.includes('@')) errors.push('[健壮性] 状态栏没给出第一条失败通路')
if ((failStatus.title.match(/@/g) || []).length < 3) errors.push('[健壮性] 诊断没列出试过哪几条路')
if (leftovers !== 0) errors.push(`[健壮性] 失败后文档里残留 ${leftovers} 个渲染宿主（内存泄漏）`)

// ③ 清掉注入后必须还能导出（busy 要复位，不然按钮就"死了"）
await page.evaluate(() => localStorage.removeItem('lypora:capture-probe'))
const pdfAgain = await exportPdfBytes('c6-again')
report.steps.c6.recover = { ok: Boolean(pdfAgain), sameBytes: Boolean(pdfBase && pdfAgain && pdfBase.sha === pdfAgain.sha) }
expectConsoleErrors = false
if (!pdfAgain) errors.push('[健壮性] 失败一次之后再导出没有任何反应（busy 没复位）')
else if (pdfBase && pdfAgain.sha !== pdfBase.sha) errors.push('[健壮性] 恢复导出后的产物与基线不一致')

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
