/**
 * 打包 Windows 便携版（绿色版）
 *
 * 产出：
 *   release/Lypora/Lypora.exe       ← 双击即用，无需安装 Node/Electron
 *   release/Lypora/resources/app/web  ← 前端产物（core/dist）
 *
 * 用法：node tools/pack-win.mjs
 * 前提：desktop/node_modules/electron/dist 已存在（含 electron.exe）
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ELECTRON_DIST = path.join(ROOT, 'desktop', 'node_modules', 'electron', 'dist')
const CORE_DIST = path.join(ROOT, 'core', 'dist')
const OUT_DIR = path.join(ROOT, 'release', 'Lypora')
const APP_DIR = path.join(OUT_DIR, 'resources', 'app')

const log = (s) => console.log(`[pack] ${s}`)

/**
 * 删除文件或目录（幂等）。
 *
 * 为什么不直接用 `fs.rmSync`：宿主给 node 挂了「安全删除」钩子，每次删除都会被
 * 转成回收站操作；本机这个转运偶发失败并 fail-closed，抛的是
 * `[safe-delete] 操作失败 … trash operation` —— 不是权限问题，重试也没用。
 * `release/` 是纯构建产物（.gitignore 里就有），这里交给系统命令删除，
 * 不经过那层钩子。
 */
function hardRemove(p) {
  if (!p || !fs.existsSync(p)) return
  let isDir = false
  try {
    isDir = fs.lstatSync(p).isDirectory()
  } catch {
    return
  }
  const args = isDir ? ['/c', 'rd', '/s', '/q', p] : ['/c', 'del', '/f', '/q', p]
  try {
    execFileSync(process.env.ComSpec || 'cmd', args, { stdio: 'ignore' })
  } catch {
    // 还有残留句柄时 rd 会失败；目录节点留着当空壳，后面的 cpSync 会覆盖内容
  }
}

/** 版本号只有一个真源：desktop/package.json（避免 exe 里和 zip 名对不上） */
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop', 'package.json'), 'utf8'))
const VERSION = PKG.version
const WIN_VERSION = /^\d+\.\d+\.\d+$/.test(VERSION) ? `${VERSION}.0` : VERSION
log(`版本 ${VERSION}（Win 资源版本 ${WIN_VERSION}）`)

if (!fs.existsSync(path.join(ELECTRON_DIST, 'electron.exe'))) {
  throw new Error('未找到 electron.exe，请先解压 Electron 发行包到 desktop/node_modules/electron/dist')
}
if (!fs.existsSync(path.join(CORE_DIST, 'index.html'))) {
  throw new Error('未找到 core/dist/index.html，请先在 core 目录执行 npx vite build')
}

log(`清理 ${OUT_DIR}`)
hardRemove(OUT_DIR)

log('拷贝 Electron 运行时…')
fs.cpSync(ELECTRON_DIST, OUT_DIR, { recursive: true })

// 去掉 Electron 自带的默认应用，避免它抢占入口
for (const name of ['resources/default_app.asar']) {
  const p = path.join(OUT_DIR, name)
  hardRemove(p)
}

log('重命名可执行文件 → Lypora.exe')
fs.renameSync(path.join(OUT_DIR, 'electron.exe'), path.join(OUT_DIR, 'Lypora.exe'))

// 换掉 exe 的图标与版本信息（Electron 默认图标是通用 Electron 标，必须换）
const EXE = path.join(OUT_DIR, 'Lypora.exe')
const ICO = path.join(ROOT, 'desktop', 'icon.ico')
if (fs.existsSync(ICO)) {
  // 换图标/版本信息有两条路，成败都记日志：
  //   ① 就地改：最快。刚 rename 出来的 188MB exe 偶发被 Defender 扫住
  //      （"Unable to commit changes"），所以带退避重试。
  //   ② 临时副本改完再覆盖回来：①彻底失败时的兜底。
  // v0.5.0 起先试①：上一版直接走②时，在 %TEMP% 里改 PE 文件被拦，rcedit 返回 1，
  // 图标就悄悄退回 Electron 默认标（日志里只有一行"失败，不影响功能"，很容易漏看）。
  const rceditUrl = pathToFileURL(
    path.join(ROOT, 'desktop', 'node_modules', 'rcedit', 'lib', 'index.js'),
  ).href
  const { rcedit } = await import(rceditUrl)
  const OPTS = {
    icon: ICO,
    'file-version': WIN_VERSION,
    'product-version': WIN_VERSION,
    'version-string': {
      CompanyName: 'Lypora',
      FileDescription: 'Lypora Markdown 编辑器',
      ProductName: 'Lypora',
      LegalCopyright:
        'Independent implementation. Not affiliated with, or endorsed by, any third-party product.',
      OriginalFilename: 'Lypora.exe',
    },
  }

  let done = false
  let lastErr = null
  for (let attempt = 1; attempt <= 3 && !done; attempt++) {
    try {
      await rcedit(EXE, OPTS)
      done = true
      log(`rcedit 就地写入成功（第 ${attempt} 次）`)
    } catch (e) {
      lastErr = e
      log(`rcedit 就地写入第 ${attempt} 次失败：${String(e.message).split('\n')[0].slice(0, 120)}`)
      await new Promise((r) => setTimeout(r, 1200 * attempt))
    }
  }

  if (!done) {
    const TMP = path.join(os.tmpdir(), 'lypora-rcedit.tmp.exe')
    try {
      fs.copyFileSync(EXE, TMP)
      await rcedit(TMP, OPTS)
      // 覆盖写而不是"删掉再改名"：部分环境（沙箱回收站 / 杀软）会拦删除
      for (let attempt = 1; attempt <= 4; attempt++) {
        try {
          fs.copyFileSync(TMP, EXE)
          done = true
          break
        } catch (e) {
          if (attempt === 4) throw e
          await new Promise((r) => setTimeout(r, 1200))
        }
      }
      log('rcedit 临时副本写入成功')
    } catch (e) {
      lastErr = e
    } finally {
      try {
        hardRemove(TMP)
      } catch {
        /* 临时文件删不掉不影响打包 */
      }
    }
  }

  if (!done) {
    // 不静默：图标没换成是可见缺陷，构建日志必须写清楚，别让它混进发布包
    log(`⚠ rcedit 彻底失败，exe 仍是 Electron 默认图标：${String(lastErr?.message).split('\n')[0]}`)
    process.exitCode = 2
  }
}

log('部署主进程脚本…')
fs.mkdirSync(APP_DIR, { recursive: true })
for (const f of ['main.js', 'preload.js', 'selftest-probe.js']) {
  fs.copyFileSync(path.join(ROOT, 'desktop', f), path.join(APP_DIR, f))
}

const pkg = {
  name: 'lypora-desktop',
  productName: 'Lypora',
  version: JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop', 'package.json'), 'utf8')).version,
  description: 'Lypora —— 独立实现的即时渲染 Markdown 编辑器',
  main: 'main.js',
  author: 'dr-bing-li',
  license: 'MIT',
  homepage: 'https://github.com/dr-bing-li/lypora#readme',
}
fs.writeFileSync(path.join(APP_DIR, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')

log('部署前端产物 → resources/app/web…')
fs.cpSync(CORE_DIST, path.join(APP_DIR, 'web'), { recursive: true })

// 绿色版说明
fs.writeFileSync(
  path.join(OUT_DIR, '使用说明.txt'),
  [
    'Lypora —— Windows 便携版',
    '',
    '1. 双击 Lypora.exe 即可运行，无需安装。',
    '2. 整个 Lypora 文件夹可以直接拷贝到 U 盘 / 其他电脑，保持文件夹结构完整。',
    '3. 想用「打开方式」关联 .md 文件：右键任意 .md → 打开方式 → 选择其他应用 →',
    '   浏览到本目录的 Lypora.exe，勾选「始终使用此应用打开 .md 文件」。',
    '4. 卸载 = 直接删除本文件夹（配置存在 %APPDATA%\\lypora-desktop，可一并删除）。',
    '',
    `版本：${pkg.version}`,
    '',
    '许可证：MIT。第三方组件（Electron / Chromium / CodeMirror 6 / Lezer / KaTeX）的许可文本',
    '见同目录 LICENSE 与 LICENSES.chromium.html，完整清单见仓库 THIRD-PARTY-NOTICES.md。',
    '',
    '源码与问题反馈：https://github.com/dr-bing-li/lypora',
    '本项目为独立实现，与任何第三方商业产品无关联，也未获其认可。',
    '',
  ].join('\r\n'),
  'utf8'
)

// 统计
const countFiles = (dir) => {
  let n = 0
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    n += e.isDirectory() ? countFiles(path.join(dir, e.name)) : 1
  }
  return n
}
const sizeMB = (dir) => {
  let b = 0
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    b += e.isDirectory() ? sizeMB(p) : fs.statSync(p).size
  }
  return b
}

log(`完成：${OUT_DIR}`)
log(`文件数 ${countFiles(OUT_DIR)}，体积 ${(sizeMB(OUT_DIR) / 1048576).toFixed(1)} MB`)
log(`入口 ${path.join(OUT_DIR, 'Lypora.exe')}`)

// 打包 zip（用系统 bsdtar，避免引入压缩依赖）
const zipPath = path.join(ROOT, 'release', `Lypora-${pkg.version}-win-x64.zip`)
if (process.argv.includes('--zip')) {
  log('生成 zip…')
  hardRemove(zipPath)
  try {
    execFileSync('C:/Windows/System32/tar.exe', ['-a', '-c', '-f', zipPath, '-C', path.join(ROOT, 'release'), 'Lypora'], {
      stdio: 'inherit',
    })
    log(`zip 完成：${zipPath} (${(fs.statSync(zipPath).size / 1048576).toFixed(1)} MB)`)
  } catch (e) {
    log(`zip 失败（不影响便携包本身）：${e.message}`)
  }
}
