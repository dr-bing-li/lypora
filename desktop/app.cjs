// Lypora — 零依赖 Windows 启动器
// 组成：内置静态服务（127.0.0.1，安全上下文）+ 系统 Edge 的 --app 模式（无地址栏独立窗口）
// 这样无需下载 Electron 二进制即可获得"桌面应用"体验，且 File System Access API 可用。
//
// 用法：
//   node app.cjs           启动应用
//   node app.cjs --check   仅自检（起服务 → 请求首页 → 校验 → 退出）

const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')

const DIST = path.join(__dirname, '..', 'core', 'dist')
const CHECK = process.argv.includes('--check')
const PORT_START = 47821
const PORT_TRIES = 24

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.map': 'application/json; charset=utf-8',
}

function createServer() {
  return http.createServer((req, res) => {
    let urlPath
    try {
      urlPath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname)
    } catch {
      res.writeHead(400).end('Bad Request')
      return
    }
    if (urlPath === '/') urlPath = '/index.html'

    // 目录穿越防护
    const filePath = path.join(DIST, urlPath)
    if (!filePath.startsWith(DIST)) {
      res.writeHead(403).end('Forbidden')
      return
    }

    fs.stat(filePath, (err, stat) => {
      if (err || !stat.isFile()) {
        // 单页应用回退
        const fallback = path.join(DIST, 'index.html')
        fs.readFile(fallback, (e2, buf) => {
          if (e2) {
            res.writeHead(404).end('Not Found')
            return
          }
          res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' })
          res.end(buf)
        })
        return
      }
      const ext = path.extname(filePath).toLowerCase()
      const type = MIME[ext] || 'application/octet-stream'
      const cache = ext === '.html' || ext === '.webmanifest' ? 'no-store' : 'public, max-age=86400'
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cache })
      fs.createReadStream(filePath).pipe(res)
    })
  })
}

function listen(server, port, tries) {
  return new Promise((resolve, reject) => {
    const attempt = (p, left) => {
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && left > 0) attempt(p + 1, left - 1)
        else reject(err)
      })
      server.listen(p, '127.0.0.1', () => resolve(p))
    }
    attempt(port, tries)
  })
}

function findEdge() {
  const candidates = [
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft/Edge/Application/msedge.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft/Edge/Application/msedge.exe'),
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ].filter(Boolean)
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p
    } catch {
      /* ignore */
    }
  }
  return null
}

async function main() {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    console.error('[Lypora] 找不到构建产物：' + DIST)
    console.error('[Lypora] 请先在 core/ 目录执行：npm install && npx vite build')
    process.exit(1)
  }

  const server = createServer()
  const port = await listen(server, PORT_START, PORT_TRIES)
  const url = `http://127.0.0.1:${port}/index.html`

  if (CHECK) {
    await new Promise((resolve) => {
      http
        .get(url, (res) => {
          let body = ''
          res.on('data', (c) => (body += c))
          res.on('end', () => {
            console.log(
              JSON.stringify(
                {
                  port,
                  status: res.statusCode,
                  contentType: res.headers['content-type'],
                  bytes: body.length,
                  hasRoot: body.includes('id="app"'),
                  hasScript: /src="[^"]*index-[^"]*\.js"/.test(body),
                },
                null,
                2,
              ),
            )
            resolve()
          })
        })
        .on('error', (e) => {
          console.error('请求失败:', e.message)
          resolve()
        })
    })
    server.close()
    process.exit(0)
  }

  const edge = findEdge()
  if (!edge) {
    console.log('[Lypora] 未找到 Microsoft Edge。')
    console.log('[Lypora] 已启动本地服务，请手动用浏览器打开：' + url)
    console.log('[Lypora] 按 Ctrl+C 结束。')
    return
  }

  const profileDir = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'Lypora-App')
  const args = [
    `--app=${url}`,
    `--user-data-dir=${profileDir}`,
    '--window-size=1280,880',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate',
  ]

  console.log('[Lypora] 正在启动独立窗口…  ' + url)
  const child = spawn(edge, args, { stdio: 'ignore', detached: false })

  const shutdown = () => {
    try {
      child.kill()
    } catch {
      /* ignore */
    }
    server.close()
    process.exit(0)
  }

  child.on('exit', shutdown)
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((e) => {
  console.error('[Lypora] 启动失败：', e)
  process.exit(1)
})
