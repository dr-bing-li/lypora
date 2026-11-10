// Lypora — Electron 预加载脚本
// 只暴露白名单能力，渲染进程拿不到 Node API（contextIsolation: true）
const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('lyporaDesktop', {
  platform: process.platform,
  version: process.versions.electron,

  /** 打开单个文件 → { name, path, content } | null */
  openFile: () => ipcRenderer.invoke('file:open'),
  /** 按路径读取 → { name, path, content } | { error } */
  readFile: (filePath) => ipcRenderer.invoke('file:read', filePath),
  /** 保存；filePath 为空则弹另存为 → { path, name } | null */
  saveFile: (content, filePath, suggestedName) =>
    ipcRenderer.invoke('file:save', { content, filePath, suggestedName }),
  /** 二进制另存为（PNG / PDF / ZIP）→ { path, name } | null */
  saveBinary: (data, suggestedName, mime) =>
    ipcRenderer.invoke('file:save-binary', { data, suggestedName, mime }),
  /** 打开文件夹工作区 → 目录树 | null */
  openDirectory: () => ipcRenderer.invoke('dir:open'),
  /** 在资源管理器中定位文件 */
  revealInFolder: (filePath) => ipcRenderer.invoke('shell:reveal', filePath),
  /** 应用信息 */
  appInfo: () => ipcRenderer.invoke('app:info'),

  /**
   * 拖放文件 → 磁盘绝对路径。
   * Electron 32 起 File.path 被移除，只能走 webUtils.getPathForFile。
   * 拿不到（非本地文件 / 剪贴板）时返回空串，渲染层据此降级为内嵌 base64。
   */
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || ''
    } catch {
      return ''
    }
  },
  /** 把图片复制到文档同级的附件目录 → { rel, abs, copied, renamed } | { error } */
  placeImage: (payload) => ipcRenderer.invoke('image:place', payload),
  /**
   * 剪贴板里的位图 → 已落盘的临时 PNG（{ path, name, width, height } | null）。
   * 位图型剪贴板没有磁盘路径，渲染层靠这个换取真实路径，才能走路径模式而不是内嵌 base64。
   */
  readClipboardImage: (opts) => ipcRenderer.invoke('clipboard:read-image', opts),

  /** 主进程转发"用本应用打开文件"（双击 md 文件 / 命令行参数） */
  onOpenPath: (cb) => {
    ipcRenderer.on('app:open-path', (_e, payload) => cb(payload))
  },
})
