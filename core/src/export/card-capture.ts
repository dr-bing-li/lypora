/**
 * 卡片光栅化与 PDF / ZIP 打包 —— 零依赖，桌面与 Android 走同一条路。
 *
 * 为什么不用 html2canvas 这类库：它们要重新实现一遍 CSS 布局（背景渐变、伪元素、
 * flex 都靠 patch），渲染结果和真实浏览器有差异，越复杂的模板越容易翻车；而且
 * 多数库不支持 KaTeX 的绝对定位细节。这里走浏览器的原生能力：
 *
 *   卡片 DOM → XHTML → <svg><foreignObject> → <img> → canvas → PNG / JPEG
 *
 * foreignObject 交给浏览器自己的排版引擎去画，输出与屏幕所见像素级一致。
 * 代价是必须**内联一切外部资源**：CSS、图片、字体。
 * Lypora 里 CSS 由模板编译而来（`stylesheetFor(tpl)`），图片统一转 data URL，
 * 字体只使用系统字体栈 —— 这正是"完全离线"的物理前提。
 *
 * ---------------------------------------------------------------------------
 * v0.14.1 的 Android 加固（为什么这里比"能跑就行"多了一倍代码）
 *
 * 安卓上「排版 → 导出」出现过两种症状：一直停在「正在渲染…」，或者直接报失败。
 * 逐个查下来是四个各自独立的坑，四个都得堵：
 *
 *   ① 一条路走到黑。整个光栅化只有「拼 SVG → 当图片加载 → 画进画布」这一条路，
 *      任何一步不成立就彻底失败。而 WebView 对超长 data URI（实测带公式的卡片
 *      SVG 394KB、URI 500KB 上下）的处理恰恰可能是**不 load 也不 error**：
 *      Promise 永不 settle，于是永远「正在渲染…」，busy 一直是 true，
 *      之后每次点导出都毫无反应。
 *      → 不是换个编码就完事，而是备一条降级链，并且每步都套超时。
 *   ② 图片取不回来也一样卡死：`fetch` 和 `img.decode()` 都没有超时，移动网络下
 *      一次卡住就再也不会继续。→ 都加了上限。
 *   ③ 失败路径不收拾现场：host 节点和临时改写的 img src 只在成功时还原。
 *      手机内存本来就紧，试几次就把后续尝试一起拖死。→ 全部收进 try/finally。
 *   ④ "空白也算成功"：WebView 有时会 load 成功但 drawImage 出来是全透明的。
 *      → 逐点采样，空白就换下一条路，而不是交出一张白图。
 *
 * 于是这里不是一个方案，是一条**降级链**：base64 data URI → blob URL →
 * percent data URI → 降倍率重画。每条路都有超时，失败就换下一条；
 * 全失败才报错，并说明试过哪几条路。桌面永远走第一条，输出与 v0.14.0 逐字节一致
 * （`beautify-check` 的 C6 用 sha256 比过）。
 *
 * PDF 与 ZIP 都是自研写入器（DCTDecode 直通 / store 模式），不引第三方库。
 */

import { KATEX_CSS } from '../io/katex-inline'
import type { CardPage } from './card-layout'
import { pageAsFragment } from './card-layout'
import type { CardSize } from './card-themes'
import type { CardTemplate } from './template/types'
import { stylesheetFor } from './template/compile'

/* ------------------------------------------------------------------ *
 * 基础设施：超时 / 探针 / 字节编码
 * ------------------------------------------------------------------ */

/**
 * 单步等待上限。桌面正常流程 200–600ms，6s 是"慢机器也够、真卡住也能自救"的分界。
 * 见文件头 ① ②：没有超时的 await 在 WebView 里就是永久挂起。
 */
const STEP_TIMEOUT_MS = 6000

/** 单张图片取回的上限（移动网络下取一张 3MB 图也要不了这么久） */
const IMAGE_TIMEOUT_MS = 5000

function withTimeout<T>(p: Promise<T>, ms: number, tag: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(tag)), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

/**
 * 故障注入探针 —— 只给自动化验收用，正常用户永远不会写这条键。
 *
 * 为什么不放 window 上的全局变量：验收脚本只要在点导出**之前**写一条 localStorage
 * 就行，产品里不用留任何全局开关；读不到就是空对象，零成本。
 *   {"fail":["data"]}                   → 逼主路径失败，验证降级链真的能出图
 *   {"fail":["data","blob","percent"]}  → 验证全失败时按时报错、不留垃圾节点
 *   {"timeoutMs":300}                   → 把每步上限压短，让"卡住"用例几秒内跑完
 * fail 的取值：data / blob / percent / canvas / encode，其中 canvas 让画布环节失败。
 */
interface CaptureProbe {
  fail: string[]
  timeoutMs: number
}

function readProbe(): CaptureProbe {
  const def: CaptureProbe = { fail: [], timeoutMs: STEP_TIMEOUT_MS }
  try {
    const raw = localStorage.getItem('lypora:capture-probe')
    if (!raw) return def
    const o = JSON.parse(raw) as { fail?: unknown; timeoutMs?: unknown }
    return {
      fail: Array.isArray(o.fail) ? o.fail.filter((x): x is string => typeof x === 'string') : [],
      timeoutMs: typeof o.timeoutMs === 'number' && o.timeoutMs > 0 ? o.timeoutMs : STEP_TIMEOUT_MS,
    }
  } catch {
    return def
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  // 分块拼接：整块 apply 到 String.fromCharCode 会在几十万字节时爆栈
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(bin)
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64)
  // 显式 new ArrayBuffer：buffer 的类型得是 ArrayBuffer 才能直接当 BlobPart
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff
  return out
}

/* ------------------------------------------------------------------ *
 * 图片内联
 * ------------------------------------------------------------------ */

async function imageToDataUrl(src: string): Promise<string | null> {
  if (!src || src.startsWith('data:')) return src || null
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null
  const timer = ctrl ? setTimeout(() => ctrl.abort(), IMAGE_TIMEOUT_MS) : 0
  try {
    const res = await fetch(src, ctrl ? { signal: ctrl.signal } : undefined)
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise<string>((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => resolve(String(fr.result))
      fr.onerror = () => reject(fr.error)
      fr.readAsDataURL(blob)
    })
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** 把待截图的节点里所有外链图片就地换成 data URL（返回还原函数） */
async function inlineImages(root: HTMLElement): Promise<{ restore: () => void; blocked: HTMLImageElement[] }> {
  const imgs = Array.from(root.querySelectorAll('img'))
  const originals: Array<[HTMLImageElement, string]> = []
  const blocked: HTMLImageElement[] = []
  await Promise.all(
    imgs.map(async (img) => {
      const src = img.getAttribute('src') || ''
      if (!src || src.startsWith('data:')) return
      originals.push([img, src])
      const data = await imageToDataUrl(src)
      if (data) img.setAttribute('src', data)
      else blocked.push(img)
    }),
  )
  // 等解码完成，否则 foreignObject 里可能是空白占位。
  // decode() 在图片本身坏掉时可能既不 resolve 也不 reject（WebView 常见），加超时兜住。
  await Promise.all(
    imgs.map((img) =>
      img.decode
        ? withTimeout(img.decode().catch(() => undefined), IMAGE_TIMEOUT_MS, 'image-decode-timeout').catch(() => undefined)
        : Promise.resolve(),
    ),
  )
  return {
    blocked,
    restore: () => {
      for (const [img, src] of originals) img.setAttribute('src', src)
    },
  }
}

/* ------------------------------------------------------------------ *
 * DOM → canvas
 * ------------------------------------------------------------------ */

export interface CaptureOptions {
  scale: number
  /** 卡片外的底色（圆角处会露出）；'transparent' = 不填底色，导出带圆角透明边缘的 PNG */
  backdrop: string
  /** 当前模板编译出的样式（骨架 + 变量），必须与预览、测量用同一份 */
  css: string
  /**
   * 是否保留卡片圆角。
   *
   * v0.11 及以前这里**无条件把圆角归零**（注释说"PNG 是矩形交付物"），
   * 于是「圆角(px)」滑块从 0 拉到 24 预览图一个像素都不变 —— 用户报的
   * "调整圆角没有任何改动展示"，根因就在这一行，而不是 CSS 没写。
   * 现在默认保留：预览与 PNG 用透明底色，圆角是真圆角（能贴到任何背景上）；
   * 只有 PDF（JPEG 通道没有 alpha）需要底色兜住。
   */
  keepRadius?: boolean
}

export interface CaptureOutcome {
  canvas: HTMLCanvasElement
  report: CaptureReport
}

export interface CaptureReport {
  /** 最终走通的那条路 */
  strategy: 'data' | 'blob' | 'percent'
  /** SVG 自身字节数（UTF-8） */
  svgBytes: number
  /** 真正交给浏览器解码的那串 URL 的长度 */
  urlBytes: number
  scale: number
  /** 试了几条路才成功（1 = 主路径一次过） */
  attempts: number
  ms: number
}

/** 画布尺寸上限：WebView 上超过这个量级会直接给 null 上下文或画成空白 */
const MAX_CANVAS_SIDE = 4096
const MAX_CANVAS_AREA = 16 * 1024 * 1024

function fitScale(w: number, h: number, want: number): number {
  let s = want
  while (s > 0.3 && (w * s > MAX_CANVAS_SIDE || h * s > MAX_CANVAS_SIDE || w * s * h * s > MAX_CANVAS_AREA)) {
    s = Math.round(s * 90) / 100
  }
  return s
}

/**
 * SVG → data URI。
 *
 * 主路径用 base64，不是因为"更小"——实测同一张带公式的卡片，
 * base64 把 394KB 的 SVG 变成 525KB（恒定 1.33 倍），
 * percent 只变成 444KB（样式里大部分字符不用转义，只有 `{}();:#%` 这些要）。
 * 选它是因为**形式最干净**：base64 的字符集里没有 `%`、没有裸 `#`、没有引号，
 * 不吃各版本 WebView 对 URI 解析的边角差异；而 percent 对中文正文是 3 倍/字，
 * 纯文字卡片反而更大。两条都留着，谁先能用谁上（见降级链）。
 */
function svgToDataUrl(svg: string, percent: boolean): string {
  if (percent) return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  return 'data:image/svg+xml;base64,' + bytesToBase64(new TextEncoder().encode(svg))
}

function loadSvgImage(url: string, timeoutMs: number, svgForDiag: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'sync'
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      // 断开还没结束的解码，别让它在后台继续啃内存
      try {
        img.src = ''
      } catch {
        /* 忽略 */
      }
      reject(new Error('svg-load-timeout'))
    }, timeoutMs)
    img.onload = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(img)
    }
    img.onerror = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      // 定位用：SVG 加载失败时把 XML 解析器的报错带出来
      let diag = ''
      try {
        const doc = new DOMParser().parseFromString(svgForDiag, 'image/svg+xml')
        const pe = doc.querySelector('parsererror')
        diag = pe ? (pe.textContent || '').replace(/\s+/g, ' ').slice(0, 200) : 'no-parsererror'
      } catch (e) {
        diag = String(e)
      }
      reject(new Error(`svg-load-error (${svgForDiag.length}B): ${diag}`))
    }
    img.src = url
  })
}

function drawToCanvas(img: HTMLImageElement, w: number, h: number, scale: number, backdrop: string): HTMLCanvasElement {
  const cw = Math.round(w * scale)
  const ch = Math.round(h * scale)
  if (!cw || !ch) throw new Error('canvas-empty')
  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas-2d-unavailable')
  // 'transparent' 不是真的颜色而是"不画"：保留 alpha，圆角边缘透出去
  if (backdrop !== 'transparent') {
    ctx.fillStyle = backdrop
    ctx.fillRect(0, 0, cw, ch)
  }
  ctx.drawImage(img, 0, 0, cw, ch)
  return canvas
}

/**
 * 交出来的到底是画好的卡片，还是一张全透明空图？顺便验一次画布有没有被污染。
 *
 * 两件事合在一个函数里，是因为它们用的是同一个动作（getImageData）：
 *   · 污染：blob URL 作 <img> 源时 Chromium 会把画布标脏，之后 toBlob/toDataURL
 *     直接抛 SecurityError。**必须在这里发现**——否则 PDF 那条路（底色不透明、
 *     不做空白判断）会带着脏画布走到底，在编码阶段才炸，降级链就白设了。
 *   · 空白：WebView 上 onload 成功但 drawImage 出白图是真实存在的（解码器被回收、
 *     foreignObject 光栅化失败都这样），只看 onload 就会把白图当成功结果存下来。
 *
 * checkBlank 只在透明底色（PNG / 预览）时才为 true：填了底色的画布"永远不空"，
 * 那是兜底色不是卡片，判断了也没有意义。
 */
function assertPainted(canvas: HTMLCanvasElement, checkBlank: boolean): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas-2d-unavailable')
  const xs = [0.5, 0.25, 0.75]
  const ys = [0.5, 0.25, 0.75]
  let painted = false
  for (const fy of ys) {
    for (const fx of xs) {
      let d: Uint8ClampedArray
      try {
        d = ctx.getImageData(Math.floor(canvas.width * fx), Math.floor(canvas.height * fy), 1, 1).data
      } catch {
        throw new Error('canvas-tainted')
      }
      if (d[3] > 8) painted = true
    }
  }
  if (!painted && checkBlank) throw new Error('canvas-blank')
}

export async function captureCard(fragmentHtml: string, size: CardSize, opts: CaptureOptions): Promise<CaptureOutcome> {
  const t0 = performance.now()
  const probe = readProbe()

  // 离屏宿主：必须在文档里才能布局与加载图片。
  // data-ly-capture 是给验收/排障用的标记：导出失败后文档里不该留下任何一块
  // （曾经失败路径不收拾，试几次就把手机内存拖死，见文件头 ③）
  const host = document.createElement('div')
  host.dataset.lyCapture = '1'
  host.style.cssText = 'position:fixed;left:-30000px;top:0;pointer-events:none;opacity:0'
  host.innerHTML = `<style>${opts.css}</style>${fragmentHtml}`
  document.body.appendChild(host)

  let restore = (): void => undefined
  let blobUrl = ''

  try {
    const card = host.querySelector('.ly-card') as HTMLElement | null
    if (!card) throw new Error('card-missing')
    // PDF / 需要整幅底面时才归零；预览与 PNG 保留圆角（见 CaptureOptions.keepRadius）
    if (opts.keepRadius === false) {
      card.style.borderRadius = '0'
      card.style.boxShadow = 'none'
    }

    const inlined = await inlineImages(card)
    restore = inlined.restore
    // 拉不到的图片（CORS / file:// 被拦）必须摘掉：留在 SVG 里会让 canvas 被标记
    // 为 tainted，toDataURL 直接抛 SecurityError，整张卡片报废
    for (const img of inlined.blocked) img.remove()

    const w = size.w
    const h = size.h
    const xhtml = new XMLSerializer().serializeToString(card)

    // 公式样式必须跟着走：KaTeX 的 HTML 没有 CSS 就退化成"平铺文字"
    // （∫₀¹ 会变成 ∫01，上标全部掉到基线上）。没有公式就不塞，省 360KB。
    const mathCss = fragmentHtml.includes('class="katex') ? KATEX_CSS : ''

    /*
     * 样式必须包 CDATA。
     *
     * SVG 是被 XML 解析器读的，`<style>` 里出现一个裸的小于号（CSS 注释里写
     * 「ol 的 start 属性」时很自然会写成尖括号形式）就会被当成标签开头，
     * 报 "Unexpected token inside qualified name" —— 整张卡片渲染失败，
     * 而且只在导出/预览时炸，编辑器里看不出来。v0.13.0 就踩了这一下。
     * `]]>` 在 CSS 里不存在，仍按规范切成两段 CDATA 兜住。
     */
    const cssText = (opts.css + mathCss).replace(/]]>/g, ']]]]><![CDATA[>')

    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
      `<foreignObject x="0" y="0" width="100%" height="100%">` +
      `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${w}px;height:${h}px">` +
      `<style><![CDATA[${cssText}]]></style>${xhtml}` +
      `</div></foreignObject></svg>`

    const svgBytes = new TextEncoder().encode(svg).length
    const base = fitScale(w, h, opts.scale)

    /*
     * 降级链。同一个 SVG 换"怎么交给解码器"，最后再降倍率重画：
     *   data(base64) 起步 —— 形式最干净也不污染画布，桌面永远走这条
     *   blob URL    —— WebView 偶发不认超长 data URI 时的正解（若把画布标脏，
     *                  assertPainted 的 getImageData 会抛，自然落到下一条）
     *   percent     —— 老编码，兜底"base64 解析失败"这种更少见的情形
     *   0.65 倍     —— 前三条都失败时，问题通常在画布/内存而不是编码
     * 每条路都有自己的超时；全失败才抛，错误里带"试过哪几条"。
     */
    const plans: Array<{ strategy: CaptureReport['strategy']; scale: number; percent?: boolean }> = [
      { strategy: 'data', scale: base },
      { strategy: 'blob', scale: base },
      { strategy: 'percent', scale: base, percent: true },
      { strategy: 'data', scale: Math.max(0.3, Math.round(base * 65) / 100) },
    ]

    const failures: string[] = []
    // 全部通路都画出"空白"时的保底：留着第一张，链路走完还没好就用它。
    // 不这么做的话，把纸张色清成透明（`∅`）的模板会被判成"渲染失败"——
    // 一张真的透明卡片，和"画不出来"在图上是同一件事，只能由人决定。
    let blankOutcome: CaptureOutcome | null = null
    for (let i = 0; i < plans.length; i++) {
      const plan = plans[i]
      if (probe.fail.includes(plan.strategy) || probe.fail.includes('canvas')) {
        failures.push(`${plan.strategy}@${plan.scale}:injected`)
        continue
      }
      try {
        let url: string
        if (plan.strategy === 'blob') {
          if (!blobUrl) blobUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
          url = blobUrl
        } else {
          url = svgToDataUrl(svg, Boolean(plan.percent))
        }
        const img = await loadSvgImage(url, probe.timeoutMs, svg)
        const canvas = drawToCanvas(img, w, h, plan.scale, opts.backdrop)
        const report: CaptureReport = {
          strategy: plan.strategy,
          svgBytes,
          urlBytes: url.length,
          scale: plan.scale,
          attempts: i + 1,
          ms: Math.round(performance.now() - t0),
        }
        // 污染检查每次都要做（PDF 的底色不透明，丢了这一步脏画布会一路走到编码阶段才炸）
        try {
          assertPainted(canvas, opts.backdrop === 'transparent')
        } catch (e) {
          const why = String((e as Error).message || e)
          // 只把"空白"当可容忍情形；被污染的画布编不出来，必须换路
          if (why === 'canvas-blank') blankOutcome ??= { canvas, report }
          throw new Error(why)
        }
        return { canvas, report }
      } catch (err) {
        const msg = String((err as Error).message || err)
        failures.push(`${plan.strategy}@${plan.scale}:${msg}`)
      }
    }
    if (blankOutcome) return blankOutcome
    throw new Error(`card-render-failed [${failures.join(' | ')}]`)
  } finally {
    // 失败路径也必须收拾干净：host 里挂着一整张卡片 + 一份全量样式，
    // 留在文档里就是实打实的内存泄漏（手机内存紧，试几次就把后续尝试拖死）
    try {
      restore()
    } catch {
      /* 忽略 */
    }
    host.remove()
    if (blobUrl) {
      const u = blobUrl
      // 留一拍再回收：紧跟着 revoke 有可能打断还在进行的解码
      setTimeout(() => URL.revokeObjectURL(u), 1000)
    }
  }
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png', quality = 0.94): Promise<Blob> {
  return new Promise((resolve, reject) => {
    let settled = false
    const probe = readProbe()

    /** toBlob 失败/超时/回 null 时的兜底：toDataURL 是同步编码，能救回一部分 WebView */
    const fallback = (why: Error): void => {
      try {
        const url = canvas.toDataURL(type, quality)
        const comma = url.indexOf(',')
        if (comma < 0) return reject(why)
        resolve(new Blob([base64ToBytes(url.slice(comma + 1))], { type }))
      } catch {
        reject(why)
      }
    }

    if (probe.fail.includes('encode')) {
      settled = true
      fallback(new Error('canvas-encode-injected'))
      return
    }

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      fallback(new Error('canvas-encode-timeout'))
    }, probe.timeoutMs)

    try {
      canvas.toBlob((b) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        // WebView 在内存吃紧时会"成功回调但给 null"，不能当成成功
        if (b && b.size) resolve(b)
        else fallback(new Error('canvas-encode-failed'))
      }, type, quality)
    } catch (e) {
      settled = true
      clearTimeout(timer)
      fallback(e as Error)
    }
  })
}

export async function canvasToJpeg(canvas: HTMLCanvasElement, quality = 0.92): Promise<Uint8Array> {
  const blob = await canvasToBlob(canvas, 'image/jpeg', quality)
  return new Uint8Array(await blob.arrayBuffer())
}

/* ------------------------------------------------------------------ *
 * 最小 PDF 写入器（图片页 / DCTDecode 直通）
 * ------------------------------------------------------------------ */

interface PdfImagePage {
  jpeg: Uint8Array
  pxW: number
  pxH: number
}

function latin1(s: string): Uint8Array {
  const u = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xff
  return u
}

function round2(n: number): string {
  return String(Math.round(n * 100) / 100)
}

/** 每张卡片一页；页面尺寸按 96dpi → pt（×0.75），图片铺满整页不带页边距 */
export function buildPdf(pages: PdfImagePage[], pageW: number, pageH: number): Blob {
  const chunks: Uint8Array[] = []
  let offset = 0
  const offsets: number[] = []

  const push = (data: Uint8Array | string) => {
    const u8 = typeof data === 'string' ? latin1(data) : data
    chunks.push(u8)
    offset += u8.length
  }
  const startObj = (n: number) => {
    offsets[n] = offset
    push(`${n} 0 obj\n`)
  }

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')

  const pageCount = pages.length
  const kidIds: number[] = []
  for (let i = 0; i < pageCount; i++) kidIds.push(3 + i * 3)

  startObj(1)
  push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')

  startObj(2)
  push(`<< /Type /Pages /Count ${pageCount} /Kids [${kidIds.map((k) => `${k} 0 R`).join(' ')}] >>\nendobj\n`)

  const W = round2(pageW)
  const H = round2(pageH)

  pages.forEach((pg, i) => {
    const pageId = 3 + i * 3
    const contentId = pageId + 1
    const imgId = pageId + 2

    startObj(pageId)
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] ` +
        `/Resources << /XObject << /Im0 ${imgId} 0 R >> /ProcSet [/PDF /ImageC] >> ` +
        `/Contents ${contentId} 0 R >>\nendobj\n`,
    )

    const content = `q\n${W} 0 0 ${H} 0 0 cm\n/Im0 Do\nQ\n`
    startObj(contentId)
    push(`<< /Length ${latin1(content).length} >>\nstream\n`)
    push(content)
    push('endstream\nendobj\n')

    startObj(imgId)
    push(
      `<< /Type /XObject /Subtype /Image /Width ${pg.pxW} /Height ${pg.pxH} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.jpeg.length} >>\nstream\n`,
    )
    push(pg.jpeg)
    push('\nendstream\nendobj\n')
  })

  const xrefPos = offset
  const maxObj = 2 + pageCount * 3
  let xref = `xref\n0 ${maxObj + 1}\n0000000000 65535 f \n`
  for (let n = 1; n <= maxObj; n++) {
    xref += `${String(offsets[n] ?? 0).padStart(10, '0')} 00000 n \n`
  }
  push(xref)
  push(`trailer\n<< /Size ${maxObj + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`)

  return new Blob(chunks as BlobPart[], { type: 'application/pdf' })
}

/* ------------------------------------------------------------------ *
 * 极简 ZIP（store 模式，不压缩）—— 多页 PNG 打成一个包，避免浏览器
 * 连续的多次下载触发"阻止多个文件下载"的拦截
 * ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export interface ZipEntry {
  name: string
  data: Uint8Array
}

export function buildZip(entries: ZipEntry[]): Blob {
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0

  const now = new Date()
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff

  for (const e of entries) {
    const nameBytes = new TextEncoder().encode(e.name)
    const crc = crc32(e.data)

    const lh = new DataView(new ArrayBuffer(30))
    lh.setUint32(0, 0x04034b50, true)
    lh.setUint16(4, 20, true)
    lh.setUint16(6, 0x0800, true)
    lh.setUint16(8, 0, true)
    lh.setUint16(10, dosTime, true)
    lh.setUint16(12, dosDate, true)
    lh.setUint32(14, crc, true)
    lh.setUint32(18, e.data.length, true)
    lh.setUint32(22, e.data.length, true)
    lh.setUint16(26, nameBytes.length, true)
    lh.setUint16(28, 0, true)
    locals.push(new Uint8Array(lh.buffer), nameBytes, e.data)

    const ch = new DataView(new ArrayBuffer(46))
    ch.setUint32(0, 0x02014b50, true)
    ch.setUint16(4, 20, true)
    ch.setUint16(6, 20, true)
    ch.setUint16(8, 0x0800, true)
    ch.setUint16(10, 0, true)
    ch.setUint16(12, dosTime, true)
    ch.setUint16(14, dosDate, true)
    ch.setUint32(16, crc, true)
    ch.setUint32(20, e.data.length, true)
    ch.setUint32(24, e.data.length, true)
    ch.setUint16(28, nameBytes.length, true)
    ch.setUint16(30, 0, true)
    ch.setUint16(32, 0, true)
    ch.setUint16(34, 0, true)
    ch.setUint16(36, 0, true)
    ch.setUint32(38, 0, true)
    ch.setUint32(42, offset, true)
    centrals.push(new Uint8Array(ch.buffer), nameBytes)

    offset += 30 + nameBytes.length + e.data.length
  }

  const centralSize = centrals.reduce((n, c) => n + c.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, entries.length, true)
  end.setUint16(10, entries.length, true)
  end.setUint32(12, centralSize, true)
  end.setUint32(16, offset, true)

  return new Blob([...locals, ...centrals, new Uint8Array(end.buffer)] as BlobPart[], { type: 'application/zip' })
}

/* ------------------------------------------------------------------ *
 * 高层出口
 * ------------------------------------------------------------------ */

export interface RenderResult {
  blobs: Blob[]
  size: CardSize
}

/** 逐页渲染时的回调：面板用它显示「正在渲染 2/5…」，并把渲染诊断挂到状态栏提示上 */
export interface RenderHooks {
  onProgress?: (done: number, total: number) => void
  onReport?: (report: CaptureReport) => void
}

/**
 * 让出一帧。
 *
 * 多页导出是"连续几秒的同步重活"，中间不让帧的话浏览器根本没机会重绘状态栏 ——
 * 用户看到的永远是进入时那一行「正在渲染…」，跟卡死一模一样（手机尤其明显，
 * 还可能触发 ANR）。每页之间让一拍，进度数字才真的会动。
 */
function nextFrame(): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 48)
    if (typeof requestAnimationFrame === 'function' && !document.hidden) {
      requestAnimationFrame(() => {
        clearTimeout(timer)
        setTimeout(resolve, 0)
      })
    }
  })
}

/** 画布用完立刻还内存：多页导出时上一页的 1080×1440 不该陪跑到最后一页 */
function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0
  canvas.height = 0
}

/** 逐页渲染成 PNG（每页一个文件）。透明底色 + 保留圆角：拿到的是能贴到任何背景上的圆角图 */
export async function renderPagesToPng(
  pages: CardPage[],
  size: CardSize,
  tpl: CardTemplate,
  backdrop: string,
  hooks?: RenderHooks,
): Promise<RenderResult> {
  const css = stylesheetFor(tpl)
  const blobs: Blob[] = []
  for (let i = 0; i < pages.length; i++) {
    hooks?.onProgress?.(i, pages.length)
    await nextFrame()
    const out = await captureCard(pageAsFragment(pages[i], size, tpl), size, { scale: size.scale, backdrop, css })
    hooks?.onReport?.(out.report)
    try {
      blobs.push(await canvasToBlob(out.canvas, 'image/png'))
    } finally {
      releaseCanvas(out.canvas)
    }
  }
  hooks?.onProgress?.(pages.length, pages.length)
  return { blobs, size }
}

/** 逐页渲染后拼成一份 PDF。JPEG 没有 alpha，圆角归零、底色兜满整页 */
export async function renderPagesToPdf(
  pages: CardPage[],
  size: CardSize,
  tpl: CardTemplate,
  backdrop: string,
  hooks?: RenderHooks,
): Promise<Blob> {
  const css = stylesheetFor(tpl)
  const imgs: PdfImagePage[] = []
  for (let i = 0; i < pages.length; i++) {
    hooks?.onProgress?.(i, pages.length)
    await nextFrame()
    const out = await captureCard(pageAsFragment(pages[i], size, tpl), size, {
      scale: size.scale,
      backdrop,
      css,
      keepRadius: false,
    })
    hooks?.onReport?.(out.report)
    try {
      imgs.push({ jpeg: await canvasToJpeg(out.canvas), pxW: out.canvas.width, pxH: out.canvas.height })
    } finally {
      releaseCanvas(out.canvas)
    }
  }
  hooks?.onProgress?.(pages.length, pages.length)
  return buildPdf(imgs, size.w * 0.75, size.h * 0.75)
}

/**
 * 面板预览：透明底 + 真圆角（画在面板底色上，圆角才看得见）。
 *
 * 出图宽度按 800px 走（540 宽的版式约 1.48 倍），不再固定 320：
 * 预览框在 1180px 面板里占 ~400 CSS px，2 倍屏要 800 设备像素才不糊。
 * 320 宽时「圆角 24px」只剩 14 像素、回形针只有 18 像素宽，
 * 用户会觉得"调了没反应"——不是没生效，是看不清。
 */
export async function renderPagePreview(
  page: CardPage,
  size: CardSize,
  tpl: CardTemplate,
  hooks?: RenderHooks,
): Promise<string> {
  const css = stylesheetFor(tpl)
  const scale = Math.min(2, 800 / size.w)
  const out = await captureCard(pageAsFragment(page, size, tpl), size, {
    scale,
    backdrop: 'transparent',
    css,
  })
  hooks?.onReport?.(out.report)
  try {
    return out.canvas.toDataURL('image/png')
  } finally {
    releaseCanvas(out.canvas)
  }
}
