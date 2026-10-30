// Lypora — Electron 预加载脚本
// 只暴露白名单能力，渲染进程拿不到 Node API（contextIsolation: true）
const { contextBridge, ipcRenderer } = require('electron')

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
  /** 打开文件夹工作区 → 目录树 | null */
  openDirectory: () => ipcRenderer.invoke('dir:open'),
  /** 在资源管理器中定位文件 */
  revealInFolder: (filePath) => ipcRenderer.invoke('shell:reveal', filePath),
  /** 应用信息 */
  appInfo: () => ipcRenderer.invoke('app:info'),

  /** 主进程转发"用本应用打开文件"（双击 md 文件 / 命令行参数） */
  onOpenPath: (cb) => {
    ipcRenderer.on('app:open-path', (_e, payload) => cb(payload))
  },
})
