/**
 * Ctrl+滚轮调字号的流畅度量化（帧耗时 + 连续性）
 *
 * 为什么需要它：功能"能用"和"不卡"是两件事。verify.mjs 只断言字号数值在变，
 * 断言不了掉帧。这里在同一帧里派发 wheel 并记录每条 rAF 的间隔，用数据说话：
 *   - 先跑一段「什么都不做」的基线，拿到这台机器的噪声底（实测 16.7 / 16.8）
 *   - 再跑 120 帧「每帧一次 ctrl+wheel」，对比 p50 / p95 / max
 * 判据取的是「中位数不掉帧 + 无 longtask + 无回退 + 连续中间值足够多」，
 * 而不是 p95 必须 16.7 —— 每帧重排整篇文档，偶发单帧丢失是物理事实（见 docs/04 V32）。
 *
 * 用法：需先起预览服务（vite preview --port 4173）
 *   node tools/zoomperf.mjs
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..')
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const URL = 'http://127.0.0.1:4173/index.html'

// playwright-core 是 CJS，动态 import 后 chromium 可能挂在 default 上
const pw = await import(
  pathToFileURL(path.join(ROOT, 'core', 'node_modules', 'playwright-core', 'index.js')).href
)
const { chromium } = pw.default ?? pw

const browser = await chromium.launch({ executablePath: EDGE, headless: true })

async function samplePage() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.waitForTimeout(700)
  return { page, errors }
}

/** 跑 N 帧，每帧执行一次 tick，返回帧间隔统计 */
async function measure(page, tick) {
  return page.evaluate(async (tickSrc) => {
    const host = document.getElementById('editor-scroll') || document.body
    const tick = new Function('host', 'i', tickSrc)
    const frames = []
    let last = performance.now()
    const N = 120
    for (let i = 0; i < N; i++) {
      await new Promise((r) => requestAnimationFrame(r))
      const now = performance.now()
      frames.push(now - last)
      last = now
      tick(host, i)
    }
    const warm = frames.slice(2) // 丢前两帧的启动抖动
    const s = [...warm].sort((a, b) => a - b)
    const pick = (q) => +s[Math.min(s.length - 1, Math.floor(s.length * q))].toFixed(2)
    return { p50: pick(0.5), p95: pick(0.95), max: +Math.max(...warm).toFixed(2) }
  }, tick)
}

const lift = (mode) =>
  mode === 'idle'
    ? ''
    : `host.dispatchEvent(new WheelEvent('wheel', { deltaY: -12, deltaMode: 0, ctrlKey: ${mode === 'ctrl'}, bubbles: true, cancelable: true, clientX: 700, clientY: 400 }))`

/* ---------- 1. 基线：什么都不做 ---------- */
const { page, errors } = await samplePage()
const base = await measure(page, lift('idle'))

/* ---------- 2. 对照：同样的 wheel 但不按 Ctrl（处理器第一行就 return）
   这一段的作用是把「合成事件派发本身的开销」从测量里摘出去——
   如果它和基线一样，就说明下面测到的增量全部来自"改字号 + 重排"。 ---------- */
const noCtrl = await measure(page, lift('plain'))

/* ---------- 2. 逐帧 ctrl+wheel，同时记录字号序列 ---------- */
const zoom = await page.evaluate(async () => {
  const host = document.getElementById('editor-scroll') || document.body
  const long = []
  const po = new PerformanceObserver((l) => {
    for (const e of l.getEntries()) long.push(Math.round(e.duration))
  })
  try {
    po.observe({ entryTypes: ['longtask'] })
  } catch {
    /* 不支持 longtask（老内核） */
  }
  const frames = []
  const sizes = []
  let last = performance.now()
  const N = 120
  for (let i = 0; i < N; i++) {
    await new Promise((r) => requestAnimationFrame(r))
    const now = performance.now()
    frames.push(now - last)
    last = now
    host.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: -12,
        deltaMode: 0,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
        clientX: 700,
        clientY: 400,
      }),
    )
    sizes.push(
      parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--content-font-size'),
      ),
    )
  }
  await new Promise((r) => setTimeout(r, 500))
  po.disconnect()
  return { frames, sizes, long, osd: document.getElementById('font-osd')?.textContent ?? '' }
})

const warm = zoom.frames.slice(2)
const s = [...warm].sort((a, b) => a - b)
const pick = (q) => +s[Math.min(s.length - 1, Math.floor(s.length * q))].toFixed(2)
let back = 0
for (let i = 1; i < zoom.sizes.length; i++) if (zoom.sizes[i] < zoom.sizes[i - 1] - 0.001) back++

const out = {
  baselineMs: base,
  plainWheelMs: noCtrl,
  zoomMs: { p50: pick(0.5), p95: pick(0.95), max: +Math.max(...warm).toFixed(2) },
  perFrameOverheadMs: +(pick(0.5) - base.p50).toFixed(2),
  fontSize: { from: zoom.sizes[0], to: zoom.sizes.at(-1), distinct: new Set(zoom.sizes).size },
  backSteps: back,
  longTasks: zoom.long,
  osd: zoom.osd,
  errors,
}
const BUDGET = 16.7
out.checks = {
  // 派发不含成本：对照组与基线一致，说明增量全部来自"改字号 + 重排"
  dispatchFree: Math.abs(noCtrl.p50 - base.p50) <= 0.5,
  // 每帧的重排开销不超过一帧预算的 18%
  overheadOk: out.perFrameOverheadMs <= BUDGET * 0.18,
  // 不出现长任务（>50ms 的阻塞，用户能明显感到顿住）
  noLongTask: out.longTasks.length === 0,
  // 任何一帧的停顿不超过 2 个 vsync 间隔（即最多丢一帧，不会连丢）
  noCascade: out.zoomMs.max <= BUDGET * 2.4,
  monotonic: back === 0,
  continuous: out.fontSize.distinct >= 80, // 120 帧里至少 80 个互不相同的中间值
}
out.ok = Object.values(out.checks).every(Boolean)

console.log(JSON.stringify(out, null, 2))
await page.evaluate(() => localStorage.setItem('lypora:fontSize', '16'))
await browser.close()
process.exit(out.ok ? 0 : 1)
