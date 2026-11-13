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
import { BG_PREVIEW, BG_PREVIEW_SIZE, PARAM_SPECS, getPath, setPath, type ParamSpec } from '../export/template/params'
import { exportTemplate, importTemplate, listUserTemplates, loadCurrent, sanitizeBgImage, saveCurrent, saveUserTemplates } from '../export/template/io'
import { FONT_PRESETS, BG_PRESETS, type CardTemplate } from '../export/template/types'
import { t } from '../i18n'
import { askText } from './ask'

/** 参数表的 labelKey 是普通 string（模板可携带任意键），这里统一收口成 MessageKey */
const tl = (k: string): string => t(k as Parameters<typeof t>[0])
import { toast } from './toast'

export interface BeautifyDeps {
  getContent: () => string
  getDocName: () => string
}

/** 与外界共享的布局态：一级「排版」菜单按它画勾选、按它改值 */
export interface BeautifyLayout {
  sizeId: string
  mode: SplitMode
  withCover: boolean
}

export interface BeautifyHandle {
  open: () => void
  /** 菜单要画"当前选的是哪个尺寸/分页/封面" */
  getLayout: () => BeautifyLayout
  /** 菜单直接改布局；面板开着就顺手刷一遍 */
  setLayout: (p: Partial<BeautifyLayout>) => void
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

export function createBeautifyPanel(deps: BeautifyDeps): BeautifyHandle {
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
    bgInput: HTMLInputElement
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
    // 三色小样（纸 / 强调 / 墨）：v0.9.0 只有纸+强调两色斜切，
    // 素纸与极简黑白在缩略图上长得一样，选不出"这套到底多深"
    chip.style.background = swatchOf(tpl).css
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

  /** 统一写入口：改字段 → 存 → 防抖重排（背景/装订等专用控件也走这里） */
  function applyPath(path: string, value: unknown, rebuild = false): void {
    state.template = setPath(state.template, path, value)
    saveCurrent(state.template)
    if (rebuild) renderParams()
    window.clearTimeout(debounce)
    debounce = window.setTimeout(() => void recompute(), 160)
  }

  function renderParam(spec: ParamSpec): HTMLElement {
    const row = el('div', 'ce-param')
    // data-path 同时给自动化测试用：按参数路径定位控件，不靠"第几个 input"这种脆弱假设
    row.dataset.path = spec.path
    const label = el('label', 'ce-param-label', tl(spec.labelKey))
    row.appendChild(label)

    const value = getPath(state.template, spec.path)

    const apply = async (v: unknown) => applyPath(spec.path, v)

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
      const min = spec.min ?? 0
      const max = spec.max ?? 100
      const step = spec.step ?? 1
      // 单位并入标签（"左右留白 (px)"）：数值列只放数字才能右对齐成一列
      if (spec.unit) label.textContent += ` (${spec.unit.trim()})`

      const wrap = el('div', 'ce-num')
      const range = el('input') as HTMLInputElement
      range.type = 'range'
      range.min = String(min)
      range.max = String(max)
      range.step = String(step)
      range.value = String(value)
      range.setAttribute('aria-label', tl(spec.labelKey))

      /* 数值可以直接输入（审计 LAYOUT-1）：滑块对不准"正好 40px"，
         做系列模板时又要复用同一组数值。视觉上仍是行末的一列数字。 */
      const out = el('input', 'ce-num-val') as HTMLInputElement
      out.type = 'number'
      out.inputMode = step < 1 ? 'decimal' : 'numeric'
      out.min = String(min)
      out.max = String(max)
      out.step = String(step)
      out.value = String(value)
      out.setAttribute('aria-label', tl(spec.labelKey))

      // 滑块与输入框共用一个提交函数：先 clamp 到 spec 的范围再落盘
      const commit = (raw: number) => {
        const v = Math.min(max, Math.max(min, Number.isFinite(raw) ? raw : Number(value)))
        range.value = String(v)
        out.value = String(v)
        void apply(v)
      }
      range.oninput = () => commit(Number(range.value))
      // 打字过程中只在范围内跟随，越界留给失焦 —— 否则想打 "40" 时第一个 "4" 就被拉到 min
      out.oninput = () => {
        if (out.value === '' || out.value === '-') return
        const v = Number(out.value)
        if (Number.isFinite(v) && v >= min && v <= max) commit(v)
      }
      out.onblur = () => commit(Number(out.value))
      out.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          out.blur()
        }
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

  /** 背景组：预设用缩略图按钮（一眼看出是牛皮纸还是横线），自定义图走上传 */
  function renderBgGroup(labelKey: string): HTMLElement {
    const g = el('div', 'ce-group')
    g.dataset.group = 'bg'
    g.appendChild(el('div', 'ce-label', tl(labelKey)))

    const grid = el('div', 'ce-bgs')
    for (const id of BG_PRESETS) {
      const b = el('button', 'ce-bg') as HTMLButtonElement
      b.type = 'button'
      b.dataset.bg = id
      b.title = tl(`tpl.bg.${id}`)
      if (id === 'none') {
        b.classList.add('is-none')
        b.textContent = '∅'
      } else {
        b.style.backgroundImage = BG_PREVIEW[id]
        b.style.backgroundSize = BG_PREVIEW_SIZE[id] ?? 'auto'
      }
      b.classList.toggle('on', state.template.decor.bg === id && !state.template.decor.bgImage)
      b.onclick = () => {
        // 选预设时清掉自定义图：否则用户点了"方格"却还是自己那张照片，
        // 只会觉得按钮坏了（这正是 v0.9.0 装饰"无效"的同类观感问题）
        state.template = setPath(state.template, 'decor.bgImage', '')
        applyPath('decor.bg', id, true)
      }
      grid.appendChild(b)
    }
    g.appendChild(grid)

    const row = el('div', 'ce-seg')
    const up = el('button', 'ce-seg-btn', t('card.bgUpload')) as HTMLButtonElement
    up.type = 'button'
    up.dataset.act = 'bg-upload'
    up.onclick = () => refs?.bgInput.click()
    const clr = el('button', 'ce-seg-btn', t('card.bgClear')) as HTMLButtonElement
    clr.type = 'button'
    clr.dataset.act = 'bg-clear'
    clr.disabled = !state.template.decor.bgImage
    clr.onclick = () => applyPath('decor.bgImage', '', true)
    row.append(up, clr)
    g.appendChild(row)

    if (state.template.decor.bgImage) {
      const thumb = el('img', 'ce-bg-thumb') as HTMLImageElement
      thumb.src = state.template.decor.bgImage
      thumb.alt = ''
      g.appendChild(thumb)
    }

    const opacity = PARAM_SPECS.find((s) => s.path === 'decor.bgOpacity')
    if (opacity) g.appendChild(renderParam(opacity))
    return g
  }

  function renderParams(): void {
    if (!refs) return
    const groups: { labelKey: string; paths: string[] }[] = [
      { labelKey: 'card.groupColor', paths: ['tokens.paper', 'tokens.ink', 'tokens.accent', 'tokens.codeBg'] },
      {
        labelKey: 'card.groupMetrics',
        paths: ['metrics.fontSize', 'metrics.lineHeight', 'metrics.titleSize', 'metrics.padX', 'metrics.radius'],
      },
      // paths 为空 = 用专用控件渲染（背景要缩略图，不能退化成一行文字 select）
      { labelKey: 'card.groupBg', paths: [] },
      {
        labelKey: 'card.groupDecor',
        paths: ['decor.texture', 'decor.accent', 'decor.corner', 'decor.cover', 'decor.binding', 'decor.tape', 'decor.stamp'],
      },
      { labelKey: 'card.groupLayout', paths: ['metrics.headRule', 'metrics.pageNo'] },
    ]
    const host = refs.paramHost
    host.replaceChildren()
    for (const g of groups) {
      if (!g.paths.length) {
        host.appendChild(renderBgGroup(g.labelKey))
        continue
      }
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

  /**
   * 存为我的模板：名字由用户定。
   *
   * v0.9.0 写死成「原名·改」，结果是"我的模板"里一堆同名的「渐变海报·改」，
   * 存到第三套就分不清谁是谁。现在弹输入框，默认值仍给「原名·改」，
   * 但重名时自动加序号，绝不静默覆盖。
   */
  async function saveAsMine(): Promise<void> {
    const list = listUserTemplates()
    const base = state.template.name.replace(/·改\d*$/, '').trim() || t('card.mine')
    const taken = new Set([...BUILTIN_TEMPLATES.map((x) => x.name), ...list.map((x) => x.name)])
    let guess = `${base}·改`
    for (let i = 2; taken.has(guess) && i < 100; i++) guess = `${base}·改${i}`

    const name = await askText({
      title: t('card.nameTitle'),
      hint: t('card.nameHint'),
      value: guess,
      maxLength: 24,
    })
    if (!name) return
    if (taken.has(name)) {
      toast(t('card.nameTaken', { name }))
      return
    }

    const copy = structuredClone(state.template)
    copy.id = `mine-${Date.now().toString(36).slice(-5)}`
    copy.name = name
    list.unshift(copy)
    saveUserTemplates(list)
    renderGallery()
    syncControls()
    toast(t('card.savedMine', { name }))
  }

  /**
   * 上传自定义背景图。
   * 先压到 1200px 内再转 dataURL —— 原图直接塞 localStorage 会顶爆 5MB 配额，
   * 而且 dataURL 会被写进 CSS 变量，60MB 的字符串会让每次重排都卡。
   */
  async function onBgFile(file: File): Promise<void> {
    try {
      const url = await shrinkImage(file, 1200, 0.82)
      if (!url) {
        toast(t('card.bgFailed'))
        return
      }
      if (!sanitizeBgImage(url)) {
        toast(t('card.bgTooLarge'))
        return
      }
      applyPath('decor.bgImage', url, true)
      toast(t('card.bgApplied'))
    } catch {
      toast(t('card.bgFailed'))
    }
  }

  function exportCurrent(): void {
    const json = exportTemplate(state.template)
    const blob = new Blob([json], { type: 'application/json' })
    void saveBinary(blob, `${state.template.id}.lyt.json`, 'application/json')
  }

  async function importFromFile(file: File): Promise<void> {    const text = await file.text()
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
    // 收起预览：手机上预览固定吃 34vh，参数区只剩 49%（实测 389/800），
    // 调个字号要滑好几屏；收起后参数区拿到 79%。桌面同样可用。
    const fold = el('button', 'ce-prev-toggle', t('card.hidePrev'))
    fold.type = 'button'
    fold.setAttribute('aria-expanded', 'true')
    fold.onclick = () => {
      const off = box.classList.toggle('ce-prev-collapsed')
      fold.textContent = t(off ? 'card.showPrev' : 'card.hidePrev')
      fold.setAttribute('aria-expanded', String(!off))
    }
    pager.append(prev, pos, next, fold)
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
      const b = el('button', 'ce-seg-btn', tl(s.labelKey))
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
      mkOp(t('card.saveAsMine'), () => void saveAsMine()),
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

    const bgInput = el('input') as HTMLInputElement
    bgInput.type = 'file'
    bgInput.accept = 'image/*'
    bgInput.hidden = true
    bgInput.dataset.act = 'bg-file'
    bgInput.onchange = () => {
      const f = bgInput.files?.[0]
      if (f) void onBgFile(f)
      bgInput.value = ''
    }
    settings.appendChild(bgInput)

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

    refs = { root, img, pos, status, gallery, mineWrap, paramHost, coverInput, bgInput, fontSelect: null as unknown as HTMLSelectElement }
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
    document.documentElement.style.removeProperty('--ce-top')
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  /**
   * 整屏铺开的顶边：菜单栏下沿 + 标签栏（显示时）的高度。
   * 不用固定 40px：手机菜单栏是 44px，标签栏在不同模式下会显隐，写死必然错位。
   */
  function topOffset(): number {
    // 顶栏从 v0.11.2 起只有一行（菜单与标签并排），"菜单栏高度 + 标签栏高度"这种
    // 逐项累加的写法已经不对了。直接量正文区的上沿：无论顶栏里有几层，
    // 面板永远从"内容区开始的地方"铺下来，手机上同理。
    const ws = document.querySelector<HTMLElement>('.workspace')?.getBoundingClientRect().top
    if (ws !== undefined) return Math.round(ws)
    return 0
  }

  function open(): void {
    close()
    state = { template: loadCurrent(), ...loadLayout(), index: 0 }
    document.documentElement.style.setProperty('--ce-top', `${topOffset()}px`)
    mask = build()
    document.body.appendChild(mask)
    document.addEventListener('keydown', onKey)
    renderGallery()
    renderParams()
    syncSegs()
    void recompute()
  }

  function getLayout(): BeautifyLayout {
    return { sizeId: state.sizeId, mode: state.mode, withCover: state.withCover }
  }

  /**
   * 菜单里改尺寸/分页/封面。
   * 面板没开时只落 localStorage（open() 会读回来），开着时立刻重排 ——
   * 否则菜单勾选变了、右边预览还是旧的，就是这个功能最典型的"点了没反应"。
   */
  function setLayout(p: Partial<BeautifyLayout>): void {
    state = { ...state, ...p, index: 0 }
    saveLayout(state)
    if (mask) {
      syncSegs()
      void recompute()
    }
  }

  return { open, getLayout, setLayout }
}

/**
 * 把用户选中的图片压到 maxW 以内，返回 dataURL。
 * 用 createImageBitmap 而不是 <img> + FileReader：前者能直接给 canvas 用，
 * 省一次 base64 往返，也不必等 onload。
 */
async function shrinkImage(file: File, maxW: number, quality: number): Promise<string | null> {
  if (!/^image\//.test(file.type)) return null
  const bitmap = await createImageBitmap(file)
  const w = Math.max(1, Math.round(bitmap.width > maxW ? maxW : bitmap.width))
  const h = Math.max(1, Math.round((bitmap.height * w) / bitmap.width))
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const ctx = cv.getContext('2d')
  if (!ctx) {
    bitmap.close?.()
    return null
  }
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close?.()
  // webp 支持透明且比 png 小得多；不支持 webp 的引擎会自动回落成 png dataURL
  let url = cv.toDataURL('image/webp', quality)
  if (!url.startsWith('data:image/webp')) url = cv.toDataURL('image/jpeg', quality)
  return url
}

/** `#rgb` → `#rrggbb`，喂给 <input type=color>；渐变/具名色退化成黑 */
function toHex6(v: string): string {
  const s = v.trim()
  const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s)
  if (m3) return `#${m3[1]}${m3[1]}${m3[2]}${m3[2]}${m3[3]}${m3[3]}`
  if (/^#[0-9a-f]{6}$/i.test(s)) return s
  return '#000000'
}
