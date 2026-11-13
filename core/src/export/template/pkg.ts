/**
 * 样式包（`.zip`）—— 模板 JSON + 背景图 + 印章图打成一个可分享的文件。
 *
 * 为什么不再只用单文件 `.lyt.json`：模板里能塞两张图（背景、印章），
 * 每张都是 base64 内联的，导出的 JSON 动辄 2–3MB，还肉眼看不懂哪段是哪张图。
 * 打包成 zip 后：`template.json` 只有几 KB（图片字段写成 `@bg.png` 这样的引用），
 * 两张图是真正的 PNG 文件，用户能直接打开看、替换掉再传回来。
 *
 * 兼容性：**旧的单文件 `.lyt.json` 继续能导入**（看文件头是不是 PK\x03\x04 来分流），
 * 导出统一走 `.zip` —— 两条路都保留会让"我上次导出的那个文件怎么导不回来"变成常见问题。
 */

import { buildZip } from '../card-capture'
import { looksLikeZip, unzip } from '../zip-read'
import { BUILTIN_TEMPLATES } from './builtin'
import { exportTemplate, importTemplate, type ImportResult } from './io'
import type { CardTemplate } from './types'

const DATA_URL = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/

const EXT: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }

function dataUrlToFile(url: string, base: string): { name: string; data: Uint8Array } | null {
  const m = DATA_URL.exec(url.trim())
  if (!m) return null
  const bin = atob(m[2])
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return { name: `${base}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`, data: bytes }
}

function fileToDataUrl(name: string, data: Uint8Array): string {
  const ext = (name.split('.').pop() ?? 'png').toLowerCase()
  const mime = EXT[ext] ?? 'image/png'
  let bin = ''
  // 逐块转字符串：一次 apply 传几万个参数会爆栈（2MB 图约有 2M 个字节）
  const CHUNK = 0x8000
  for (let i = 0; i < data.length; i += CHUNK) bin += String.fromCharCode(...data.subarray(i, i + CHUNK))
  return `data:${mime};base64,${btoa(bin)}`
}

/** 把模板打成样式包；图片从 JSON 里抽成独立文件，JSON 只留 `@bg.png` 这样的引用 */
export async function exportPackage(t: CardTemplate): Promise<{ blob: Blob; name: string }> {
  const plain = JSON.parse(exportTemplate(t)) as CardTemplate
  const entries: { name: string; data: Uint8Array }[] = []
  const enc = new TextEncoder()

  const bg = t.decor.bgImage ? dataUrlToFile(t.decor.bgImage, 'bg') : null
  if (bg) {
    entries.push(bg)
    plain.decor.bgImage = `@${bg.name}`
  }
  const stamp = t.decor.stampImage ? dataUrlToFile(t.decor.stampImage, 'stamp') : null
  if (stamp) {
    entries.push(stamp)
    plain.decor.stampImage = `@${stamp.name}`
  }

  const readme =
    `Lypora 样式包\n` +
    `\n` +
    `template.json  模板本体（schema ${plain.schema}）\n` +
    `bg.png         背景图（可选，对应 decor.bgImage 的 @bg.png）\n` +
    `stamp.png      印章图（可选，对应 decor.stampImage 的 @stamp.png）\n` +
    `\n` +
    `改完把整个文件夹重新压成 zip 即可导入 Lypora（排版 → 导入样式包）。\n` +
    `占位符：页眉页脚支持 {doc} {sec} {date} {page} {total}。\n`

  entries.push({ name: 'template.json', data: enc.encode(JSON.stringify(plain, null, 2)) })
  entries.push({ name: 'README.txt', data: enc.encode(readme) })

  const blob = buildZip(entries)
  const safe = (t.name || t.id).replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40)
  return { blob, name: `${safe || 'lypora-template'}.zip` }
}

/**
 * 导入样式包。zip 与旧版单文件 .lyt.json 都能吃。
 * `@name` 引用在这里解析成 data URL：zip 里找不到对应文件时该字段留空（用默认值）。
 */
export async function importPackage(file: File, existingIds: string[]): Promise<ImportResult> {
  const buf = await file.arrayBuffer()
  const head = new Uint8Array(buf.slice(0, 4))

  if (!looksLikeZip(head)) {
    // 旧路径：单个 JSON 文件
    const text = new TextDecoder('utf-8').decode(new Uint8Array(buf))
    return importTemplate(text, existingIds)
  }

  let files: { name: string; data: Uint8Array }[]
  try {
    files = await unzip(buf)
  } catch (e) {
    return { ok: false, reason: String((e as Error).message || e) }
  }
  const byName = new Map(files.map((f) => [f.name.split('/').pop() ?? f.name, f]))

  const tplEntry = files.find((f) => /(^|\/)template\.json$/i.test(f.name)) ?? files.find((f) => /\.json$/i.test(f.name))
  if (!tplEntry) return { ok: false, reason: 'zip-no-template-json' }

  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(new TextDecoder('utf-8').decode(tplEntry.data)) as Record<string, unknown>
  } catch {
    return { ok: false, reason: 'invalid-json' }
  }

  const decor = raw.decor as Record<string, unknown> | undefined
  if (decor) {
    for (const key of ['bgImage', 'stampImage'] as const) {
      const v = decor[key]
      if (typeof v !== 'string' || !v.startsWith('@')) continue
      const hit = byName.get(v.slice(1))
      decor[key] = hit ? fileToDataUrl(hit.name, hit.data) : ''
    }
  }

  const res = importTemplate(JSON.stringify(raw), existingIds)
  return res
}

/** 面板里「下载范例」用的两个包：一个纯预设（无图），一个带印章 + 纸纹 */
export async function buildSamplePackage(id: string): Promise<{ blob: Blob; name: string }> {
  const t = BUILTIN_TEMPLATES.find((x) => x.id === id) ?? BUILTIN_TEMPLATES[0]
  return exportPackage(t)
}
