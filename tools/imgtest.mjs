/**
 * 图片引用验收 —— 真启动 Electron，真放一张图到文档旁边的 img/ 里
 *
 *   node tools/imgtest.mjs
 *
 * 验四件事（全部是"点了会怎样"，不是"代码看起来对"）：
 *   ① 相对路径 `./img/pic.png` 能真的解码出来（naturalWidth > 0）——这就是原来的 bug
 *   ② 状态栏三态开关按 拷贝 → 相对 → 绝对 → 拷贝 循环，且落进 localStorage
 *   ③ 「设置 → 图片引用方式 → 内嵌 base64」生效后，状态栏开关被置灰
 *   ④ 切回「引用文件」后开关恢复可点
 */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const APP_DIR = path.join(ROOT, 'desktop')
const EXE = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')

// playwright-core 只装在 core/ 下，这里的模块解析起点是 tools/，得显式借道
const requireCore = createRequire(path.join(ROOT, 'core', 'package.json'))
const { _electron } = requireCore('playwright-core')

// 1×1 PNG，只为证明"能解码"，不关心内容
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const work = mkdtempSync(path.join(tmpdir(), 'lypora-img-'))
const imgDir = path.join(work, 'img')
mkdirSync(imgDir, { recursive: true })
writeFileSync(path.join(imgDir, 'pic.png'), PNG)
const docPath = path.join(work, 'doc.md')
writeFileSync(
  docPath,
  ['# 图片测试', '', '下面这张图用的是相对路径：', '', '![测试图](./img/pic.png)', ''].join('\n'),
  'utf8',
)

const checks = []
const push = (name, ok, detail) => checks.push({ name, ok: !!ok, detail })

const env = { ...process.env }
// 宿主会注入 ELECTRON_RUN_AS_NODE，主进程里会让 ipcMain 变 undefined
delete env.ELECTRON_RUN_AS_NODE

const app = await _electron.launch({
  executablePath: EXE,
  // 独立 userData：localStorage 里存着引用方式，复用旧 profile 会让"上次跑完停在
  // 内嵌模式"污染这一次（按钮一开始就是置灰的，点击直接超时）。
  args: [`--user-data-dir=${path.join(work, 'profile')}`, APP_DIR, docPath],
  env,
})
const page = await app.firstWindow()
await page.waitForSelector('.cm-editor', { timeout: 20000 })
await page.waitForTimeout(1800)

/* ---------------- ① 相对路径真的能显示 ---------------- */
const title = await page.title()
push('文档已打开', title.includes('doc.md'), title)

const img = await page.waitForSelector('.cm-img-widget img', { timeout: 8000 }).catch(() => null)
if (!img) {
  push('相对路径图片渲染出 img 元素', false, '没有 .cm-img-widget img')
} else {
  const info = await img.evaluate((el) => ({
    src: el.getAttribute('src') || '',
    naturalWidth: el.naturalWidth,
    complete: el.complete,
  }))
  push('src 被解析成 file://', info.src.startsWith('file:///') && info.src.includes('/img/pic.png'), info.src)
  push('图片真的解码成功', info.complete && info.naturalWidth > 0, JSON.stringify(info))
  push('没有走"图片无法显示"占位', !(await page.$('.cm-img-widget[title] >> text=图片无法显示')), '')
}

/* ---------------- ② 状态栏三态循环 ---------------- */
const readMode = () => page.evaluate(() => localStorage.getItem('lypora:imagePathMode'))
const btnState = () =>
  page.evaluate(() => {
    const b = document.getElementById('btn-image-path')
    return b ? { text: b.textContent, disabled: b.disabled, cls: b.className } : null
  })

const seq = []
for (let i = 0; i < 4; i++) {
  await page.click('#btn-image-path')
  await page.waitForTimeout(120)
  seq.push({ mode: await readMode(), btn: await btnState() })
}

// Electron 的 localStorage 是持久化的，上一次跑可能停在任意一格；
// 所以不假设起点，只验"从当前格起按 拷贝→相对→绝对 逐格前进、第四下回到原处"
const ORDER = ['"copy"', '"relative"', '"absolute"']
const idx = seq.map((s) => ORDER.indexOf(s.mode))
const okCycle = idx.every((v) => v >= 0) && idx.every((v, i) => i === 0 || v === (idx[i - 1] + 1) % 3)
push('三态循环 copy→relative→absolute→copy', okCycle && seq[3].mode === seq[0].mode, JSON.stringify(idx))
push(
  '按钮文案随模式变化',
  seq.every((s) => !!s.btn?.text && s.btn.text.length <= 4),
  JSON.stringify(seq.map((s) => `${s.mode}:${s.btn?.text}`)),
)

/* ---------------- ③ 设置改成内嵌 base64 ---------------- */
/** 菜单靠 mousedown 打开、二级靠 hover 浮出；每次先 Escape 清干净再点，避免撞上重绘中的旧节点 */
async function chooseMenu(rootId, parentId, itemId) {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
  await page.click(`[data-menu="${rootId}"]`)
  await page.waitForTimeout(200)
  const parent = await page.waitForSelector(`[data-mi="${parentId}"]`, { timeout: 5000 }).catch(() => null)
  if (!parent) return 'no-parent'
  await parent.hover()
  await page.waitForTimeout(300)
  const item = await page.waitForSelector(`[data-mi="${itemId}"]`, { timeout: 5000 }).catch(() => null)
  if (!item) return 'no-item'
  await item.click()
  await page.waitForTimeout(400)
  return 'ok'
}

const r1 = await chooseMenu('settings', 'settings-image-ref', 'settings-image-ref-embed')
push('设置菜单能切到内嵌 base64', r1 === 'ok', r1)
if (r1 === 'ok') {
  push('设置写入 embed', (await page.evaluate(() => localStorage.getItem('lypora:imageRefMode'))) === '"embed"', '')
  const st = await btnState()
  push('状态栏开关被置灰', st?.disabled === true && st?.cls.includes('is-disabled'), JSON.stringify(st))
}

/* ---------------- ④ 切回引用 ---------------- */
const r2 = await chooseMenu('settings', 'settings-image-ref', 'settings-image-ref-file')
push('设置菜单能切回引用文件', r2 === 'ok', r2)
if (r2 === 'ok') {
  const st = await btnState()
  push('切回引用后开关恢复可点', st?.disabled === false && !st?.cls.includes('is-disabled'), JSON.stringify(st))
}

/* ---------------- ⑤ 插入侧：三种路径模式 + 内嵌 ---------------- */
const readDoc = () => readFileSync(docPath, 'utf8')
const exists = (p) => existsSync(p)

/** 状态栏开关循环到目标模式（顺序 copy→relative→absolute） */
async function setPathMode(target) {
  for (let i = 0; i < 4; i++) {
    if ((await readMode()) === `"${target}"`) return true
    await page.click('#btn-image-path')
    await page.waitForTimeout(150)
  }
  return (await readMode()) === `"${target}"`
}

/** 光标移到文末 → 走选文件入口 → 保存 → 返回磁盘上的文档内容 */
async function insertAndSave(p) {
  const before = readDoc()
  await page.click('.cm-content')
  await page.keyboard.press('Control+End')
  await page.setInputFiles('#image-file', p)
  // 插入是异步的（读文件 → 复制/编码 → dispatch），Ctrl+S 抢在前面就会存到旧内容。
  // 用"磁盘内容有没有变"当判据重试，比固定 sleep 稳。
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(700)
    await page.keyboard.press('Control+s')
    await page.waitForTimeout(500)
    const now = readDoc()
    if (now !== before) return now
  }
  return readDoc()
}

// ⑤-1 拷贝模式：文件要搬进附件目录，正文写相对路径。
// 目录不是写死的 assets：正文里已经有 `./img/pic.png` 且磁盘上 img/ 真的存在，
// 于是复用 img/（"已有文档别再多建一个 assets"就是这个诉求）。
// 源图必须放在文档目录**之外**，否则命中的是"已在目录内就别复制"那个分支。
push('切到拷贝模式', await setPathMode('copy'), await readMode())
const outsideDir = mkdtempSync(path.join(tmpdir(), 'lypora-src-'))
const outsideA = path.join(outsideDir, 'pic-a.png')
writeFileSync(outsideA, PNG)
const afterCopy = await insertAndSave(outsideA)
push('拷贝模式复用正文里的 img/ 目录', afterCopy.includes('./img/pic-a.png'), afterCopy.split('\n').pop())
push('拷贝模式文件真的落盘', exists(path.join(work, 'img', 'pic-a.png')), 'img/pic-a.png')

// ⑤-2 重名：只给重名的那张加时间戳前缀，原名保留
const afterDup = await insertAndSave(outsideA)
push('重名加时间戳前缀', /\.\/img\/\d{8}-\d{6}-pic-a\.png/.test(afterDup), afterDup.split('\n').pop())

// ⑤-3 源图本来就在文档目录内：不复制，直接用现有相对位置
const subDir = path.join(work, 'sub')
mkdirSync(subDir, { recursive: true })
const innerE = path.join(subDir, 'pic-e.png')
writeFileSync(innerE, PNG)
const afterInner = await insertAndSave(innerE)
push('目录内的图不重复复制', afterInner.includes('./sub/pic-e.png') && !exists(path.join(work, 'assets', 'pic-e.png')), afterInner.split('\n').pop())

// ⑤-4 相对路径模式：不复制，写源图相对文档目录的路径
push('切到相对路径模式', await setPathMode('relative'), await readMode())
const siblingB = path.join(subDir, 'pic-b.png')
writeFileSync(siblingB, PNG)
const afterRel = await insertAndSave(siblingB)
push('相对模式正文写 ./sub/pic-b.png', afterRel.includes('./sub/pic-b.png'), afterRel.split('\n').pop())
push('相对模式不复制文件', !exists(path.join(work, 'assets', 'pic-b.png')), 'assets/pic-b.png')

// ⑤-5 绝对路径模式
push('切到绝对路径模式', await setPathMode('absolute'), await readMode())
const outsideC = path.join(outsideDir, 'pic-c.png')
writeFileSync(outsideC, PNG)
const afterAbs = await insertAndSave(outsideC)
push(
  '绝对模式正文写正斜杠绝对路径',
  afterAbs.includes(outsideC.replace(/\\/g, '/')),
  afterAbs.split('\n').pop(),
)

// ⑤-6 内嵌 base64：设置优先级最高，路径模式整段不参与
const r3 = await chooseMenu('settings', 'settings-image-ref', 'settings-image-ref-embed')
push('切到内嵌 base64', r3 === 'ok', r3)
const outsideD = path.join(work, 'pic-d.png')
writeFileSync(outsideD, PNG)
const afterEmbed = await insertAndSave(outsideD)
push('内嵌模式写入 data: URI', afterEmbed.includes('data:image/png;base64,'), JSON.stringify(afterEmbed.slice(-160)))
push('内嵌模式不落盘附件', !exists(path.join(work, 'assets', 'pic-d.png')), 'assets/pic-d.png')

/* ---------------- 收尾 ---------------- */
await app.close()

const bad = checks.filter((c) => !c.ok)
for (const c of checks) console.log(`${c.ok ? '✓' : '✗'} ${c.name}${c.ok ? '' : '  → ' + c.detail}`)
console.log(JSON.stringify({ total: checks.length, pass: checks.length - bad.length, fail: bad.length }, null, 2))
process.exit(bad.length ? 1 : 0)
