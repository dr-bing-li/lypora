/**
 * 卡片导出面板 —— 左侧实时预览，右侧风格/尺寸/分页设置，底部三个出口。
 *
 * 交互原则：
 * 1. **预览就是导出结果本身**。预览走的是与导出完全相同的 `captureCard` 管线，
 *    不是另画一套 DOM —— 否则"预览好看、导出变形"这类问题会永远存在。
 * 2. **改任何设置都重新分页**：风格和尺寸会改变可容纳的行数，分页必须跟着重算，
 *    不能只换 CSS。
 * 3. **渲染串行化**：用递增 token 丢弃过期的异步结果，避免快速切换风格时
 *    旧图覆盖新图。
 */

import { CARD_SIZES, CARD_STYLES, findSize, findStyle, type CardSize } from '../export/card-themes'
import { paginate, type CardPage, type SplitMode } from '../export/card-layout'
import { buildZip, renderPagesToPdf, renderPagesToPng, renderPagePreview } from '../export/card-capture'
import { saveBinary } from '../export/save-binary'
import { t } from '../i18n'
import { toast } from './toast'

export interface CardPanelDeps {
  getContent: () => string
  getDocName: () => string
}

interface State {
  styleId: string
  sizeId: string
  mode: SplitMode
  withCover: boolean
  index: number
}

const KEY = 'lypora:card-export'

function loadState(): State {
  const def: State = { styleId: 'paper', sizeId: 'xhs', mode: 'auto', withCover: true, index: 0 }
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return def
    const s = JSON.parse(raw) as Partial<State>
    return {
      styleId: findStyle(s.styleId ?? '').id,
      sizeId: findSize(s.sizeId ?? '').id,
      mode: s.mode === 'rule' || s.mode === 'none' ? s.mode : 'auto',
      withCover: s.withCover !== false,
      index: 0,
    }
  } catch {
    return def
  }
}

function saveState(s: State): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...s, index: 0 }))
  } catch {
    /* 配额满不影响本次导出 */
  }
}

const backdropOf = (styleId: string): string => (findStyle(styleId).dark ? '#12141a' : '#ffffff')

export function createCardExportPanel(deps: CardPanelDeps): { open: () => void } {
  let mask: HTMLElement | null = null
  let state = loadState()
  let pages: CardPage[] = []
  let size: CardSize = findSize(state.sizeId)
  let renderToken = 0
  let busy = false

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
    const n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }

  function build(): HTMLElement {
    const root = el('div', 'ce-mask')
    root.innerHTML = ''

    const box = el('div', 'ce')
    const head = el('div', 'ce-head')
    head.appendChild(el('span', 'ce-title', t('card.title')))
    const x = el('button', 'ce-x', '×')
    x.type = 'button'
    x.setAttribute('aria-label', t('card.close'))
    x.onclick = close
    head.appendChild(x)
    box.appendChild(head)

    const body = el('div', 'ce-body')

    // 预览
    const preview = el('div', 'ce-preview')
    const stage = el('div', 'ce-stage')
    const img = el('img', 'ce-img') as HTMLImageElement
    img.alt = ''
    stage.appendChild(img)
    preview.appendChild(stage)
    const pager = el('div', 'ce-pager')
    const prev = el('button', 'ce-arrow', '‹')
    prev.type = 'button'
    prev.dataset.act = 'prev'
    const pos = el('span', 'ce-pos', '—')
    const next = el('button', 'ce-arrow', '›')
    next.type = 'button'
    next.dataset.act = 'next'
    pager.append(prev, pos, next)
    preview.appendChild(pager)
    body.appendChild(preview)

    // 设置
    const settings = el('div', 'ce-settings')

    const gStyle = el('div', 'ce-group')
    gStyle.appendChild(el('div', 'ce-label', t('card.style')))
    const styleGrid = el('div', 'ce-styles')
    for (const s of CARD_STYLES) {
      const b = el('button', 'ce-style')
      b.type = 'button'
      b.dataset.style = s.id
      b.title = s.label
      const chip = el('span', 'ce-chip')
      chip.style.background = `linear-gradient(135deg, ${s.swatch[0]} 0 49%, ${s.swatch[1]} 51% 100%)`
      const name = el('span', 'ce-style-name', s.label)
      b.append(chip, name)
      b.onclick = () => {
        state.styleId = s.id
        applyState()
        void recompute()
      }
      styleGrid.appendChild(b)
    }
    gStyle.appendChild(styleGrid)
    settings.appendChild(gStyle)

    const gSize = el('div', 'ce-group')
    gSize.appendChild(el('div', 'ce-label', t('card.size')))
    const sizes = el('div', 'ce-seg')
    for (const s of CARD_SIZES) {
      const b = el('button', 'ce-seg-btn', s.label)
      b.type = 'button'
      b.dataset.size = s.id
      b.onclick = () => {
        state.sizeId = s.id
        state.index = 0
        applyState()
        void recompute()
      }
      sizes.appendChild(b)
    }
    gSize.appendChild(sizes)
    settings.appendChild(gSize)

    const gMode = el('div', 'ce-group')
    gMode.appendChild(el('div', 'ce-label', t('card.split')))
    const modes = el('div', 'ce-seg')
    for (const m of [
      { id: 'auto', label: t('card.splitAuto') },
      { id: 'rule', label: t('card.splitRule') },
      { id: 'none', label: t('card.splitNone') },
    ] as const) {
      const b = el('button', 'ce-seg-btn', m.label)
      b.type = 'button'
      b.dataset.mode = m.id
      b.onclick = () => {
        state.mode = m.id
        state.index = 0
        applyState()
        void recompute()
      }
      modes.appendChild(b)
    }
    gMode.appendChild(modes)
    settings.appendChild(gMode)

    const coverRow = el('label', 'ce-check')
    const coverInput = el('input') as HTMLInputElement
    coverInput.type = 'checkbox'
    coverRow.append(coverInput, el('span', undefined, t('card.cover')))
    coverInput.onchange = () => {
      state.withCover = coverInput.checked
      state.index = 0
      applyState()
      void recompute()
    }
    settings.appendChild(coverRow)

    body.appendChild(settings)
    box.appendChild(body)

    // 底栏
    const foot = el('div', 'ce-foot')
    const status = el('span', 'ce-status', '')
    status.dataset.role = 'status'
    const mk = (act: string, label: string, primary = false) => {
      const b = el('button', primary ? 'ce-btn primary' : 'ce-btn', label)
      b.type = 'button'
      b.dataset.act = act
      return b
    }
    const bPng = mk('png', t('card.exportPng'), true)
    const bPdf = mk('pdf', t('card.exportPdf'))
    const bCopy = mk('copy', t('card.copy'))
    bPng.onclick = () => void doExport('png')
    bPdf.onclick = () => void doExport('pdf')
    bCopy.onclick = () => void doCopy()
    foot.append(status, bCopy, bPdf, bPng)
    box.appendChild(foot)

    root.appendChild(box)

    // 翻页 / 点遮罩关闭
    root.addEventListener('click', (e) => {
      const target = e.target as HTMLElement
      if (target === root) {
        close()
        return
      }
      const act = target.dataset.act
      if (act === 'prev') {
        state.index = Math.max(0, state.index - 1)
        void paintPreview()
      } else if (act === 'next') {
        state.index = Math.min(pages.length - 1, state.index + 1)
        void paintPreview()
      }
    })

    // 保留引用，避免每次查询 DOM
    refs = { root, img, pos, status, coverInput, box }
    return root
  }

  let refs: {
    root: HTMLElement
    img: HTMLImageElement
    pos: HTMLElement
    status: HTMLElement
    coverInput: HTMLInputElement
    box: HTMLElement
  } | null = null

  function applyState(): void {
    if (!refs) return
    refs.root.querySelectorAll<HTMLElement>('.ce-style').forEach((b) => {
      b.classList.toggle('on', b.dataset.style === state.styleId)
    })
    refs.root.querySelectorAll<HTMLElement>('.ce-seg-btn').forEach((b) => {
      b.classList.toggle('on', b.dataset.size === state.sizeId || b.dataset.mode === state.mode)
    })
    refs.coverInput.checked = state.withCover
  }

  function setStatus(text: string, tone: 'muted' | 'ok' | 'err' = 'muted'): void {
    if (!refs) return
    refs.status.textContent = text
    refs.status.dataset.tone = tone
  }

  /** 返回是否成功；失败时把原始错误交给调用方，避免被"共 N 页"覆盖掉 */
  async function paintPreview(): Promise<string | null> {
    if (!refs) return null
    const token = ++renderToken
    if (!pages.length) {
      refs.img.removeAttribute('src')
      refs.pos.textContent = '—'
      return null
    }
    state.index = Math.min(Math.max(0, state.index), pages.length - 1)
    refs.pos.textContent = `${state.index + 1} / ${pages.length}`
    try {
      const url = await renderPagePreview(pages[state.index], size, state.styleId, backdropOf(state.styleId))
      if (token !== renderToken || !refs) return null
      refs.img.src = url
      return null
    } catch (err) {
      if (token !== renderToken) return null
      const msg = String((err as Error).message || err)
      setStatus(msg, 'err')
      console.error('[card-export]', msg)
      return msg
    }
  }

  async function recompute(): Promise<void> {
    if (!refs || busy) return
    const md = deps.getContent()
    if (!md.trim()) {
      pages = []
      size = findSize(state.sizeId)
      refs.pos.textContent = '—'
      refs.img.removeAttribute('src')
      setStatus(t('card.empty'), 'err')
      return
    }
    setStatus(t('card.working'))
    try {
      const res = paginate(md, {
        styleId: state.styleId,
        sizeId: state.sizeId,
        mode: state.mode,
        withCover: state.withCover,
        docTitle: deps.getDocName(),
      })
      pages = res.pages
      size = res.size
      saveState(state)
      const paintErr = await paintPreview()
      if (paintErr) return
      if (res.clipped > 0) setStatus(t('card.clipped', { n: res.clipped }), 'err')
      else setStatus(t('card.pageCount', { n: pages.length }), 'ok')
    } catch (err) {
      setStatus(String((err as Error).message || err), 'err')
    }
  }

  function baseName(): string {
    return deps.getDocName().replace(/\.[^.]+$/, '') || 'lypora'
  }

  async function doExport(kind: 'png' | 'pdf'): Promise<void> {
    if (busy || !refs) return
    if (!pages.length) {
      toast(t('card.empty'))
      return
    }
    busy = true
    setStatus(t('card.working'))
    try {
      const backdrop = backdropOf(state.styleId)
      if (kind === 'pdf') {
        const blob = await renderPagesToPdf(pages, size, state.styleId, backdrop)
        const r = await saveBinary(blob, `${baseName()}.pdf`, 'application/pdf')
        setStatus(r.ok ? t('card.done') : r.canceled ? t('card.pageCount', { n: pages.length }) : t('card.failed'), r.ok ? 'ok' : r.canceled ? 'muted' : 'err')
        if (r.ok) toast(t('card.savedPdf', { path: r.path || `${baseName()}.pdf` }), 3200)
      } else {
        const res = await renderPagesToPng(pages, size, state.styleId, backdrop)
        if (res.blobs.length === 1) {
          const r = await saveBinary(res.blobs[0], `${baseName()}-1.png`, 'image/png')
          if (r.ok) toast(t('card.savedPng', { path: r.path || `${baseName()}-1.png` }), 3200)
        } else {
          const entries = await Promise.all(
            res.blobs.map(async (b, i) => ({
              name: `${baseName()}-${String(i + 1).padStart(2, '0')}.png`,
              data: new Uint8Array(await b.arrayBuffer()),
            })),
          )
          const zip = buildZip(entries)
          const r = await saveBinary(zip, `${baseName()}-cards.zip`, 'application/zip')
          if (r.ok) toast(t('card.savedZip', { n: res.blobs.length }), 3600)
        }
        setStatus(t('card.done'), 'ok')
      }
    } catch (err) {
      setStatus(String((err as Error).message || err), 'err')
      toast(t('card.failed'))
    } finally {
      busy = false
    }
  }

  async function doCopy(): Promise<void> {
    if (busy || !pages.length) return
    busy = true
    try {
      const res = await renderPagesToPng([pages[Math.min(state.index, pages.length - 1)]], size, state.styleId, backdropOf(state.styleId))
      const blob = res.blobs[0]
      const anyWin = window as unknown as { ClipboardItem?: typeof ClipboardItem }
      if (anyWin.ClipboardItem && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        toast(t('card.copied'))
      } else {
        toast(t('card.copyUnsupported'))
      }
    } catch {
      toast(t('card.failed'))
    } finally {
      busy = false
    }
  }

  function close(): void {
    if (mask) mask.remove()
    mask = null
    refs = null
    document.removeEventListener('keydown', onKey)
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  function open(): void {
    close()
    state = loadState()
    mask = build()
    document.body.appendChild(mask)
    applyState()
    document.addEventListener('keydown', onKey)
    void recompute()
  }

  return { open }
}
