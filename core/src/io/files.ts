/**
 * 文件与目录 IO 适配层 —— 对应 docs/02 §5.1「能力适配」
 * 四条通路，能力探测后按优先级降级：
 *   ① Electron 预加载桥（window.lyporaDesktop）—— 桌面版，原生对话框 + 完整目录树
 *   ② Capacitor Filesystem —— Android / iOS 壳，写应用专属 Documents 目录 + 系统分享面板
 *   ③ File System Access API —— 桌面 Chrome/Edge、Android Chrome
 *   ④ <input type="file"> + Blob 下载 —— 旧浏览器、iOS 部分场景
 *
 * 为什么原生放在 FSA 之前：Android WebView 里 showSaveFilePicker / showDirectoryPicker
 * 都不实现（hasFSA() 为 false 时才会落到这里），但即便某些 WebView 版本暴露了，
 * 拿到的句柄在进程回收后也失效 —— 原生目录是更可靠的落点。
 */

import { isNative, nativePlatform, readDoc, safeName, shareFile, writeDoc } from './native'

export interface OpenResult {
  name: string
  content: string
  handle?: FileSystemFileHandle
  path?: string
}

export interface SaveTarget {
  handle?: FileSystemFileHandle
  path?: string
}

export interface SaveResult {
  name: string
  handle?: FileSystemFileHandle
  path?: string
}

export interface WorkspaceEntry {
  label: string
  open: () => Promise<OpenResult | null>
}

const MD_EXT = /\.(md|markdown|mdown|mkd|txt)$/i

/* ---------------- Electron 桥类型 ---------------- */

interface DesktopBridge {
  platform: string
  openFile(): Promise<{ name: string; path: string; content: string } | null>
  readFile(p: string): Promise<{ name: string; path: string; content: string } | { error: string }>
  saveFile(
    content: string,
    filePath?: string,
    suggestedName?: string,
  ): Promise<{ path: string; name: string } | null>
  openDirectory(): Promise<DirNode | null>
  revealInFolder(p: string): void
  onOpenPath(cb: (p: { name: string; path: string; content: string }) => void): void
}

interface DirNode {
  name: string
  path: string
  dirs: DirNode[]
  files: Array<{ name: string; path: string; rel: string }>
}

declare global {
  interface Window {
    lyporaDesktop?: DesktopBridge
    /** 关闭守卫：主进程关窗前询问渲染层的脏状态（见 desktop/main.js） */
    __lyporaCloseState?: () => { dirty: boolean; name: string }
    /** 关闭守卫：主进程确认"保存并退出"后调用，返回 ok=false 表示保存被取消/失败 */
    __lyporaSaveAndClose?: () => Promise<{ ok: boolean; cancelled?: boolean; error?: string }>
  }
}

export function desktop(): DesktopBridge | undefined {
  return typeof window !== 'undefined' ? window.lyporaDesktop : undefined
}

function hasFSA(): boolean {
  return typeof (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker === 'function'
}

/* ---------------- 打开 ---------------- */

export async function openFile(): Promise<OpenResult | null> {
  const bridge = desktop()
  if (bridge) {
    const res = await bridge.openFile()
    return res ? { name: res.name, content: res.content, path: res.path } : null
  }

  // Android/iOS：WebView 的 <input type=file> 由系统文件选择器接管（Capacitor 已实现
  // onShowFileChooser），读进来先当内存文档，保存时落到应用 Documents 目录一份。
  if (isNative()) {
    const picked = await openFileViaInput()
    if (picked) picked.path = `${nativePlatform()}://${picked.name}`
    return picked
  }

  if (hasFSA()) {
    try {
      const [handle] = await (
        window as never as { showOpenFilePicker: (o: unknown) => Promise<FileSystemFileHandle[]> }
      ).showOpenFilePicker({
        types: [
          {
            description: 'Markdown 文档',
            accept: {
              'text/markdown': ['.md', '.markdown', '.mdown', '.mkd'],
              'text/plain': ['.txt'],
            },
          },
        ],
        multiple: false,
      })
      const file = await handle.getFile()
      return { name: file.name, content: await file.text(), handle }
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return null
      // API 存在但被拒绝 → 继续降级
    }
  }

  return openFileViaInput()
}

function openFileViaInput(): Promise<OpenResult | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.md,.markdown,.mdown,.mkd,.txt,text/markdown,text/plain'
    input.style.display = 'none'
    document.body.appendChild(input)
    input.addEventListener('change', async () => {
      const f = input.files?.[0]
      input.remove()
      if (!f) return resolve(null)
      resolve({ name: f.name, content: await f.text() })
    })
    input.addEventListener('cancel', () => {
      input.remove()
      resolve(null)
    })
    input.click()
  })
}

/* ---------------- 保存 ---------------- */

export async function saveFile(
  content: string,
  suggestedName: string,
  target?: SaveTarget,
): Promise<SaveResult | null> {
  const bridge = desktop()
  if (bridge) {
    const res = await bridge.saveFile(content, target?.path, suggestedName)
    return res ? { name: res.name, path: res.path } : null
  }

  // 原生壳：写进应用专属 Documents 目录（无需运行时权限，卸载即清）。
  // target.path 形如 `android://名称.md` 或 `Lypora/名称.md`，取末段当文件名。
  if (isNative()) {
    const name = target?.path ? target.path.split('/').pop() || suggestedName : suggestedName
    const saved = await writeDoc(name, content)
    return { name: safeName(name), path: saved.path }
  }

  if (target?.handle) {
    try {
      const w = await target.handle.createWritable()
      await w.write(content)
      await w.close()
      return { handle: target.handle, name: target.handle.name }
    } catch {
      /* 落回另存为 */
    }
  }

  if (
    typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function'
  ) {
    try {
      const h = await (
        window as never as { showSaveFilePicker: (o: unknown) => Promise<FileSystemFileHandle> }
      ).showSaveFilePicker({
        suggestedName,
        types: [{ description: 'Markdown 文档', accept: { 'text/markdown': ['.md'] } }],
      })
      const w = await h.createWritable()
      await w.write(content)
      await w.close()
      return { handle: h, name: h.name }
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return null
    }
  }

  downloadBlob(content, suggestedName, 'text/markdown;charset=utf-8')
  return { name: suggestedName }
}

export function downloadBlob(content: string, filename: string, mime: string): void {
  // 原生壳里 <a download> 不落地（WebView 没有下载管理器接管），改走写文件 + 系统分享面板，
  // 用户可以直接存到「文件」或发到微信/邮件。这是 Android 上唯一可靠的"交出去"通路。
  if (isNative()) {
    void shareFile(filename, content, mime)
    return
  }
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

/* ---------------- 工作区 ----------------
 * 统一成"标签 + 打开函数"的扁平列表，桌面桥与浏览器句柄两种来源同构。
 */

export async function openWorkspace(): Promise<{ root: string; entries: WorkspaceEntry[] } | null> {
  const bridge = desktop()
  if (bridge) {
    const node = await bridge.openDirectory()
    if (!node) return null
    const entries: WorkspaceEntry[] = []
    const walk = (n: DirNode) => {
      for (const f of n.files) {
        entries.push({
          label: f.rel,
          open: async () => {
            const res = await bridge.readFile(f.path)
            if ('error' in res) return null
            return { name: res.name, content: res.content, path: res.path }
          },
        })
      }
      for (const d of n.dirs) walk(d)
    }
    walk(node)
    return { root: node.name, entries }
  }

  if (
    typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker !== 'function'
  ) {
    return null
  }
  try {
    const dir = await (
      window as never as {
        showDirectoryPicker: (o: unknown) => Promise<FileSystemDirectoryHandle>
      }
    ).showDirectoryPicker({ mode: 'readwrite' })

    const entries: WorkspaceEntry[] = []
    const collect = async (d: FileSystemDirectoryHandle, prefix: string, depth: number) => {
      for await (const entry of (
        d as unknown as { values: () => AsyncIterable<FileSystemHandle> }
      ).values()) {
        if (entry.name.startsWith('.')) continue
        if (entry.kind === 'file') {
          if (!MD_EXT.test(entry.name)) continue
          const fh = entry as FileSystemFileHandle
          entries.push({
            label: prefix + entry.name,
            open: async () => {
              const f = await fh.getFile()
              return { name: f.name, content: await f.text(), handle: fh }
            },
          })
        } else if (depth < 2) {
          await collect(entry as FileSystemDirectoryHandle, prefix + entry.name + '/', depth + 1)
        }
      }
    }
    await collect(dir, '', 0)
    entries.sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))
    return { root: dir.name, entries }
  } catch {
    return null
  }
}
