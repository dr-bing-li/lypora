export interface OutlineItem {
  level: number
  text: string
  from: number
  line: number
}

/** 从文档中提取 ATX 标题（与参考实现的大纲一致，忽略代码块内的 # ） */
export function extractOutline(doc: string): OutlineItem[] {
  const items: OutlineItem[] = []
  let inFence = false
  let fenceMark = ''
  let offset = 0

  for (const raw of doc.split('\n')) {
    const line = raw
    const fence = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (fence) {
      if (!inFence) {
        inFence = true
        fenceMark = fence[1][0]
      } else if (fence[1][0] === fenceMark) {
        inFence = false
      }
      offset += raw.length + 1
      continue
    }
    if (!inFence) {
      const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
      if (m) {
        items.push({
          level: m[1].length,
          text: m[2].replace(/[*_`~]/g, '') || '（空标题）',
          from: offset,
          line: items.length,
        })
      }
    }
    offset += raw.length + 1
  }
  return items
}

export function renderOutline(
  items: OutlineItem[],
  container: HTMLElement,
  onJump: (from: number) => void,
): void {
  container.innerHTML = ''
  if (!items.length) {
    container.innerHTML = '<div class="empty-hint">文档无标题</div>'
    return
  }
  const frag = document.createDocumentFragment()
  for (const it of items) {
    const btn = document.createElement('button')
    btn.className = 'outline-item'
    btn.dataset.lv = String(it.level)
    btn.dataset.from = String(it.from)
    btn.textContent = it.text
    btn.title = it.text
    btn.addEventListener('click', () => onJump(it.from))
    frag.appendChild(btn)
  }
  container.appendChild(frag)
}

/** 根据当前光标位置高亮大纲项 */
export function highlightOutline(container: HTMLElement, cursorPos: number, items: OutlineItem[]): void {
  let active = -1
  for (let i = 0; i < items.length; i++) {
    if (items[i].from <= cursorPos) active = i
    else break
  }
  const nodes = container.querySelectorAll<HTMLElement>('.outline-item')
  nodes.forEach((n, i) => n.classList.toggle('active', i === active))
}
