/**
 * 「美化输出」面板 —— Lypora 的核心新增板块。
 *
 * 三块内容，从左到右：
 *   预览（与导出同一条渲染管线） | 模板画廊（12 内置 + 用户模板） | 参数微调
 *
 * 设计要点：
 * 1. **预览就是导出结果**。预览走 `renderPagePreview` → 同一个 `captureCard`，
 *    不另画一套 DOM，避免"预览好看、导出变形"。
 * 2. **参数面板从 schema 自动生成**。PARAM_SPECS 里加一条，界面就多一个控件，
 *    不用为 12 套模板各写一份表单。
 * 3. **改动即重排**。字号/留白/是否显示页眉都会改变每页能装多少内容，所以参数一变
 *    必须重新分页，不能只换 CSS。用 160ms 防抖，拖滑块时不会卡。
 * 4. **渲染串行化**。递增 token 丢弃过期结果，快速拖滑块时旧图不会覆盖新图。
 */

import { CARD_SIZES, findSize, type CardSize } from '../export/card-themes'
import { paginate, type CardPage, type SplitMode } from '../export/card-layout'
import { buildZip, renderPagePreview, renderPagesToPdf, renderPagesToPng } from '../export/card-capture'
import { saveBinary } from '../export/save-binary'
import { BUILTIN_TEMPLATES, swatchOf } from '../export/template/builtin'
import { PARAM_SPECS, getPath, setPath, type ParamSpec } from '../export/template/params'
import { exportTemplate, importTemplate, listUserTemplates, loadCurrent, saveCurrent, saveUserTemplates } from '../export/template/io'
import { FONT_PRESETS, type CardTemplate } from '../export/template/types'
import { t } from '../i18n'

/** 参数表的 labelKey 是普通 string（模板可携带任意键），这里统一收口成 MessageKey */
const tl = (k: string): string => t(k as Parameters<typeof t>[0])
import { toast } from './toast'

export interface BeautifyDeps {
  getContent: () => string
  getDocName: () => string
}

interface State {
  template: CardTemplate
  sizeId: string
  mode: SplitMode
  withCover: boolean
  index: number
}

const KEY_LAYOUT = 'lypora:beautify:beautify-layout'

function loadLayout(): Pick<State, 'sizeId' | 'mode' | 'withCover'> {
  const def = { sizeId: 'xhs', mode: 'auto' as SplitMode, withCover: true }
  try {
    const raw = localStorage.getItem(KEY_LAYOUT)
    if (!raw) return def
    const o = JSON.parse(raw) as Partial<State>
    return {
      sizeId: findSize(o.sizeId ?? '').id,
      mode: o.mode === 'rule' || o.mode === 'none' ? o.mode : 'auto',
      withCover: o.withCover !== false,
    }
  } catch {
    return def
  }
}

function saveLayout(s: State): void {
  try {
    localStorage.setItem(KEY_LAYOUT, JSON.stringify({ sizeId: s.sizeId, mode: s.mode, withCover: s.withCover }))
  } catch {
    /* 忽略 */
  }
}

/** 深色模板的背板色：圆角被归零前，边缘露出的颜色 */
const backdropOf = (tpl: CardTemplate): string => (tpl.dark ? '#12141a' : '#ffffff')

export function createBeautifyPanel(deps: BeautifyDeps): { open: () => void } {
  let mask: HTMLElement | null = null
  let state: State = { template: loadCurrent(), ...loadLayout(), index: 0 }
  let pages: CardPage[] = []
  let size: CardSize = findSize(state.sizeId)
  let renderToken = 0
  let busy = false
  let debounce = 0

  let refs: {
    root: HTMLElement
    img: HTMLImageElement
    pos: HTMLElement
    status: HTMLElement
    gallery: HTMLElement
    mineWrap: HTMLElement
    paramHost: HTMLElement
    coverInput: HTMLInputElement
    fontSelect: HTMLSelectElement
  } | null = null

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
    const n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }

  /* ---------------- 模板画廊 ---------------- */

  function templateButton(tpl: CardTemplate, mine: boolean): HTMLElement {
    const b = el('button', 'ce-style')
    b.type = 'button'
    b.dataset.tpl = tpl.id
    b.title = `${tpl.name} · ${tpl.enName}`
    const chip = el('span', 'ce-chip')
    chip.style.background = tpl.tokens.paper.includes('gradient')
      ? tpl.tokens.paper
      : `linear-gradient(135deg, ${tpl.tokens.paper} 0 58%, ${tpl.tokens.accent} 58% 100%)`
    const name = el('span', 'ce-style-name', tpl.name)
    b.append(chip, name)
    if (mine) {
      const del = el('span', 'ce-del', '×')
      del.title = t('card.deleteTpl')
      del.onclick = (e) => {
        e.stopPropagation()
        const list = listUserTemplates().filter((x) => x.id !== tpl.id)
        saveUserTemplates(list)
        renderGallery()
        toast(t('card.removed'))
      }
      b.appendChild(del)
    }
    b.onclick = () => {
      // 切模板 = 换一整套参数；布局（尺寸/分页/封面）保持不动
      state.template = structuredClone(tpl)
      state.index = 0
      saveCurrent(state.template)
      syncControls()
      void recompute()
    }
    return b
  }

  function renderGallery(): void {
    if (!refs) return
    refs.gallery.replaceChildren(...BUILTIN_TEMPLATES.map((tpl) => templateButton(tpl, false)))
    const mine = listUserTemplates()
    refs.mineWrap.replaceChildren()
    refs.mineWrap.hidden = mine.length === 0
    if (mine.length) {
      const title = el('div', 'ce-label', t('card.mine'))
      const grid = el('div', 'ce-styles')
      grid.append(...mine.map((tpl) => templateButton(tpl, true)))
      refs.mineWrap.append(title, grid)
    }
  }

  /* ---------------- 参数控件 ---------------- */

  function renderParam(spec: ParamSpec): HTMLElement {
    const row = el('div', 'ce-param')
    // data-path 同时给自动化测试用：按参数路径定位控件，不靠"第几个 input"这种脆弱假设
    row.dataset.path = spec.path
    // data-path 同时给自动化测试用：按参数路径定位控件，不靠"第几个 input"这种脆弱假设
    row.dataset.path = spec.path
    const label = el('label', 'ce-param-label', tl(spec.labelKey))
    row.appendChild(label)

    const value = getPath(state.template, spec.path)

    const apply = async (v: unknown) => {
      state.template = setPath(state.template, spec.path, v)
      saveCurrent(state.template)
      window.clearTimeout(debounce)
      debounce = window.setTimeout(() => void recompute(), 160)
    }

    if (spec.kind === 'color') {
      const wrap = el('div', 'ce-color')
      const pick = el('input') as HTMLInputElement
      pick.type = 'color'
      pick.value = toHex6(String(value))
      pick.oninput = () => void apply(pick.value)
      const code = el('span', 'ce-hex', String(value).slice(0, 18))
      wrap.append(pick, code)
      row.appendChild(wrap)
    } else if (spec.kind === 'number') {
      const wrap = el('div', 'ce-num')
      const range = el('input') as HTMLInputElement
      range.type = 'range'
      range.min = String(spec.min ?? 0)
      range.max = String(spec.max ?? 100)
      range.step = String(spec.step ?? 1)
      range.value = String(value)
      const out = el('span', 'ce-num-val', `${value}${spec.unit ?? ''}`)
      range.oninput = () => {
        const v = Number(range.value)
        out.textContent = `${v}${spec.unit ?? ''}`
        void apply(v)
      }
      wrap.append(range, out)
      row.appendChild(wrap)
    } else if (spec.kind === 'toggle') {
      const sw = el('button', 'ce-switch') as HTMLButtonElement
      sw.type = 'button'
      sw.classList.toggle('on', !!value)
      sw.setAttribute('role', 'switch')
      sw.setAttribute('aria-checked', String(!!value))
      sw.onclick = () => {
        const next = !sw.classList.contains('on')
        sw.classList.toggle('on', next)
        sw.setAttribute('aria-checked', String(next))
        void apply(next)
      }
      row.appendChild(sw)
    } else if (spec.kind === 'select') {
      const seg = el('div', 'ce-seg')
      for (const opt of spec.options ?? []) {
        const b = el('button', 'ce-seg-btn', tl(opt.labelKey ?? opt.value))
        b.type = 'button'
        b.dataset.val = opt.value
        b.classList.toggle('on', opt.value === value)
        b.onclick = () => {
          for (const sib of Array.from(seg.children)) sib.classList.remove('on')
          b.classList.add('on')
          void apply(opt.value)
        }
        seg.appendChild(b)
      }
      row.appendChild(seg)
    }
    return row
  }

  function renderParams(): void {
    if (!refs) return
    const groups: { labelKey: string; paths: string[] }[] = [
      { labelKey: 'card.groupColor', paths: ['tokens.paper', 'tokens.ink', 'tokens.accent', 'tokens.codeBg'] },
      {
        labelKey: 'card.groupMetrics',
        paths: ['metrics.fontSize', 'metrics.lineHeight', 'metrics.titleSize', 'metrics.padX', 'metrics.radius'],
      },
      { labelKey: 'card.groupDecor', paths: ['decor.texture', 'decor.accent', 'decor.corner', 'decor.cover', 'decor.tape', 'decor.stamp'] },
      { labelKey: 'card.groupLayout', paths: ['metrics.headRule', 'metrics.pageNo'] },
    ]
    const host = refs.paramHost
    host.replaceChildren()
    for (const g of groups) {
      const section = el('div', 'ce-group')
      section.appendChild(el('div', 'ce-label', tl(g.labelKey)))
      for (const p of g.paths) {
        const spec = PARAM_SPECS.find((s) => s.path === p)
        if (spec) section.appendChild(renderParam(spec))
      }
      host.appendChild(section)
    }

    // 字体族：一个下拉同时决定 body/head，故单独处理
    const fSection = el('div', 'ce-group')
    fSection.appendChild(el('div', 'ce-label', t('card.groupFont')))
    const fRow = el('div', 'ce-param')
    fRow.appendChild(el('label', 'ce-param-label', t('card.fontFamily')))
    const sel = el('select', 'ce-select') as HTMLSelectElement
    for (const f of FONT_PRESETS) {
      const opt = el('option', undefined, tl(f.labelKey)) as HTMLOptionElement
      opt.value = f.id
      sel.appendChild(opt)
    }
    sel.value = FONT_PRESETS.find((f) => f.body === state.template.font.body)?.id ?? 'sans'
    sel.onchange = () => {
      const f = FONT_PRESETS.find((x) => x.id === sel.value) ?? FONT_PRESETS[0]
      state.template = { ...state.template, font: { ...state.template.font, body: f.body, head: f.head } }
      saveCurrent(state.template)
      void recompute()
    }
    fRow.appendChild(sel)
    fSection.appendChild(fRow)
    host.appendChild(fSection)
  }

  function syncControls(): void {
    if (!refs) return
    // 查整个面板而不是只看内置画廊：导入的模板渲染在「我的模板」里，
    // 只查 gallery 会导致导入后"当前选中"高亮丢失
    for (const b of Array.from(refs.root.querySelectorAll<HTMLElement>('.ce-style'))) {
      b.classList.toggle('on', b.dataset.tpl === state.template.id)
    }
    renderParams()
  }

  /* ---------------- 预览与重排 ---------------- */

  function setStatus(text: string, tone: 'muted' | 'ok' | 'err' = 'muted'): void {
    if (!refs) return
    refs.status.textContent = text
    refs.status.dataset.tone = tone
  }

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
      const url = await renderPagePreview(pages[state.index], size, state.template, backdropOf(state.template))
      if (token !== renderToken || !refs) return null
      refs.img.src = url
      return null
    } catch (err) {
      if (token !== renderToken) return null
      const msg = String((err as Error).message || err)
      setStatus(msg, 'err')
      console.error('[beautify]', msg)
      return msg
    }
  }

  async function recompute(): Promise<void> {
    if (!refs || busy) return
    const md = deps.getContent()
    size = findSize(state.sizeId)
    if (!md.trim()) {
      pages = []
      refs.pos.textContent = '—'
      refs.img.removeAttribute('src')
      setStatus(t('card.empty'), 'err')
      return
    }
    setStatus(t('card.working'))
    try {
      const res = paginate(md, {
        template: state.template,
        sizeId: state.sizeId,
        mode: state.mode,
        withCover: state.withCover,
        docTitle: deps.getDocName(),
      })
      pages = res.pages
      size = res.size
      saveLayout(state)
      const err = await paintPreview()
      if (err) return
      setStatus(res.clipped > 0 ? t('card.clipped', { n: res.clipped }) : t('card.pageCount', { n: pages.length }), res.clipped > 0 ? 'err' : 'ok')
    } catch (err) {
      setStatus(String((err as Error).message || err), 'err')
    }
  }

  /* ---------------- 导出 ---------------- */

  function baseName(): string {
    return deps.getDocName().replace(/\.[^.]+$/, '') || 'lypora-card'
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
      const backdrop = backdropOf(state.template)
      if (kind === 'pdf') {
        const blob = await renderPagesToPdf(pages, size, state.template, backdrop)
        const r = await saveBinary(blob, `${baseName()}.pdf`, 'application/pdf')
        setStatus(r.ok ? t('card.done') : r.canceled ? t('card.pageCount', { n: pages.length }) : t('card.failed'), r.ok ? 'ok' : r.canceled ? 'muted' : 'err')
        if (r.ok) toast(t('card.savedPdf', { path: r.path || `${baseName()}.pdf` }), 3200)
      } else {
        const res = await renderPagesToPng(pages, size, state.template, backdrop)
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
      const res = await renderPagesToPng([pages[Math.min(state.index, pages.length - 1)]], size, state.template, backdropOf(state.template))
      const blob = res.blobs[0]
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
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

  /* ---------------- 模板进出 ---------------- */

  function resetTemplate(): void {
    const src = BUILTIN_TEMPLATES.find((x) => x.id === state.template.id) ?? listUserTemplates().find((x) => x.id === state.template.id)
    if (!src) return
    state.template = structuredClone(src)
    saveCurrent(state.template)
    syncControls()
    void recompute()
  }

  function saveAsMine(): void {
    const list = listUserTemplates()
    const copy = structuredClone(state.template)
    copy.id = `mine-${Date.now().toString(36).slice(-5)}`
    copy.name = `${state.template.name}·改`
    list.unshift(copy)
    saveUserTemplates(list)
    renderGallery()
    toast(t('card.savedMine'))
  }

  function exportCurrent(): void {
    const json = exportTemplate(state.template)
    const blob = new Blob([json], { type: 'application/json' })
    void saveBinary(blob, `${state.template.id}.lyt.json`, 'application/json')
  }

  async function importFromFile(file: File): Promise<void> {
    const text = await file.text()
    const existing = listUserTemplates().map((x) => x.id)
    const res = importTemplate(text, existing)
    if (!res.ok || !res.template) {
      toast(t('card.importFailed'))
      return
    }
    const list = listUserTemplates()
    list.unshift(res.template)
    saveUserTemplates(list)
    state.template = structuredClone(res.template)
    state.index = 0
    saveCurrent(state.template)
    renderGallery()
    syncControls()
    void recompute()
    toast(t('card.imported', { name: res.template.name }))
  }

  /* ---------------- 骨架 ---------------- */

  function build(): HTMLElement {
    const root = el('div', 'ce-mask')
    const box = el('div', 'ce ce-wide')

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

    // 设置区
    const settings = el('div', 'ce-settings')

    const gTpl = el('div', 'ce-group')
    gTpl.appendChild(el('div', 'ce-label', t('card.templates')))
    const gallery = el('div', 'ce-styles')
    gTpl.appendChild(gallery)
    settings.appendChild(gTpl)

    const mineWrap = el('div', 'ce-group')
    mineWrap.hidden = true
    settings.appendChild(mineWrap)

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
        syncSegs()
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
        syncSegs()
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
      saveLayout(state)
      void recompute()
    }
    settings.appendChild(coverRow)

    const paramHost = el('div', 'ce-params')
    settings.appendChild(paramHost)

    // 模板操作
    const tplOps = el('div', 'ce-group')
    tplOps.appendChild(el('div', 'ce-label', t('card.templateOps')))
    const opRow = el('div', 'ce-seg')
    const mkOp = (label: string, fn: () => void) => {
      const b = el('button', 'ce-seg-btn', label)
      b.type = 'button'
      b.onclick = fn
      return b
    }
    opRow.append(
      mkOp(t('card.reset'), resetTemplate),
      mkOp(t('card.saveAsMine'), saveAsMine),
      mkOp(t('card.exportTpl'), exportCurrent),
    )
    const importBtn = mkOp(t('card.importTpl'), () => fileInput.click())
    opRow.appendChild(importBtn)
    tplOps.appendChild(opRow)
    settings.appendChild(tplOps)

    const fileInput = el('input') as HTMLInputElement
    fileInput.type = 'file'
    fileInput.accept = '.json,application/json'
    fileInput.hidden = true
    fileInput.onchange = () => {
      const f = fileInput.files?.[0]
      if (f) void importFromFile(f)
      fileInput.value = ''
    }
    settings.appendChild(fileInput)

    body.appendChild(settings)
    box.appendChild(body)

    // 底栏
    const foot = el('div', 'ce-foot')
    const status = el('span', 'ce-status', '')
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
    root.addEventListener('click', (e) => {
      const target = e.target as HTMLElement
      if (target === root) return close()
      const act = target.dataset.act
      if (act === 'prev') {
        state.index = Math.max(0, state.index - 1)
        void paintPreview()
      } else if (act === 'next') {
        state.index = Math.min(pages.length - 1, state.index + 1)
        void paintPreview()
      }
    })

    refs = { root, img, pos, status, gallery, mineWrap, paramHost, coverInput, fontSelect: null as unknown as HTMLSelectElement }
    return root
  }

  function syncSegs(): void {
    if (!refs) return
    for (const b of Array.from(refs.root.querySelectorAll<HTMLElement>('.ce-seg-btn'))) {
      if (b.dataset.size) b.classList.toggle('on', b.dataset.size === state.sizeId)
      if (b.dataset.mode) b.classList.toggle('on', b.dataset.mode === state.mode)
    }
    refs.coverInput.checked = state.withCover
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
    state = { template: loadCurrent(), ...loadLayout(), index: 0 }
    mask = build()
    document.body.appendChild(mask)
    document.addEventListener('keydown', onKey)
    renderGallery()
    renderParams()
    syncSegs()
    void recompute()
  }

  return { open }
}

/** `#rgb` → `#rrggbb`，喂给 <input type=color>；渐变/具名色退化成黑 */
function toHex6(v: string): string {
  const s = v.trim()
  const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s)
  if (m3) return `#${m3[1]}${m3[1]}${m3[2]}${m3[2]}${m3[3]}${m3[3]}`
  if (/^#[0-9a-f]{6}$/i.test(s)) return s
  return '#000000'
}
