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
  /**
   * 失败发生在哪一步。手机上有必要分清楚：
   *   canceled → 分享面板被划走，文件其实已经写好了
   *   share    → 写好了但拉不起分享面板（目标 App 缺失、权限被拦）
   *   write    → 连文件都没写进去
   * 这三种在 v0.14.0 之前都显示「导出失败」，用户只能猜。
   */
  reason?: 'canceled' | 'write' | 'share'
}

export async function saveBinary(blob: Blob, filename: string, mime: string): Promise<SaveBinaryResult> {
  const bridge = desktop()
  if (bridge?.saveBinary) {
    try {
      const buf = new Uint8Array(await blob.arrayBuffer())
      const r = await bridge.saveBinary(buf, filename, mime)
      return r ? { ok: true, path: r.path } : { ok: false, canceled: true, reason: 'canceled' }
    } catch {
      return { ok: false, reason: 'write' }
    }
  }

  if (isNative()) {
    try {
      const b64 = await toBase64(blob)
      const r = await shareBinary(filename, b64, mime)
      // 插件在"分享面板被关掉"时是 reject 而不是 resolve —— 文件已经落盘，
      // 这种情况必须报成"取消"，不能报成失败（见 native.ts shareBinary）
      return { ok: r.ok, canceled: r.reason === 'canceled', path: r.path, reason: r.reason }
    } catch {
      return { ok: false, reason: 'write' }
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
    return { ok: false, reason: 'write' }
  }
}
