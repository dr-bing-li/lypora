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
fs.rmSync(OUT_DIR, { recursive: true, force: true })

log('拷贝 Electron 运行时…')
fs.cpSync(ELECTRON_DIST, OUT_DIR, { recursive: true })

// 去掉 Electron 自带的默认应用，避免它抢占入口
for (const name of ['resources/default_app.asar']) {
  const p = path.join(OUT_DIR, name)
  if (fs.existsSync(p)) fs.rmSync(p, { force: true })
}

log('重命名可执行文件 → Lypora.exe')
fs.renameSync(path.join(OUT_DIR, 'electron.exe'), path.join(OUT_DIR, 'Lypora.exe'))

// 换掉 exe 的图标与版本信息（Electron 默认图标是通用 Electron 标，必须换）
const EXE = path.join(OUT_DIR, 'Lypora.exe')
const ICO = path.join(ROOT, 'desktop', 'icon.ico')
if (fs.existsSync(ICO)) {
  // 直接改目标文件偶发 "Unable to commit changes"（资源段被占用/杀软扫描）。
  // 改成：先在临时副本上改，成功后再原子替换。
  const TMP = path.join(os.tmpdir(), 'lypora-rcedit.tmp.exe')
  try {
    fs.copyFileSync(EXE, TMP)
    const rceditUrl = pathToFileURL(path.join(ROOT, 'desktop', 'node_modules', 'rcedit', 'lib', 'index.js')).href
    const { rcedit } = await import(rceditUrl)
    await rcedit(TMP, {
      icon: ICO,
      'file-version': WIN_VERSION,
      'product-version': WIN_VERSION,
      'version-string': {
        CompanyName: 'Lypora',
        FileDescription: 'Lypora Markdown 编辑器',
        ProductName: 'Lypora',
        LegalCopyright: 'Independent implementation. Not affiliated with, or endorsed by, any third-party product.',
        OriginalFilename: 'Lypora.exe',
      },
    })
    // 用覆盖写而不是"删掉再改名"：部分环境（沙箱回收站 / 杀软）会拦删除。
    // 覆盖写偶发 EBUSY：刚 rename 出来的 188MB exe 常被 Defender 实时扫描占住，
    // 等一会儿就放开了——重试 4 次，每次 1.2s 退避（docs/04 V18）。
    let wrote = false
    for (let attempt = 1; attempt <= 4 && !wrote; attempt++) {
      try {
        fs.copyFileSync(TMP, EXE)
        wrote = true
      } catch (e) {
        if (attempt === 4) throw e
        log(`覆盖 exe 被占用，第 ${attempt} 次重试…`)
        await new Promise((r) => setTimeout(r, 1200))
      }
    }
    try {
      fs.unlinkSync(TMP)
    } catch {
      /* 临时文件删不掉不影响产物 */
    }
    log('已写入 exe 图标与版本信息')
  } catch (e) {
    try {
      fs.unlinkSync(TMP)
    } catch {
      /* 忽略 */
    }
    log(`rcedit 失败（图标保持默认，不影响功能）：${String(e.message).split('\n')[0]}`)
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
  fs.rmSync(zipPath, { force: true })
  try {
    execFileSync('C:/Windows/System32/tar.exe', ['-a', '-c', '-f', zipPath, '-C', path.join(ROOT, 'release'), 'Lypora'], {
      stdio: 'inherit',
    })
    log(`zip 完成：${zipPath} (${(fs.statSync(zipPath).size / 1048576).toFixed(1)} MB)`)
  } catch (e) {
    log(`zip 失败（不影响便携包本身）：${e.message}`)
  }
}
