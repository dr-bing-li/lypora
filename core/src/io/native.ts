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

import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'

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
  const base = (raw || '未命名.md')
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
      dialogTitle: '导出 / Export',
    })
    return { ok: true, path }
  } catch {
    return { ok: false }
  }
}

/** 直接打开系统文件选择器外的兜底：把内容写进应用目录后返回其 URI */
export async function localUri(name: string, content: string): Promise<string | null> {
  try {
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
