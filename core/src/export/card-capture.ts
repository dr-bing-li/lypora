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
 * PDF 与 ZIP 都是自研写入器（DCTDecode 直通 / store 模式），不引第三方库。
 */

import { KATEX_CSS } from '../io/katex-inline'
import type { CardPage } from './card-layout'
import { pageAsFragment } from './card-layout'
import type { CardSize } from './card-themes'
import type { CardTemplate } from './template/types'
import { stylesheetFor } from './template/compile'

/* ------------------------------------------------------------------ *
 * 图片内联
 * ------------------------------------------------------------------ */

async function imageToDataUrl(src: string): Promise<string | null> {
  if (!src || src.startsWith('data:')) return src || null
  try {
    const res = await fetch(src)
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
  // 等解码完成，否则 foreignObject 里可能是空白占位
  await Promise.all(imgs.map((img) => (img.decode ? img.decode().catch(() => undefined) : Promise.resolve())))
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
  /** 卡片外的底色（圆角处会露出） */
  backdrop: string
  /** 当前模板编译出的样式（骨架 + 变量），必须与预览、测量用同一份 */
  css: string
}

export async function captureCard(fragmentHtml: string, size: CardSize, opts: CaptureOptions): Promise<HTMLCanvasElement> {
  // 离屏宿主：必须在文档里才能布局与加载图片
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-30000px;top:0;pointer-events:none;opacity:0'
  host.innerHTML = `<style>${opts.css}</style>${fragmentHtml}`
  document.body.appendChild(host)

  const card = host.querySelector('.ly-card') as HTMLElement
  // 圆角在导出时会被底色裁出黑边，直接归零（PNG 是矩形交付物）
  card.style.borderRadius = '0'
  card.style.boxShadow = 'none'

  const { restore, blocked } = await inlineImages(card)
  // 拉不到的图片（CORS / file:// 被拦）必须摘掉：留在 SVG 里会让 canvas 被标记
  // 为 tainted，toDataURL 直接抛 SecurityError，整张卡片报废
  for (const img of blocked) img.remove()

  const w = size.w
  const h = size.h
  const xhtml = new XMLSerializer().serializeToString(card)

  // 公式样式必须跟着走：KaTeX 的 HTML 没有 CSS 就退化成"平铺文字"
  // （∫₀¹ 会变成 ∫01，上标全部掉到基线上）。没有公式就不塞，省 360KB。
  const mathCss = fragmentHtml.includes('class="katex') ? KATEX_CSS : ''

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<foreignObject x="0" y="0" width="100%" height="100%">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${w}px;height:${h}px">` +
    `<style>${opts.css}${mathCss}</style>${xhtml}` +
    `</div></foreignObject></svg>`

  // 必须用 data URI：blob: 作为 <img> 源时 Chromium 会把画到 canvas 的结果标成
  // tainted，toDataURL 抛 SecurityError（实测 Edge/Chromium 均如此）
  const svgUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)

  const img = new Image()
  img.decoding = 'sync'
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => {
      // 定位用：SVG 加载失败时把 XML 解析器的报错带出来
      let diag = ''
      try {
        const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
        const pe = doc.querySelector('parsererror')
        diag = pe ? (pe.textContent || '').replace(/\s+/g, ' ').slice(0, 240) : 'no-parsererror'
      } catch (e) {
        diag = String(e)
      }
      reject(new Error(`card-svg-load-failed (${svg.length}B): ${diag}`))
    }
    img.src = svgUrl
  })

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w * opts.scale)
  canvas.height = Math.round(h * opts.scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas-2d-unavailable')
  ctx.fillStyle = opts.backdrop
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

  restore()
  host.remove()
  return canvas
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png', quality = 0.94): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas-encode-failed'))), type, quality)
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

/** 逐页渲染成 PNG（每页一个文件） */
export async function renderPagesToPng(
  pages: CardPage[],
  size: CardSize,
  tpl: CardTemplate,
  backdrop: string,
): Promise<RenderResult> {
  const css = stylesheetFor(tpl)
  const blobs: Blob[] = []
  for (const page of pages) {
    const canvas = await captureCard(pageAsFragment(page, size, tpl), size, { scale: size.scale, backdrop, css })
    blobs.push(await canvasToBlob(canvas, 'image/png'))
  }
  return { blobs, size }
}

/** 逐页渲染后拼成一份 PDF */
export async function renderPagesToPdf(pages: CardPage[], size: CardSize, tpl: CardTemplate, backdrop: string): Promise<Blob> {
  const css = stylesheetFor(tpl)
  const imgs: PdfImagePage[] = []
  for (const page of pages) {
    const canvas = await captureCard(pageAsFragment(page, size, tpl), size, { scale: size.scale, backdrop, css })
    imgs.push({ jpeg: await canvasToJpeg(canvas), pxW: canvas.width, pxH: canvas.height })
  }
  return buildPdf(imgs, size.w * 0.75, size.h * 0.75)
}

/** 面板预览：低倍率出图，避免每次调参数都等 2 倍图 */
export async function renderPagePreview(page: CardPage, size: CardSize, tpl: CardTemplate, backdrop: string): Promise<string> {
  const css = stylesheetFor(tpl)
  const scale = Math.min(1, 320 / size.w)
  const canvas = await captureCard(pageAsFragment(page, size, tpl), size, { scale, backdrop, css })
  return canvas.toDataURL('image/png')
}
