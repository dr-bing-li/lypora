/**
 * 原生（Capacitor）能力桥 —— 只在 Android/iOS 壳里生效，Web 构建下所有函数直接返回 false/null。
 *
 * 为什么单独一层：
 *   io/files.ts 的职责是「按能力降级选通路」，不该关心某个原生插件叫什么；
 *   这里把插件调用、路径约定、编码细节收在一起，files.ts 只问三件事：
 *   是不是原生？能不能列目录？能不能分享？
 *
 * Android 上的存储位置：
 *   `Directory.Documents` → Context.getExternalFilesDir(DIRECTORY_DOCUMENTS)
 *   即 `/storage/emulated/0/Android/data/app.lypora.editor/files/Documents/Lypora/`
 *   这条路不需要任何运行时权限（Android 10 起 app-specific 目录天然可写），
 *   代价是卸载应用即删除，用户要拿走文件得走「分享」面板（见 shareFile）。
 */

import { Capacitor, registerPlugin } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { t } from '../i18n'

/** 应用自己的文稿目录（相对 Directory.Documents） */
const APP_DIR = 'Lypora'

export type NativePlatform = 'android' | 'ios' | 'web'

export function nativePlatform(): NativePlatform {
  const p = Capacitor.getPlatform()
  return p === 'android' || p === 'ios' ? p : 'web'
}

export function isNative(): boolean {
  return nativePlatform() !== 'web'
}

/** 原生壳里才需要关心的能力开关 */
export function hasNativeFs(): boolean {
  return isNative() && Capacitor.isPluginAvailable('Filesystem')
}

function joinPath(name: string): string {
  return `${APP_DIR}/${name}`
}

/** 把文件名规范成单层、无路径分隔符、带 .md 后缀 */
export function safeName(raw: string): string {
  const base = (raw || t('app.untitled'))
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/^[.\s]+/, '')
    .trim()
  const withExt = /\.[a-z0-9]{1,8}$/i.test(base) ? base : `${base}.md`
  return withExt.slice(0, 120)
}

async function ensureDir(): Promise<void> {
  try {
    await Filesystem.mkdir({ path: APP_DIR, directory: Directory.Documents, recursive: true })
  } catch {
    /* 已存在 */
  }
}

/** 写入（覆盖）一份文稿，返回设备上的相对路径 */
export async function writeDoc(name: string, content: string): Promise<{ path: string }> {
  await ensureDir()
  const file = safeName(name)
  await Filesystem.writeFile({
    path: joinPath(file),
    data: content,
    directory: Directory.Documents,
    encoding: Encoding.UTF8,
    recursive: true,
  })
  return { path: `${APP_DIR}/${file}` }
}

/** 读取应用目录下的一份文稿；不存在返回 null */
export async function readDoc(name: string): Promise<string | null> {
  try {
    const res = await Filesystem.readFile({
      path: joinPath(safeName(name)),
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
    })
    return typeof res.data === 'string' ? res.data : null
  } catch {
    return null
  }
}

export interface NativeDocEntry {
  name: string
  path: string
  mtime: number
}

/** 列出应用目录下的 .md 文稿（供「最近」视图与调试用） */
export async function listDocs(): Promise<NativeDocEntry[]> {
  if (!hasNativeFs()) return []
  try {
    await ensureDir()
    const res = await Filesystem.readdir({ path: APP_DIR, directory: Directory.Documents })
    const out: NativeDocEntry[] = []
    for (const f of res.files) {
      const name = f.name ?? ''
      if (!/\.(md|markdown|txt)$/i.test(name)) continue
      out.push({ name, path: `${APP_DIR}/${name}`, mtime: f.mtime ?? 0 })
    }
    return out.sort((a, b) => b.mtime - a.mtime)
  } catch {
    return []
  }
}

export async function deleteDoc(name: string): Promise<boolean> {
  try {
    await Filesystem.deleteFile({ path: joinPath(safeName(name)), directory: Directory.Documents })
    return true
  } catch {
    return false
  }
}

/**
 * 唤起系统分享面板 —— Android 上这是「把文件交出去」的唯一可靠通路：
 * 用户可以存到「文件」、发到微信/邮件、传到网盘。返回 false 表示用户取消或不可用。
 */
export async function shareFile(
  name: string,
  content: string,
  mime: string,
): Promise<{ ok: boolean; path?: string }> {
  if (!isNative()) return { ok: false }
  try {
    const { path } = await writeDoc(name, content)
    const uri = await Filesystem.getUri({ path, directory: Directory.Documents })
    await Share.share({
      title: name,
      url: uri.uri,
      dialogTitle: t('dock.export'),
    })
    return { ok: true, path }
  } catch {
    return { ok: false }
  }
}

/**
 * 二进制落盘 + 分享（PNG / PDF / ZIP 用）。
 * Capacitor 的 Filesystem 只认 UTF-8 文本或 base64，所以二进制统一走 base64，
 * 不传 encoding —— 传了 UTF8 会把图片写成一堆替换字符。
 */
export async function shareBinary(
  name: string,
  base64: string,
  mime: string,
): Promise<{ ok: boolean; path?: string }> {
  if (!isNative()) return { ok: false }
  try {
    await ensureDir()
    const file = safeName(name)
    await Filesystem.writeFile({
      path: joinPath(file),
      data: base64,
      directory: Directory.Documents,
      recursive: true,
    })
    const uri = await Filesystem.getUri({ path: joinPath(file), directory: Directory.Documents })
    await Share.share({ title: file, url: uri.uri, dialogTitle: t('dock.export') })
    return { ok: true, path: uri.uri }
  } catch {
    return { ok: false }
  }
}

/** 直接打开系统文件选择器外的兜底：把内容写进应用目录后返回其 URI */
export async function localUri(name: string, content: string): Promise<string | null> {  try {
    await writeDoc(name, content)
    const uri = await Filesystem.getUri({ path: joinPath(safeName(name)), directory: Directory.Documents })
    return uri.uri
  } catch {
    return null
  }
}

/** 设备上的绝对路径提示（用于 toast 告知用户文件落在哪） */
export async function docUri(name: string): Promise<string | null> {
  try {
    const { uri } = await Filesystem.getUri({ path: joinPath(safeName(name)), directory: Directory.Documents })
    return uri
  } catch {
    return null
  }
}

/* ---------------------------------------------------------------------------
 * 图片相对路径的基准目录
 *
 * 渲染侧解析 `![x](img/a.png)` 需要"文档所在目录"的绝对 URI，而装饰层是同步
 * 计算的，等不了 await。所以启动时预热一次、同步缓存：
 *   Directory.Documents/Lypora  →  file:///storage/emulated/0/Android/data/…/Documents/Lypora
 * 再交给 Capacitor.convertFileSrc() 换成 WebView 能访问的 http://localhost/_capacitor_file_/…
 * ------------------------------------------------------------------------- */

let appDirUri: string | null = null

export function appDirUriSync(): string | null {
  return appDirUri
}

export async function primeAppDirUri(): Promise<void> {
  if (!hasNativeFs()) return
  try {
    await ensureDir()
    const { uri } = await Filesystem.getUri({ path: APP_DIR, directory: Directory.Documents })
    appDirUri = uri
  } catch {
    /* 拿不到就退回"原样返回 src"，不影响其它功能 */
  }
}

/**
 * 把一段 base64 写进 Documents 下的相对路径（图片落盘用）。
 * Android 上拖进来的 File 没有真实路径，只能走这条路。
 */
export async function writeImageFile(relPath: string, base64: string): Promise<string | null> {
  if (!hasNativeFs()) return null
  try {
    await Filesystem.writeFile({
      path: relPath,
      data: base64,
      directory: Directory.Documents,
      recursive: true,
    })
    return relPath
  } catch {
    return null
  }
}

/** 某个相对路径在 Documents 下是否已存在（附件目录探测用） */
export async function existsUnderDocs(relPath: string): Promise<boolean> {
  if (!hasNativeFs()) return false
  try {
    await Filesystem.stat({ path: relPath, directory: Directory.Documents })
    return true
  } catch {
    return false
  }
}

/* ---------------------------------------------------------------------------
 * 「打开方式 / 分享」接收通道（Android IntentPipe 插件）
 *
 * 系统把 .md/.txt 用 Lypora 打开（ACTION_VIEW），或从分享面板发来文本/文件
 * （ACTION_SEND）时，原生层把 {action,name,content,source} 暂存进 IntentPipe；
 * 这里提供两个入口给 main.ts：
 *   - consumeIncomingIntent()：冷启动兜底，boot 时领走暂存 payload
 *   - bindIncomingIntent()：  热启动，原生直接派发 window 'lyporaIntent' 事件
 * ------------------------------------------------------------------------- */

interface IntentPipePluginShape {
  getPending(): Promise<{ payload: string | null }>
}

const IntentPipe = registerPlugin<IntentPipePluginShape>('IntentPipe')

export interface IncomingIntent {
  action: string
  name: string
  content: string
  source?: string
}

function normalizeIntentDetail(raw: unknown): IncomingIntent | null {
  let d: any = raw
  if (typeof d === 'string') {
    try {
      d = JSON.parse(d)
    } catch {
      return null
    }
  }
  if (!d || typeof d !== 'object' || typeof d.content !== 'string') return null
  return {
    action: typeof d.action === 'string' ? d.action : '',
    name: typeof d.name === 'string' && d.name ? d.name : t('app.untitled'),
    content: d.content,
    source: typeof d.source === 'string' ? d.source : undefined,
  }
}

/** 冷启动：从原生暂存区领走 payload（领走即清空） */
export async function consumeIncomingIntent(): Promise<IncomingIntent | null> {
  if (!isNative()) return null
  try {
    const { payload } = await IntentPipe.getPending()
    return normalizeIntentDetail(payload)
  } catch {
    return null
  }
}

/** 热启动：监听原生派发的 window 事件 */
export function bindIncomingIntent(handler: (d: IncomingIntent) => void): void {
  if (!isNative()) return
  window.addEventListener('lyporaIntent', (e) => {
    const d = normalizeIntentDetail((e as CustomEvent).detail)
    if (d) handler(d)
  })
}

/* ---------------------------------------------------------------------------
 * 输入法唤起（Android Ime 插件）
 *
 * 为什么需要：Android 一旦探测到物理键盘（平板接了蓝牙键盘就是这样），默认不再弹
 * 软键盘，输入法切到「物理键盘直通」模式 —— 按 a 就送 KEYCODE_A，中文组词引擎不启动，
 * 于是只能打英文。系统里那个「显示虚拟键盘」开关藏在开发者/语言设置深处，应用内必须
 * 自己给一个入口，否则用户无路可走。
 *
 * 只在 Android 上有效；其他平台一律返回 false，调用方不必分平台判断。
 * ------------------------------------------------------------------------- */

interface ImePluginShape {
  show(): Promise<{ requested: boolean; visible: boolean; hardwareKeyboard: boolean }>
  info(): Promise<{ visible: boolean; hardwareKeyboard: boolean }>
}

const Ime = registerPlugin<ImePluginShape>('Ime')

export interface ImeState {
  /** 软键盘（或输入法候选窗）当前是否接受文本 */
  visible: boolean
  /** 是否接着物理键盘 */
  hardwareKeyboard: boolean
}

const IME_IDLE: ImeState = { visible: false, hardwareKeyboard: false }

/**
 * 请出输入法。返回 true 表示输入法确实进入了可输入状态。
 * 失败通常是系统策略拦截（部分平板的「物理键盘时禁用屏幕键盘」），由调用方提示用户。
 */
export async function showIme(): Promise<boolean> {
  if (nativePlatform() !== 'android') return false
  try {
    const r = await Ime.show()
    return Boolean(r?.visible)
  } catch {
    return false
  }
}

/** 读一次输入环境快照，用于决定要不要提示「你接了键盘」 */
export async function imeInfo(): Promise<ImeState> {
  if (nativePlatform() !== 'android') return IME_IDLE
  try {
    const r = await Ime.info()
    return { visible: Boolean(r?.visible), hardwareKeyboard: Boolean(r?.hardwareKeyboard) }
  } catch {
    return IME_IDLE
  }
}
