#!/usr/bin/env node
/**
 * 发布 GitHub Release 并上传附件。
 *
 * 用法：
 *   GITHUB_TOKEN=xxx node tools/publish-release.mjs v0.4.0 \
 *     --notes docs/releases/v0.4.0/notes.md \
 *     --asset release/Lypora-0.4.0-win-x64.zip \
 *     --asset docs/releases/v0.4.0/SHA256SUMS.txt
 *
 * 发布说明与校验清单放 docs/releases/<tag>/ 而不是 artifacts/：
 *   artifacts/ 被 .gitignore 排除，说明改成"只在某台机器上存在"，换机就没法复现这次的发布。
 *   文件名必须保持 SHA256SUMS.txt（上传时用的是 basename）。
 *
 * 为什么不用 gh CLI / fetch：
 *   1) 本机没有 gh；
 *   2) 这台机器上 api.github.com 的 DNS 被污染，fetch 会连到错的地方。
 *      脚本用 node:https 的 `lookup` 选项把域名钉到指定 IP，同时保持 SNI 与 Host 头不变，
 *      所以证书校验照常通过。IP 用环境变量给，缺省走系统 DNS。
 *      GITHUB_API_IP=140.82.112.6  GITHUB_UPLOAD_IP=140.82.112.6
 *
 * 需要的 token 权限：fine-grained PAT，仅本仓库，Contents: Read and write。
 */

import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const argv = process.argv.slice(2)
const positional = []
const assets = []
let notesPath = null
let draft = false
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--notes') notesPath = argv[++i]
  else if (a === '--asset') assets.push(argv[++i])
  else if (a === '--draft') draft = true
  else if (!a.startsWith('--')) positional.push(a)
}
const tag = positional[0]
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN

if (!token) {
  console.error('缺少 GITHUB_TOKEN（fine-grained PAT，Contents: Read and write）')
  process.exit(2)
}
if (!tag || !/^v\d/.test(tag)) {
  console.error('用法：GITHUB_TOKEN=xxx node tools/publish-release.mjs v0.4.0 [--notes f] [--asset f]…')
  process.exit(2)
}

const repo =
  process.env.GITHUB_REPO ||
  execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' })
    .trim()
    .replace(/^git@github\.com:/, '')
    .replace(/^https:\/\/github\.com\//, '')
    .replace(/\.git$/, '')

const API_IP = process.env.GITHUB_API_IP || null
// 注意：uploads.github.com 与 api.github.com 是两套服务，**不能共用同一个 IP**。
// 曾把 UPLOAD_IP 缺省成 API_IP，导致上传打到 api 那台机器上返回 404（api 不认上传路径）。
const UPLOAD_IP = process.env.GITHUB_UPLOAD_IP || null

function lookupFor(ip) {
  if (!ip) return undefined
  // Node 22 有时用 all:true 调用（要数组），旧路径要 (address, family) 两个参数，两种都兜住
  return (_hostname, opts, cb) => {
    if (opts && opts.all) cb(null, [{ address: ip, family: 4 }])
    else cb(null, ip, 4)
  }
}

/** 一次 HTTPS 请求；body 可以是字符串或可读流（流式上传大文件） */
function request(url, { method = 'GET', headers = {}, body = null, ip = null, timeout = 600000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = https.request(
      u,
      { method, headers, lookup: lookupFor(ip), timeout },
      (res) => {
        let data = ''
        res.setEncoding('utf8')
        res.on('data', (d) => (data += d))
        res.on('end', () => {
          let json = null
          try {
            json = data ? JSON.parse(data) : null
          } catch {
            /* 非 JSON */
          }
          resolve({ status: res.statusCode, headers: res.headers, json, raw: data })
        })
      }
    )
    req.on('timeout', () => req.destroy(new Error(`timeout after ${timeout}ms: ${method} ${url}`)))
    req.on('error', reject)
    if (body && typeof body.pipe === 'function') {
      body.on('error', reject)
      body.pipe(req)
    } else {
      if (body) req.write(body)
      req.end()
    }
  })
}

const api = (p) => `https://api.github.com${p}`
const common = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'lypora-release-script',
}

const log = (...a) => console.log('[release]', ...a)

const notes = notesPath && fs.existsSync(notesPath) ? fs.readFileSync(notesPath, 'utf8') : ''
// 只在真的给了 --notes 时才动说明。否则 PATCH 会带一个空 body，把线上 Release 的
// 说明整段清空（追加附件时极易踩到），这种"就想补传一个包"的场景不该有副作用。
const hasNotes = Boolean(notesPath && fs.existsSync(notesPath))
const title = `Lypora ${tag}`

// 1. 取现有 release（可能之前建过草稿）
let res = await request(api(`/repos/${repo}/releases/tags/${tag}`), { headers: common, ip: API_IP })
let release
if (res.status === 200) {
  release = res.json
  log(`release 已存在：#${release.id}${hasNotes ? '，更新说明' : '，未提供 --notes，保留原说明'}`)
  res = await request(api(`/repos/${repo}/releases/${release.id}`), {
    method: 'PATCH',
    headers: { ...common, 'Content-Type': 'application/json' },
    body: JSON.stringify(hasNotes ? { name: title, body: notes, draft } : { name: title, draft }),
    ip: API_IP,
  })
  if (res.status !== 200) throw new Error(`PATCH 失败 ${res.status}: ${res.raw.slice(0, 300)}`)
  release = res.json
} else {
  log(`创建 release（tag=${tag}）`)
  res = await request(api(`/repos/${repo}/releases`), {
    method: 'POST',
    headers: { ...common, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag_name: tag, name: title, body: notes, draft, prerelease: false }),
    ip: API_IP,
  })
  if (res.status !== 201) throw new Error(`创建失败 ${res.status}: ${res.raw.slice(0, 300)}`)
  release = res.json
}
log(`release id=${release.id} html_url=${release.html_url}`)

// 2. 上传附件（同名先删，避免 422 already_exists）
for (const rel of assets) {
  const abs = path.resolve(rel)
  const name = path.basename(abs)
  const size = fs.statSync(abs).size

  if (release.assets?.some((a) => a.name === name)) {
    const old = release.assets.find((a) => a.name === name)
    log(`附件已存在，先删除 ${name} (#${old.id})`)
    await request(api(`/repos/${repo}/releases/assets/${old.id}`), { method: 'DELETE', headers: common, ip: API_IP })
  }

  const uploadBase = (release.upload_url || '').replace(/\{.*$/, '')
  const url = `${uploadBase}?name=${encodeURIComponent(name)}`
  log(`上传 ${name} (${(size / 1048576).toFixed(1)} MiB)…`)
  const t0 = Date.now()
  const resp = await request(url, {
    method: 'POST',
    headers: {
      ...common,
      'Content-Type': 'application/octet-stream',
      'Content-Length': size,
    },
    body: fs.createReadStream(abs),
    ip: UPLOAD_IP,
  })
  if (resp.status !== 201) throw new Error(`上传失败 ${resp.status}: ${resp.raw.slice(0, 300)}`)
  const took = ((Date.now() - t0) / 1000).toFixed(1)
  log(`  完成 asset id=${resp.json.id} state=${resp.json.state} size=${resp.json.size} 用时 ${took}s`)
}

// 3. 回读校验：附件数量、字节数、digest（新版 API 返回 sha256:…）
res = await request(api(`/repos/${repo}/releases/tags/${tag}`), { headers: common, ip: API_IP })
if (res.status !== 200) throw new Error(`回读失败 ${res.status}`)
const final = res.json
const summary = {
  ok: true,
  html_url: final.html_url,
  tag: final.tag_name,
  draft: final.draft,
  assets: final.assets.map((a) => ({ name: a.name, size: a.size, state: a.state, digest: a.digest || null })),
}
for (const a of summary.assets) {
  const local = assets.map((p) => path.resolve(p)).find((p) => path.basename(p) === a.name)
  if (!local) continue
  const localSize = fs.statSync(local).size
  if (localSize !== a.size) {
    summary.ok = false
    log(`!! 大小不一致 ${a.name}：local=${localSize} remote=${a.size}`)
  }
}
console.log('RELEASE_RESULT ' + JSON.stringify(summary))
