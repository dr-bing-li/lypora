/**
 * 二进制产物落盘 —— 三条通路，与 io/files.ts 的降级顺序一致：
 *   ① Electron 桥 `file:save-binary`：原生「另存为」对话框，用户自己选位置（桌面唯一正确做法）
 *   ② Capacitor Filesystem + Share：写进应用 Documents 目录再拉起分享面板（Android 唯一正确做法）
 *   ③ 浏览器 `<a download>`：纯 Web 调试与 PWA 场景
 *
 * 为什么不复用 downloadBlob：它只处理文本，`<a download>` 在 Android WebView 里
 * 根本不落地，桌面 Electron 里则会静默存到默认下载目录 —— 对"导出图片/PDF"这种
 * 用户要立刻拿走的东西，两条都不合格。
 */

import { isNative } from '../io/native'
import { shareBinary } from '../io/native'

interface DesktopBinaryBridge {
  saveBinary?(data: Uint8Array, suggestedName: string, mime: string): Promise<{ path: string; name: string } | null>
}

function desktop(): DesktopBinaryBridge | null {
  const b = (window as unknown as { lyporaDesktop?: DesktopBinaryBridge }).lyporaDesktop
  return b && typeof b.saveBinary === 'function' ? b : null
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => {
      const s = String(fr.result)
      const comma = s.indexOf(',')
      resolve(comma >= 0 ? s.slice(comma + 1) : s)
    }
    fr.onerror = () => reject(fr.error)
    fr.readAsDataURL(blob)
  })
}

export interface SaveBinaryResult {
  ok: boolean
  /** 失败原因是用户主动取消（不该弹错误提示） */
  canceled?: boolean
  path?: string
}

export async function saveBinary(blob: Blob, filename: string, mime: string): Promise<SaveBinaryResult> {
  const bridge = desktop()
  if (bridge?.saveBinary) {
    try {
      const buf = new Uint8Array(await blob.arrayBuffer())
      const r = await bridge.saveBinary(buf, filename, mime)
      return r ? { ok: true, path: r.path } : { ok: false, canceled: true }
    } catch {
      return { ok: false }
    }
  }

  if (isNative()) {
    try {
      const b64 = await toBase64(blob)
      const r = await shareBinary(filename, b64, mime)
      return r.ok ? { ok: true, path: r.path } : { ok: false }
    } catch {
      return { ok: false }
    }
  }

  try {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 8000)
    return { ok: true }
  } catch {
    return { ok: false }
  }
}
