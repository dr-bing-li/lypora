export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  )
}

export function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): T {
  let t: number | undefined
  return ((...args: never[]) => {
    if (t !== undefined) clearTimeout(t)
    t = window.setTimeout(() => fn(...args), ms)
  }) as T
}

export function fmtNum(n: number): string {
  return n.toLocaleString('zh-CN')
}

/** 极简行内 Markdown 渲染，仅用于表格单元格等非编辑区域 */
export function renderInlineMd(text: string): string {
  let s = escapeHtml(text)
  // 行内代码优先，避免其中的符号被后续规则吃掉
  const codes: string[] = []
  s = s.replace(/`([^`]+)`/g, (_m, c: string) => {
    codes.push(c)
    return `\u0000${codes.length - 1}\u0000`
  })
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, '<img alt="$1" src="$2" style="max-height:2.4em;vertical-align:middle">')
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, '<a href="$2" class="md-link">$1</a>')
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>')
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  s = s.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>')
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>')
  s = s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => `<code class="md-code-inline">${codes[Number(i)]}</code>`)
  return s
}

/** 按未转义的竖线切分表格行 */
export function splitTableRow(line: string): string[] {
  const cells: string[] = []
  let cur = ''
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '\\' && line[i + 1] === '|') {
      cur += '|'
      i++
    } else if (ch === '|') {
      cells.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  cells.push(cur)
  // 去掉表格行首尾因 | 产生的空单元
  if (cells.length && cells[0].trim() === '') cells.shift()
  if (cells.length && cells[cells.length - 1].trim() === '') cells.pop()
  return cells.map((c) => c.trim())
}

export interface TableModel {
  aligns: Array<'left' | 'center' | 'right'>
  header: string[]
  rows: string[][]
}

export function parseTable(src: string): TableModel {
  const lines = src.split('\n').filter((l) => l.trim() !== '')
  const header = lines.length ? splitTableRow(lines[0]) : []
  let aligns: Array<'left' | 'center' | 'right'> = header.map(() => 'left')
  let bodyStart = 1
  if (lines.length > 1 && /^[\s:|-]+$/.test(lines[1])) {
    aligns = splitTableRow(lines[1]).map((c) => {
      const left = c.startsWith(':')
      const right = c.endsWith(':')
      if (left && right) return 'center'
      if (right) return 'right'
      return 'left'
    })
    bodyStart = 2
  }
  const rows = lines.slice(bodyStart).map((l) => {
    const cells = splitTableRow(l)
    while (cells.length < header.length) cells.push('')
    return cells.slice(0, header.length)
  })
  while (aligns.length < header.length) aligns.push('left')
  return { aligns, header, rows }
}
