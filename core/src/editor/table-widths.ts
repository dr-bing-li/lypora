/**
 * 表格列宽持久化。
 *
 * 为什么不写回源码：参考实现拖列宽同样不修改 Markdown 文本（`| --- |` 分隔行只有
 * 对齐信息，没有宽度），所以列宽属于「视图状态」而不是文档内容。这里按
 * **表头签名** 存进 localStorage：
 *   - 用表头文本而不是文档位置，这样在上面插入/删除段落、重开文档都能命中；
 *   - 表头相同、列数相同的两张表会共享列宽（同一份文档里通常就是同一张表的两段）；
 *   - 改了表头文字或列数 → 签名变化 → 回到默认的自动列宽。
 *
 * 存储的是**比例**（和为 1）而不是像素：正文宽度、窗口大小、字号变化后表格
 * 仍按同样的比例分配，不会出现"改完窗口宽度列宽就错乱"的问题。
 */

const KEY = 'lypora:tableCols'

type Store = Record<string, number[]>

let cache: Store | null = null

function db(): Store {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : null
    cache = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Store) : {}
  } catch {
    cache = {}
  }
  return cache
}

function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(db()))
  } catch {
    /* 隐私模式 / 配额满：列宽退化为当次会话有效 */
  }
}

/** 表格身份：列数 + 表头原文（table widget 的 src 首行） */
export function tableSignature(src: string): string {
  const first = src.split('\n').find((l) => l.trim() !== '') ?? ''
  const header = first.trim()
  const cols = header.split('|').filter((s, i, arr) => i > 0 || s.trim() !== '').length
  return `${cols}|${header}`
}

/** 读回列比例；列数对不上（用户改了表格结构）时视为无效 */
export function loadColRatios(sig: string, cols: number): number[] | null {
  const r = db()[sig]
  if (!Array.isArray(r) || r.length !== cols || cols < 2) return null
  if (!r.every((v) => typeof v === 'number' && Number.isFinite(v) && v > 0)) return null
  const sum = r.reduce((a, b) => a + b, 0)
  if (!(sum > 0)) return null
  return r.map((v) => v / sum)
}

export function saveColRatios(sig: string, ratios: number[]): void {
  if (ratios.length < 2) return
  const sum = ratios.reduce((a, b) => a + b, 0) || 1
  db()[sig] = ratios.map((v) => Math.round((v / sum) * 1e5) / 1e5)
  persist()
}

export function clearColRatios(sig: string): void {
  if (!(sig in db())) return
  delete db()[sig]
  persist()
}
