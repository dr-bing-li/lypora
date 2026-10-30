// Lypora — Electron 主进程
// 职责：窗口管理 / 文件对话框 / 文件读写 / 系统集成
// 对应 docs/02 §5.1 的「进程间通信」层：移动端由 Capacitor 或浏览器 API 承担同一接口。

const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')

const isDev = process.argv.includes('--dev')
const isSelfTest = process.argv.includes('--selftest')
/** --closetest=clean|dirty-discard|dirty-cancel|dirty-save：关窗流程验收（见 tools/closetest.mjs） */
const closeTestArg = process.argv.find((a) => a.startsWith('--closetest='))
const CLOSE_TEST = closeTestArg ? closeTestArg.slice('--closetest='.length) : null
/** 测试用旁路：跳过系统弹窗，直接采用指定选择 */
const closeChoiceArg = process.argv.find((a) => a.startsWith('--close-choice='))
const FORCED_CHOICE = closeChoiceArg ? closeChoiceArg.slice('--close-choice='.length) : null
let win = null
/** 关窗守卫：true 表示已获准关闭，close 事件直接放行 */
let allowClose = false
let askingClose = false

/**
 * 定位前端入口：两种部署形态都要能找到 index.html
 *  1) 开发/源码态：desktop/../core/dist/index.html
 *  2) 便携包：resources/app/web/index.html（由 tools/pack-win.mjs 拷贝而来）
 */
function resolveIndex() {
  const cands = [
    path.join(__dirname, 'web', 'index.html'),
    path.join(__dirname, '..', 'core', 'dist', 'index.html'),
  ]
  for (const c of cands) {
    try {
      if (require('node:fs').existsSync(c)) return c
    } catch {
      /* 忽略 */
    }
  }
  return cands[cands.length - 1]
}

const INDEX_HTML = resolveIndex()

function resolveIcon() {
  const cands = [
    path.join(__dirname, 'web', 'icons', 'icon-512.png'),
    path.join(__dirname, '..', 'core', 'dist', 'icons', 'icon-512.png'),
  ]
  for (const c of cands) {
    try {
      if (require('node:fs').existsSync(c)) return c
    } catch {
      /* 忽略 */
    }
  }
  return undefined
}

function createWindow() {
  win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 480,
    minHeight: 420,
    backgroundColor: '#ffffff',
    show: false,
    autoHideMenuBar: true,
    title: 'Lypora',
    icon: resolveIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  })

  win.once('ready-to-show', () => win.show())

  if (isDev) {
    win.loadURL('http://127.0.0.1:5183/index.html')
  } else {
    win.loadFile(INDEX_HTML)
  }

  // 外部链接用系统浏览器打开，不在应用内导航
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  /* ---------------- Ctrl+滚轮 / 双指捏合：缩放交给渲染层的字号逻辑 ----------------
   * Chromium 自带的页面级 zoom 会和"调字号"叠加（界面整体忽大忽小）。渲染层已经
   * 用 capture + preventDefault 拦了一手，这里再兜底：只要 zoomFactor 被改动就复位。
   */
  try {
    win.webContents.setVisualZoomLevelLimits(1, 1)
  } catch {
    /* 旧版 Electron 没有该方法 */
  }
  let zoomGuard = 0
  win.webContents.on('zoom-changed', () => {
    if (Date.now() < zoomGuard) return
    zoomGuard = Date.now() + 300
    win.webContents.setZoomFactor(1)
  })

  win.on('closed', () => {
    win = null
  })

  /* ---------------- 关窗守卫：点叉号必须能关，且先走"询问 → 保存" ----------------
   * 根因：以前只有渲染层的 beforeunload。Electron 遇到 beforeunload 里的
   * preventDefault 是**静默取消**关窗（不像浏览器会弹原生对话框），用户看到的就是
   * "点叉号没反应"。现在改由主进程统一处理：
   *   close 事件 → 问渲染层是否脏 → 原生三按钮对话框 → 需要保存就调渲染层保存 → 放行
   */
  win.on('close', (e) => {
    if (allowClose) return
    e.preventDefault()
    void closeGuard(win)
  })

  // 渲染层若仍挂着 beforeunload，在"已获准关闭"时放行，避免二次拦截
  win.webContents.on('will-prevent-unload', (e) => {
    if (allowClose) e.preventDefault()
  })

  if (isSelfTest) runSelfTest(win)
  if (CLOSE_TEST) runCloseTest(win, CLOSE_TEST)

  // 首次启动带文件参数：等渲染进程订阅好回调再投递
  const argvFile = process.argv.find((a) => /\.(md|markdown|mdown|mkd|txt)$/i.test(a))
  if (argvFile) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const content = await fs.readFile(argvFile, 'utf8')
          win.webContents.send('app:open-path', {
            name: path.basename(argvFile),
            path: argvFile,
            content,
          })
        } catch {
          /* 忽略 */
        }
      }, 400)
    })
  }
}


/* ---------------- 关闭流程 ---------------- */

async function closeGuard(w) {
  if (askingClose) return
  askingClose = true
  try {
    let state = { dirty: false, name: '' }
    try {
      state = await w.webContents.executeJavaScript(
        'window.__lyporaCloseState ? window.__lyporaCloseState() : { dirty: false, name: "" }',
      )
    } catch {
      /* 页面已崩：按"没有未保存内容"处理，保证能关掉 */
    }

    if (!state || !state.dirty) {
      allowClose = true
      w.close()
      return
    }

    let choice = FORCED_CHOICE
    if (choice !== 'save' && choice !== 'discard' && choice !== 'cancel') {
      const r = await dialog.showMessageBox(w, {
        type: 'warning',
        buttons: ['保存并退出', '不保存', '取消'],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
        title: 'Lypora',
        message: `是否保存对「${state.name || '当前文档'}」的更改？`,
        detail: '选择「不保存」会丢弃本次修改。',
      })
      choice = ['save', 'discard', 'cancel'][r.response] || 'cancel'
    }
    console.log('CLOSE_GUARD ' + JSON.stringify({ name: state.name, choice }))

    if (choice === 'cancel') return

    if (choice === 'save') {
      // 未命名文档会在这里弹"另存为"；用户取消 → 不关窗
      const res = await w.webContents.executeJavaScript(
        'window.__lyporaSaveAndClose ? window.__lyporaSaveAndClose() : { ok: false }',
      )
      if (!res || !res.ok) {
        console.log('CLOSE_ABORTED ' + JSON.stringify(res || {}))
        return
      }
    }

    allowClose = true
    w.close()
  } finally {
    askingClose = false
  }
}

/* ---------------- 关窗流程验收（--closetest=…） ---------------- */

function runCloseTest(w, mode) {
  const fsSync = require('node:fs')
  w.webContents.once('did-finish-load', async () => {
    const report = { mode, argvFile: process.argv.find((a) => /\.(md|markdown|mdown|mkd|txt)$/i.test(a)) || null }
    try {
      await new Promise((r) => setTimeout(r, 1600)) // 等示例/文件装载完成
      if (mode !== 'clean') {
        w.focus()
        w.webContents.focus()
        await new Promise((r) => setTimeout(r, 250))
        w.webContents.insertText('\n\nCLOSETEST_EDIT')
        await new Promise((r) => setTimeout(r, 500))
      }
      report.dirty = await w.webContents
        .executeJavaScript('!document.getElementById("dirty-dot").hidden')
        .catch(() => null)
      report.docTitle = await w.webContents
        .executeJavaScript('document.getElementById("doc-title").textContent')
        .catch(() => null)
      console.log('CLOSETEST_READY ' + JSON.stringify(report))
      w.close()
      setTimeout(() => {
        // 只有"取消"分支该走到这里
        console.log('CLOSETEST_STILL_ALIVE ' + JSON.stringify(report))
        const shot = process.argv.find((a) => a.startsWith('--shot='))
        if (shot) {
          w.webContents
            .capturePage()
            .then((img) => fsSync.writeFileSync(shot.slice('--shot='.length), img.toPNG()))
            .catch(() => {})
        }
        setTimeout(() => app.exit(4), 600)
      }, 3200)
    } catch (e) {
      console.log('CLOSETEST_ERROR ' + String(e && e.message ? e.message : e))
      app.exit(5)
    }
  })
}

/* ---------------- 自检模式（打包验收用，不影响正常启动） ---------------- */

async function runSelfTest(w) {
  const shotArg = process.argv.find((a) => a.startsWith('--shot='))
  const shotPath = shotArg ? shotArg.slice('--shot='.length) : null
  const consoleErrors = []
  w.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) consoleErrors.push(String(message).slice(0, 200))
  })

  const fail = (msg) => {
    console.log('SELFTEST_FAIL ' + msg)
    app.exit(1)
  }

  w.webContents.once('did-finish-load', async () => {
    try {
      await new Promise((r) => setTimeout(r, 1500))
      const probe = require('node:fs').readFileSync(path.join(__dirname, 'selftest-probe.js'), 'utf8')
      let metrics
      try {
        metrics = await w.webContents.executeJavaScript(probe)
      } catch (e) {
        // 注入失败时也要留下截图证据，便于定位
        metrics = { injectError: String(e && e.message ? e.message : e) }
      }

      const info = await w.webContents
        .executeJavaScript('window.lyporaDesktop ? window.lyporaDesktop.appInfo() : null')
        .catch((e) => ({ error: String(e && e.message ? e.message : e) }))

      let shot = null
      if (shotPath) {
        const img = await w.webContents.capturePage()
        require('node:fs').writeFileSync(shotPath, img.toPNG())
        shot = shotPath
      }

      const result = { ok: true, indexHtml: INDEX_HTML, metrics, appInfo: info, screenshot: shot, consoleErrors }
      console.log('SELFTEST_RESULT ' + JSON.stringify(result))
      app.exit(consoleErrors.length ? 2 : 0)
    } catch (e) {
      fail(String(e && e.message ? e.message : e))
    }
  })
}

/* ---------------- IPC：文件能力 ---------------- */

ipcMain.handle('file:open', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: '打开 Markdown 文档',
    properties: ['openFile'],
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] },
      { name: '纯文本', extensions: ['txt'] },
      { name: '全部文件', extensions: ['*'] },
    ],
  })
  if (res.canceled || !res.filePaths[0]) return null
  const filePath = res.filePaths[0]
  const content = await fs.readFile(filePath, 'utf8')
  return { name: path.basename(filePath), path: filePath, content }
})

ipcMain.handle('file:read', async (_e, filePath) => {
  try {
    const content = await fs.readFile(filePath, 'utf8')
    return { name: path.basename(filePath), path: filePath, content }
  } catch (err) {
    return { error: String(err && err.message ? err.message : err) }
  }
})

ipcMain.handle('file:save', async (_e, { content, filePath, suggestedName }) => {
  let target = filePath
  if (!target) {
    const res = await dialog.showSaveDialog(win, {
      title: '另存为',
      defaultPath: suggestedName || '未命名.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    })
    if (res.canceled || !res.filePath) return null
    target = res.filePath
  }
  await fs.writeFile(target, content, 'utf8')
  return { path: target, name: path.basename(target) }
})

ipcMain.handle('dir:open', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: '打开文件夹作为工作区',
    properties: ['openDirectory'],
  })
  if (res.canceled || !res.filePaths[0]) return null
  return listTree(res.filePaths[0], res.filePaths[0], 0)
})

async function listTree(root, dir, depth) {
  const out = { name: path.basename(dir), path: dir, dirs: [], files: [] }
  let entries = []
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (depth < 2) out.dirs.push(await listTree(root, full, depth + 1))
    } else if (/\.(md|markdown|mdown|mkd|txt)$/i.test(e.name)) {
      out.files.push({ name: e.name, path: full, rel: path.relative(root, full) })
    }
  }
  out.files.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  out.dirs.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  return out
}

ipcMain.handle('shell:reveal', (_e, filePath) => {
  if (filePath) shell.showItemInFolder(filePath)
})

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  electron: process.versions.electron,
}))

/* ---------------- 应用生命周期 ---------------- */

app.whenReady().then(() => {
  Menu.setApplicationMenu(null) // 菜单由渲染进程自绘
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// 单实例：第二次打开文件时转发给已运行实例
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', async (_e, argv) => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
    const fileArg = argv.find((a) => /\.(md|markdown|mdown|mkd|txt)$/i.test(a))
    if (fileArg) {
      try {
        const content = await fs.readFile(fileArg, 'utf8')
        win.webContents.send('app:open-path', {
          name: path.basename(fileArg),
          path: fileArg,
          content,
        })
      } catch {
        /* 忽略读取失败 */
      }
    }
  })
}
