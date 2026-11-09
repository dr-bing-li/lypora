/**
 * 图片插入管线 —— 新增图片（文件对话框 / 拖放）的唯一入口
 * ==========================================================================
 * 分流顺序（改这里之前先看 image-path.ts 头部的三个概念）：
 *
 *   ① 设置里选了「内嵌 base64」→ 全部转 data: URI 写进 markdown，路径策略不参与。
 *   ② 否则看「路径处理方式」：
 *        copy     → 复制到文档同级附件目录，正文写相对路径（默认）
 *        relative → 不复制，按源文件相对文档目录的路径写
 *        absolute → 不复制，写绝对路径
 *
 * 拿不到源文件路径时（浏览器拖放、Android 的 content:// 选择器）：
 *   不猜、不假装成功 —— 一律降级为内嵌 base64 并明确告知，因为"写一个指向不存在
 *   位置的相对路径"正是这个 bug 最初的样子。
 *
 * 剪贴板位图原本也在这条降级路上（截图不对应任何文件）。v0.8.1 起改由主进程
 * clipboard.readImage() 落成临时 PNG，再把路径经 ImageInput.srcPath 带进来，
 * 于是"复制到附件目录"这个默认模式对粘贴同样生效。
 * ==========================================================================
 */

import type { EditorView } from '@codemirror/view'
import { desktop } from './files'
import {
  assetDirCandidates,
  encodeRefPath,
  getImagePathMode,
  getImageRefMode,
  relativePath,
  stampPrefix,
} from './image-path'
import { existsUnderDocs, isNative, writeImageFile } from './native'

export interface InsertReport {
  /** 成功写进文档的图片数 */
  inserted: number
  /** 其中以 base64 内嵌的 */
  embedded: number
  /** 其中复制到附件目录的 */
  copied: number
  /** 其中写相对路径的 */
  relative: number
  /** 其中写绝对路径的 */
  absolute: number
  /** 因缺路径/缺文档路径而未插入的 */
  skipped: number
  /** 实际落盘的附件目录名（copy 模式） */
  dirName?: string
  /** 中止原因：文档未保存 / 目标不可写 */
  aborted?: 'no-doc' | 'failed'
  /** 拿不到源路径而降级内嵌过 */
  degraded?: boolean
}

const IMG_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i

/**
 * 一次插入的输入项。
 *
 * 绝大多数入口给的就是 `File`（选文件 / 拖放），源路径由 webUtils 反查。
 * 剪贴板是唯一的例外：位图 `File` 不对应任何磁盘文件，渲染层拿不到路径，
 * 只能请主进程把它落成临时 PNG，再把那个路径显式带进来 —— 否则默认的
 * 「复制到附件目录」模式会一路降级成内嵌 base64。
 */
export type ImageInput = File | { file: File; srcPath?: string }

function fileOf(x: ImageInput): File {
  return x instanceof File ? x : x.file
}

export function isImageFile(f: File): boolean {
  return (f.type && f.type.startsWith('image/')) || IMG_RE.test(f.name)
}

function fileToDataUrl(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(f)
  })
}

function altOf(f: File): string {
  return f.name || 'image'
}

/** markdown 里 alt 的方括号必须转义，否则 `a]b.png` 会把语法截断 */
function altEscaped(f: File): string {
  return altOf(f).replace(/([[\]])/g, '\\$1')
}

/**
 * 执行一次插入。files 可以是多选 / 多文件拖放，全部拼成一段一次 dispatch，
 * 这样撤销一次就回到插入之前（多次 dispatch 会拆成多个撤销步）。
 */
export async function insertImages(
  view: EditorView,
  files: ImageInput[],
  docPath: string | undefined,
  content: string,
  notify: (msg: string) => void,
  msg: {
    inserted: (n: number) => string
    copied: (n: number, dir: string) => string
    linked: (n: number, mode: string) => string
    needSave: string
    noPath: string
    failed: string
  },
): Promise<InsertReport> {
  const report: InsertReport = {
    inserted: 0,
    embedded: 0,
    copied: 0,
    relative: 0,
    absolute: 0,
    skipped: 0,
  }

  const images = files.filter((x) => isImageFile(fileOf(x)))
  if (!images.length) return report

  const refMode = getImageRefMode()
  const pathMode = getImagePathMode()
  const bridge = desktop()
  const candidates = assetDirCandidates(content)

  // 只在真正需要写盘时才要求文档已保存（绝对路径模式不依赖文档位置）
  const needsDocDir = refMode === 'reference' && (pathMode === 'copy' || pathMode === 'relative')
  if (needsDocDir && !docPath) {
    notify(msg.needSave)
    report.aborted = 'no-doc'
    return report
  }

  const parts: string[] = []
  let modeLabel: string = pathMode

  for (const input of images) {
    const f = fileOf(input)
    try {
      /* ---------------- ① 内嵌模式 ---------------- */
      if (refMode === 'embed') {
        const url = await fileToDataUrl(f)
        parts.push(`![${altEscaped(f)}](${url})`)
        report.embedded++
        continue
      }

      // 外部显式给的路径优先：剪贴板位图只能靠主进程落盘后带进来
      const explicit = input instanceof File ? '' : (input.srcPath ?? '')
      const srcPath = explicit || (bridge ? bridge.pathForFile(f) || '' : '')

      /* ---------------- ② 没有源路径：不猜，降级内嵌 ---------------- */
      if (!srcPath) {
        // Android 的 copy 模式还有一条路：把 File 内容写进 Documents（不需要源路径）
        if (isNative() && pathMode === 'copy' && docPath) {
          const dirName = await pickNativeDir(candidates)
          const ok = await writeNativeImage(f, dirName)
          if (ok) {
            parts.push(`![${altEscaped(f)}](./${encodeRefPath(`${dirName}/${ok}`)})`)
            report.copied++
            report.dirName = dirName
            modeLabel = 'copy'
            continue
          }
        }
        const url = await fileToDataUrl(f)
        parts.push(`![${altEscaped(f)}](${url})`)
        report.embedded++
        report.degraded = true
        continue
      }

      /* ---------------- ③ copy：复制到附件目录 ---------------- */
      if (pathMode === 'copy') {
        if (!bridge || !docPath) {
          // 非 Electron 且已排除 Android 分支（上面处理过）→ 降级
          const url = await fileToDataUrl(f)
          parts.push(`![${altEscaped(f)}](${url})`)
          report.embedded++
          report.degraded = true
          continue
        }
        const res = await bridge.placeImage({
          srcPath,
          docPath,
          candidates,
          // 剪贴板位图落盘时主进程用的是临时名，这里把用户看到的名字带过去
          preferredName: f.name,
        })
        if ('error' in res) {
          report.skipped++
          continue
        }
        parts.push(`![${altEscaped(f)}](./${encodeRefPath(res.rel)})`)
        report.copied++
        report.dirName = res.rel.includes('/') ? res.rel.slice(0, res.rel.indexOf('/')) : 'assets'
        modeLabel = 'copy'
        continue
      }

      /* ---------------- ④ relative：只写相对路径，不动文件 ---------------- */
      if (pathMode === 'relative') {
        const rel = docPath ? relativePath(srcPath, dirOf(docPath)) : null
        if (rel) {
          parts.push(`![${altEscaped(f)}](./${encodeRefPath(rel)})`)
          report.relative++
          modeLabel = 'relative'
          continue
        }
        // 跨盘无法相对化：退回绝对路径，并明确告知（这是唯一允许的"降级"）
        parts.push(`![${altEscaped(f)}](${encodeRefPath(srcPath.replace(/\\/g, '/'))})`)
        report.absolute++
        report.degraded = true
        modeLabel = 'absolute'
        continue
      }

      /* ---------------- ⑤ absolute ---------------- */
      parts.push(`![${altEscaped(f)}](${encodeRefPath(srcPath.replace(/\\/g, '/'))})`)
      report.absolute++
      modeLabel = 'absolute'
    } catch {
      report.skipped++
    }
  }

  if (!parts.length) {
    notify(msg.failed)
    report.aborted = 'failed'
    return report
  }

  const r = view.state.selection.main
  // 图片必须自成段落。光标落在行中间/行尾时直接插入会和既有文字粘成同一段
  // （渲染后两张图并排、或图和文字挤在一起），所以两侧按需补空行。
  const text = view.state.doc.toString()
  const lead = r.from > 0 && text[r.from - 1] !== '\n' ? '\n\n' : ''
  const tail = r.to < text.length && text[r.to] !== '\n' ? '\n\n' : ''
  const insert = lead + parts.join('\n\n') + tail
  view.dispatch({
    changes: { from: r.from, to: r.to, insert },
    selection: { anchor: r.from + insert.length },
    scrollIntoView: true,
  })
  report.inserted = parts.length

  if (report.degraded) notify(msg.noPath)
  if (report.copied && report.dirName) notify(msg.copied(report.copied, report.dirName))
  else if (report.embedded) notify(msg.inserted(report.embedded))
  else if (report.relative || report.absolute) notify(msg.linked(report.relative + report.absolute, modeLabel))

  return report
}

/** 取 `C:/a/b.md` 的目录；与 image-path.dirname 同义，这里单独放一个避免循环依赖 */
function dirOf(p: string): string {
  const s = p.replace(/\\/g, '/')
  const i = s.lastIndexOf('/')
  if (i < 0) return ''
  const head = s.slice(0, i)
  if (!head) return '/'
  return /^[a-zA-Z]:$/.test(head) ? head + '/' : head
}

/** Android：正文里出现过的附件目录优先，其次是默认三件套；取第一个已存在的 */
async function pickNativeDir(candidates: string[]): Promise<string> {
  for (const c of candidates) {
    if (!c || c.includes('..') || /[\\/]/.test(c)) continue
    if (await existsUnderDocs(`Lypora/${c}`)) return c
  }
  return 'assets'
}

/** Android：把 File 写成 Documents/Lypora/<dir>/<name>，重名加时间戳前缀 */
async function writeNativeImage(f: File, dirName: string): Promise<string | null> {
  const url = await fileToDataUrl(f)
  const comma = url.indexOf(',')
  if (comma < 0) return null
  const base64 = url.slice(comma + 1)
  let name = f.name || `image-${Date.now()}.png`
  if (await existsUnderDocs(`Lypora/${dirName}/${name}`)) name = `${stampPrefix()}-${name}`
  const ok = await writeImageFile(`Lypora/${dirName}/${name}`, base64)
  return ok ? name : null
}
