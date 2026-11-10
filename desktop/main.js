// Lypora — Electron 主进程
// 职责：窗口管理 / 文件对话框 / 文件读写 / 系统集成
// 对应 docs/02 §5.1 的「进程间通信」层：移动端由 Capacitor 或浏览器 API 承担同一接口。

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, clipboard } = require('electron')
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
 * macOS 冷启动待打开文件队列。
 * `open-file` 可能在窗口创建之前触发（双击 .md 启动时就是如此），此时没有 webContents
 * 可投递，只能先存下来，等渲染层订阅好回调再发。Windows/Linux 的命令行参数走同一条队列，
 * 三端行为一致。
 */
const pendingOpen = []
let winReady = false

const MD_RE = /\.(md|markdown|mdown|mkd|txt)$/i

function queueOpenPath(filePath) {
  if (!filePath || !MD_RE.test(filePath)) return
  pendingOpen.push(filePath)
  flushPendingOpen()
}

function flushPendingOpen() {
  if (!winReady || !win || win.isDestroyed()) return
  while (pendingOpen.length) {
    const filePath = pendingOpen.shift()
    fs.readFile(filePath, 'utf8')
      .then((content) => {
        if (!win || win.isDestroyed()) return
        win.webContents.send('app:open-path', {
          name: path.basename(filePath),
          path: filePath,
          content,
        })
      })
      .catch(() => {
        /* 读不到就跳过（文件已被移走 / 权限不足），不打断其它待开文件 */
      })
  }
}

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
  // 每次建窗都要复位：macOS 上关窗不退出应用，激活时重建窗口。
  // 若沿用上一个窗口留下的 allowClose=true，新窗口的关窗守卫会被整段跳过（脏数据直接丢）。
  allowClose = false
  winReady = false

  win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 480,
    minHeight: 420,
    backgroundColor: '#ffffff',
    show: false,
    autoHideMenuBar: true,
    title: 'Lypora',
    // macOS 的窗口图标与 Dock 图标由 .app 包的 .icns 决定，此参数在 darwin 上被忽略
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

  // 首次启动带文件参数（Windows / Linux）：等渲染进程订阅好回调再投递。
  // macOS 双击文件不走命令行，走下面的 app.on('open-file')。
  win.webContents.once('did-finish-load', () => {
    // 400ms 是给渲染层挂 onOpenPath 回调的余量（与 v0.4.x 相同，实测够用）
    setTimeout(() => {
      winReady = true
      flushPendingOpen()
    }, 400)
  })
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

/**
 * 二进制另存为（导出 PNG / PDF / ZIP 用）。
 * 渲染进程只给字节和建议文件名，落盘位置由用户在系统对话框里决定 —— 不给默认
 * 静默写入，导出产物必须让用户知道落在哪。
 */
ipcMain.handle('file:save-binary', async (_e, { data, suggestedName, mime }) => {
  const ext = (suggestedName || '').split('.').pop() || 'bin'
  const filters =
    mime === 'application/pdf'
      ? [{ name: 'PDF', extensions: ['pdf'] }]
      : mime === 'application/zip'
        ? [{ name: 'ZIP', extensions: ['zip'] }]
        : [{ name: 'PNG', extensions: ['png'] }]
  const res = await dialog.showSaveDialog(win, {
    title: '导出',
    defaultPath: suggestedName || `export.${ext}`,
    filters,
  })
  if (res.canceled || !res.filePath) return null
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
  await fs.writeFile(res.filePath, buf)
  return { path: res.filePath, name: path.basename(res.filePath) }
})

ipcMain.handle('dir:open', async () => {  const res = await dialog.showOpenDialog(win, {
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

/* ---------------- 图片落盘 ----------------
 * 渲染层只负责决定"想放哪"，真正的目录探测 / 重名 / 复制都在主进程做：
 *   · 目录探测要看磁盘（正文里写过的 img/ 未必真存在，反过来也存在空目录），
 *     渲染层没有 fs；
 *   · 重名判定必须和 copyFile 原子地挨在一起，否则多选拖入时会自己撞自己。
 * 返回的 rel 是写进 markdown 的正斜杠相对路径，abs 只用于日志/提示。
 */

const pad2 = (n) => String(n).padStart(2, '0')

/** 仅重名时才用的时间戳前缀：20261109-143012 */
function stampPrefix() {
  const d = new Date()
  return (
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}` +
    `-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
  )
}

/**
 * 落盘时想用的文件名。
 * 渲染层偶尔需要指定名字——典型是剪贴板位图：主进程存的是
 * `clipboard-20261109-153000-1234.png` 这种运维味很重的临时名，
 * 而用户真正想看到的是 `image.png`。
 * 只取最后一段并挡掉路径穿越与非法字符，剩下的交给调用方。
 */
function preferredBase(name) {
  if (typeof name !== 'string') return ''
  const base = path.basename(name.trim().replace(/\\/g, '/')).replace(/[\u0000-\u001f<>:"|?*]/g, '')
  if (!base || base === '.' || base === '..') return ''
  return base
}

ipcMain.handle('image:place', async (_e, payload) => {
  try {
    const { srcPath, docPath, candidates } = payload || {}
    if (!srcPath || !path.isAbsolute(srcPath)) return { error: 'bad-src' }
    if (!docPath || !path.isAbsolute(docPath)) return { error: 'bad-doc' }

    const stat = await fs.stat(srcPath)
    if (!stat.isFile()) return { error: 'not-a-file' }

    const docDir = path.dirname(docPath)

    // 源图本来就在文档目录里（含子目录）→ 不复制，直接用现有相对路径
    const relFromDoc = path.relative(docDir, srcPath)
    if (relFromDoc && !relFromDoc.startsWith('..') && !path.isAbsolute(relFromDoc)) {
      return { rel: relFromDoc.split(path.sep).join('/'), abs: srcPath, copied: false }
    }

    // 目录探测：正文里出现过的目录优先（渲染层已排好序），取第一个真实存在的
    const list = Array.isArray(candidates) && candidates.length ? candidates : ['assets', 'images', 'img']
    let dirName = ''
    for (const c of list) {
      if (typeof c !== 'string' || !c || c.includes('..') || /[\\/]/.test(c)) continue
      const probe = path.join(docDir, c)
      try {
        const st = await fs.stat(probe)
        if (st.isDirectory()) {
          dirName = c
          break
        }
      } catch {
        /* 不存在，看下一个候选 */
      }
    }
    if (!dirName) dirName = 'assets'

    const targetDir = path.join(docDir, dirName)
    await fs.mkdir(targetDir, { recursive: true })

    const original = preferredBase(payload && payload.preferredName) || path.basename(srcPath)
    let base = original
    let target = path.join(targetDir, base)
    let renamed = true
    try {
      await fs.stat(target)
    } catch {
      renamed = false
    }
    if (renamed) {
      const ts = stampPrefix()
      base = `${ts}-${original}`
      target = path.join(targetDir, base)
      let n = 2
      for (;;) {
        try {
          await fs.stat(target)
        } catch {
          break
        }
        base = `${ts}-${n}-${original}`
        target = path.join(targetDir, base)
        n++
      }
    }

    if (path.resolve(target) !== path.resolve(srcPath)) await fs.copyFile(srcPath, target)
    return { rel: `${dirName}/${base}`, abs: target, copied: true, renamed }
  } catch (e) {
    return { error: String((e && e.message) || e) }
  }
})

/**
 * 剪贴板位图 → 临时 PNG + 真实路径。
 *
 * 为什么非要落盘：截图 / 从网页复制的图在渲染层只是个 File，**没有磁盘路径**
 * （Electron 32 起 `File.path` 已移除，且位图本来就不对应任何文件），
 * 走 webUtils.getPathForFile 只会拿到空串，结果就是"粘贴进去一张 base64"——
 * 明明用户设的是复制到附件目录。
 *
 * 落成临时文件后，这条路径就能和拖放/选文件完全共用 image:place 的目录探测与
 * 重名逻辑，三种路径模式全部生效。临时文件刻意不删：relative / absolute 模式下
 * 正文引用的就是它，删了图就断。
 */
ipcMain.handle('clipboard:read-image', async (_e, opts) => {
  try {
    const img = clipboard.readImage()
    if (!img || img.isEmpty()) return null
    const dir = path.join(app.getPath('temp'), 'lypora-clipboard')
    await fs.mkdir(dir, { recursive: true })
    const name = `clipboard-${stampPrefix()}-${process.pid}.png`
    const target = path.join(dir, name)
    const png = img.toPNG()
    await fs.writeFile(target, png)
    const { width, height } = img.getSize()
    const out = { path: target, name, width, height }
    // 渲染层只有走「内嵌 base64」时才需要像素内容；默认的「复制到附件目录」
    // 只认路径，所以这 4/3 倍的体积默认不传。
    if (opts && opts.withData) out.dataUrl = `data:image/png;base64,${png.toString('base64')}`
    return out
  } catch {
    // 读不到就当没有；渲染层会退回读文本
    return null
  }
})

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  electron: process.versions.electron,
}))

/* ---------------- 应用生命周期 ---------------- */

/**
 * macOS 应用菜单：只保留「关于 / 隐藏 / 退出」与「窗口」两组 role。
 *
 * 为什么不给「编辑」菜单（role:'editMenu'）：菜单加速键在 Electron 里**先于页面 keydown**
 * 被处理，一旦挂上 role:'undo'，Cmd+Z 会走 webContents 的原生撤销而不是 CM6 的 history，
 * 撤销粒度与范围全错。而 Chromium 在没有菜单时也照样能处理 contenteditable 里的
 * Cmd+C/V/X/A/Z，所以「不给编辑菜单」才是正确做法，不是偷懒。
 *
 * Windows/Linux 保持 setApplicationMenu(null)：菜单由渲染层自绘，系统菜单栏必须让位。
 */
function installApplicationMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'windowMenu' },
    ]),
  )
}

app.setAboutPanelOptions({
  applicationName: 'Lypora',
  applicationVersion: app.getVersion(),
  copyright: 'MIT · 独立实现，与任何第三方商业产品无关联',
  credits: 'Lypora — 独立实现的即时渲染 Markdown 编辑器',
})

// 必须在 whenReady 之前注册：双击 .md 冷启动时，open-file 可能早于 ready 触发
app.on('open-file', (e, filePath) => {
  e.preventDefault()
  queueOpenPath(filePath)
})

// Windows / Linux：首个实例的文件参数入队（macOS 走 open-file，argv 里只有 -psn_ 之类）
for (const a of process.argv.slice(1)) {
  if (MD_RE.test(a)) queueOpenPath(a)
}

app.whenReady().then(() => {
  installApplicationMenu()
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
  app.on('second-instance', (_e, argv) => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
    const fileArg = argv.find((a) => MD_RE.test(a))
    if (fileArg) queueOpenPath(fileArg)
  })
}
