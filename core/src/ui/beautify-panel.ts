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
import { decoHtml } from '../export/card-layout'
import { buildZip, renderPagePreview, renderPagesToPdf, renderPagesToPng } from '../export/card-capture'
import { saveBinary } from '../export/save-binary'
import { BUILTIN_TEMPLATES, templateName } from '../export/template/builtin'
import { BG_PREVIEW, BG_PREVIEW_SIZE, PARAM_SPECS, headSpecs, ornSpecs, HEAD_LEVEL_LIST, getPath, setPath, type ParamSpec } from '../export/template/params'
import {
  exportTemplate,
  importTemplate,
  listUserTemplates,
  loadCurrent,
  sanitizeBgImage,
  sanitizeStampImage,
  saveCurrent,
  saveUserTemplates,
} from '../export/template/io'
import { buildSamplePackage, exportPackage, importPackage } from '../export/template/pkg'
import { compileTemplate, CARD_BASE_CSS, decorAttrs } from '../export/template/compile'
import { FONT_PRESETS, BG_PRESETS, type CardTemplate } from '../export/template/types'
import { t } from '../i18n'
import { escapeHtml } from '../util'
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
    settings: HTMLElement
    img: HTMLImageElement
    pos: HTMLElement
    status: HTMLElement
    gallery: HTMLElement
    mineWrap: HTMLElement
    paramHost: HTMLElement
    coverInput: HTMLInputElement
    bgInput: HTMLInputElement
    stampInput: HTMLInputElement
    fontSelect: HTMLSelectElement
  } | null = null

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
    const n = document.createElement(tag)
    if (cls) n.className = cls
    if (text != null) n.textContent = text
    return n
  }

  /* ---------------- 模板画廊 ---------------- */

  /**
   * 模板缩略图 = **真卡片**（同一份 `CARD_BASE_CSS` + 该模板自己编译出的变量），
   * 只是把字号/留白压到缩略图尺度。
   *
   * 为什么不把整页等比压扁：一张 720px 宽的卡片压到 240px 是 0.33 倍，
   * 15px 正文只剩 5px，屏幕上就是一片灰糊 —— 20 套模板看起来都一样。
   * 也不走 canvas 光栅化：28 套 × 每套一次 SVG→canvas，开面板要等好几秒，
   * 而这里本来就是 DOM，直接画更快，还能随时跟着参数变。
   */
  function sampleHtml(tpl: CardTemplate): string {
    const name = escapeHtml(templateName(tpl))
    const body = escapeHtml(t('card.sampleBody'))
    const quote = escapeHtml(t('card.sampleQuote'))
    return (
      `<div class="ly-card ly-sample" data-tpl="${tpl.id}"${decorAttrs(tpl)}` +
      // --c-band-k / --c-pad-k / --o-k 是缩略图专用的压缩系数：外圈带 30px、内面板
      // 内边距 12px、贴纸 76px 直接搬进 170px 宽的缩略图会吃掉大半张卡（v0.13.0 实测
      // 波普撞印的 .ly-body 溢出 21px），等比压一下才看得出"黄边围白卡 + 贴纸"
      ` style="--ly-card-w:100%;--ly-card-h:100%;--c-lh:1.45;--c-band-k:0.46;--c-pad-k:0.34;--o-k:0.52">` +
      `<i class="ly-bg"></i>${decoHtml(tpl)}` +
      `<div class="ly-inner">` +
      (tpl.metrics.headRule ? `<div class="ly-head"><span class="ly-doc">Lypora</span></div>` : '') +
      `<div class="ly-body">` +
      `<h2 class="ly-sample-h">${name}</h2>` +
      `<p>${body}</p>` +
      `<blockquote><p>${quote}</p></blockquote>` +
      `</div></div></div>`
    )
  }

  /** 所有模板（内置 + 我的）—— 懒渲染时按 id 回查 */
  function allTemplates(): CardTemplate[] {
    return [...BUILTIN_TEMPLATES, ...listUserTemplates()]
  }

  let io: IntersectionObserver | null = null

  function observeSamples(root: HTMLElement): void {
    io?.disconnect()
    io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          const box = e.target as HTMLElement
          const box2 = box.querySelector<HTMLElement>('.ce-thumb-inner')
          const id = box.dataset.tpl
          if (box2 && id && !box2.firstChild) {
            const tpl = allTemplates().find((x) => x.id === id)
            if (tpl) box2.innerHTML = sampleHtml(tpl)
          }
          io?.unobserve(box)
        }
      },
      { root, rootMargin: '240px 0px' },
    )
    for (const b of Array.from(root.querySelectorAll<HTMLElement>('.ce-style[data-tpl]'))) io.observe(b)
  }

  function templateButton(tpl: CardTemplate, mine: boolean): HTMLElement {
    const b = el('button', 'ce-style')
    b.type = 'button'
    b.dataset.tpl = tpl.id
    b.title = `${templateName(tpl)} · ${tpl.enName}`
    const thumb = el('span', 'ce-thumb')
    const inner = el('span', 'ce-thumb-inner')
    thumb.appendChild(inner)
    const name = el('span', 'ce-style-name', templateName(tpl))
    b.append(thumb, name)
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

  /** 28 套模板的样式一次编译好塞进一个 <style>：缩略图靠 data-tpl 命中自己的变量块 */
  function ensureSampleCss(templates: CardTemplate[]): void {
    let st = document.getElementById('ce-sample-css') as HTMLStyleElement | null
    if (!st) {
      st = document.createElement('style')
      st.id = 'ce-sample-css'
      document.head.appendChild(st)
    }
    st.textContent = CARD_BASE_CSS + '\n' + templates.map((tpl) => compileTemplate(tpl)).join('\n')
  }

  function renderGallery(): void {
    if (!refs) return
    const mine = listUserTemplates()
    const all = [...BUILTIN_TEMPLATES, ...mine]
    ensureSampleCss(all)
    refs.gallery.replaceChildren(...BUILTIN_TEMPLATES.map((tpl) => templateButton(tpl, false)))
    refs.mineWrap.replaceChildren()
    refs.mineWrap.hidden = mine.length === 0
    if (mine.length) {
      const title = el('div', 'ce-label', t('card.mine'))
      const grid = el('div', 'ce-styles')
      grid.append(...mine.map((tpl) => templateButton(tpl, true)))
      refs.mineWrap.append(title, grid)
    }
    observeSamples(refs.settings)
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
      const raw = String(value ?? '')
      const pick = el('input') as HTMLInputElement
      pick.type = 'color'
      pick.value = raw ? toHex6(raw) : '#ffffff'
      pick.oninput = () => void apply(pick.value)
      // 空字符串是有语义的（标题底色空 = 不铺底、面板底色空 = 不画白卡），
      // 而色板控件表达不了"空"，所以码位直接写「—」并另给一枚清除键
      const code = el('span', 'ce-hex', raw ? raw.slice(0, 18) : '—')
      wrap.appendChild(pick)
      if (spec.clearable) {
        const clr = el('button', 'ce-mini', '∅') as HTMLButtonElement
        clr.type = 'button'
        clr.title = t('card.clearColor')
        clr.dataset.act = 'clear-color'
        clr.disabled = !raw
        clr.onclick = () => {
          code.textContent = '—'
          clr.disabled = true
          void apply('')
        }
        // 清除键放在色板与码位之间：码位（.ce-hex）必须留在最右，
        // 否则"有清除键的行"整列右移 30px，数值列就不共线了（ui-check LAYOUT-4）
        wrap.appendChild(clr)
      }
      wrap.appendChild(code)
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
        // 用字符串比较：numeric 下拉的值存进模板后是数字，而 option 的 value 永远是字符串
        b.classList.toggle('on', String(opt.value) === String(value))
        b.onclick = () => {
          for (const sib of Array.from(seg.children)) sib.classList.remove('on')
          b.classList.add('on')
          // 数字型下拉（字重）要转回 number：'0' 是 truthy，写下去会变成 `font-weight: 0`
          void apply(spec.numeric ? Number(opt.value) : opt.value)
        }
        seg.appendChild(b)
      }
      row.appendChild(seg)
    } else if (spec.kind === 'text') {
      // 页眉页脚这类自由文本：失焦/回车才提交，打字过程中不重排（每敲一个字都重排会卡）
      const inp = el('input', 'ce-text') as HTMLInputElement
      inp.type = 'text'
      inp.value = String(value ?? '')
      inp.maxLength = spec.maxLength ?? 40
      if (spec.placeholderKey) inp.placeholder = tl(spec.placeholderKey)
      inp.setAttribute('aria-label', tl(spec.labelKey))
      const commit = () => {
        const v = inp.value.trim()
        if (v !== String(getPath(state.template, spec.path) ?? '')) void apply(v)
      }
      inp.onblur = commit
      inp.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          inp.blur()
        }
      }
      row.appendChild(inp)
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

  /** 印章组：预设图形 + 位置 + 大小 + 自定义上传（透明 PNG） */
  function renderStampGroup(labelKey: string): HTMLElement {
    const g = el('div', 'ce-group')
    g.dataset.group = 'stamp'
    g.appendChild(el('div', 'ce-label', tl(labelKey)))

    const on = el('div', 'ce-param')
    on.appendChild(renderToggle(t('tpl.p.stamp'), state.template.decor.stamp, (v) => applyPath('decor.stamp', v)))
    g.appendChild(on)

    for (const path of ['decor.stampPreset', 'decor.stampPos', 'decor.stampSize']) {
      const spec = PARAM_SPECS.find((s) => s.path === path)
      if (spec) g.appendChild(renderParam(spec))
    }

    const row = el('div', 'ce-seg')
    const up = el('button', 'ce-seg-btn', t('card.stampUpload')) as HTMLButtonElement
    up.type = 'button'
    up.dataset.act = 'stamp-upload'
    up.onclick = () => refs?.stampInput.click()
    const clr = el('button', 'ce-seg-btn', t('card.stampClear')) as HTMLButtonElement
    clr.type = 'button'
    clr.dataset.act = 'stamp-clear'
    clr.disabled = !state.template.decor.stampImage
    clr.onclick = () => applyPath('decor.stampImage', '', true)
    row.append(up, clr)
    g.appendChild(row)

    if (state.template.decor.stampImage) {
      const thumb = el('img', 'ce-bg-thumb') as HTMLImageElement
      thumb.src = state.template.decor.stampImage
      thumb.alt = ''
      thumb.style.maxWidth = '120px'
      g.appendChild(thumb)
    }
    return g
  }

  /** 单独的开关行（印章这类要跟在一组控件最前面，又不能进 PARAM_SPECS 顺序里） */
  function renderToggle(label: string, value: boolean, onChange: (v: boolean) => void): HTMLElement {    const row = el('div', 'ce-param')
    row.appendChild(el('label', 'ce-param-label', label))
    const sw = el('button', 'ce-switch') as HTMLButtonElement
    sw.type = 'button'
    sw.classList.toggle('on', value)
    sw.setAttribute('role', 'switch')
    sw.setAttribute('aria-checked', String(value))
    sw.onclick = () => {
      const next = !sw.classList.contains('on')
      sw.classList.toggle('on', next)
      sw.setAttribute('aria-checked', String(next))
      onChange(next)
    }
    row.appendChild(sw)
    return row
  }

  /* ---------------- schema 5：面板 / 标题形态 / 分割线贴纸 / 配色变体 ---------------- */

  /** 双面卡片：外圈带 + 内面板。带宽度 0 就是单面（与旧模板一致） */
  function renderPanelGroup(labelKey: string): HTMLElement {
    const g = el('div', 'ce-group')
    g.dataset.group = 'panel'
    g.appendChild(el('div', 'ce-label', tl(labelKey)))
    for (const p of [
      'decor.panel.band',
      'tokens.panelBg',
      'decor.panel.border',
      'decor.panel.radius',
      'decor.panel.shadow',
      'decor.panel.pad',
      // schema 6：顶部色条也归这里 —— 它和 band 一样是"卡片外壳"上的东西
      'decor.topBar.height',
      'decor.topBar.from',
      'decor.topBar.to',
    ]) {
      const spec = PARAM_SPECS.find((s) => s.path === p)
      if (spec) g.appendChild(renderParam(spec))
    }
    g.appendChild(el('div', 'ce-hint', t('card.panelHint')))
    return g
  }

  /**
   * 逐级标题：四级各自折叠。
   * 48 个控件一次全摊开会把面板拉成三屏，而绝大多数模板只改 h1/h2 —— 折叠是必需的。
   */
  function renderHeadGroup(labelKey: string): HTMLElement {
    const g = el('div', 'ce-group')
    g.dataset.group = 'head'
    g.appendChild(el('div', 'ce-label', tl(labelKey)))
    for (const lv of HEAD_LEVEL_LIST) {
      const d = el('details', 'ce-sub') as HTMLDetailsElement
      d.dataset.level = lv
      // 只有 h1 默认展开：一眼能看到"这套模板的标题长什么样"
      if (lv === 'h1') d.open = true
      const sum = el('summary', 'ce-sub-sum', lv.toUpperCase())
      d.appendChild(sum)
      for (const spec of headSpecs(lv)) d.appendChild(renderParam(spec))
      g.appendChild(d)
    }
    return g
  }

  /** 分隔线五式 + 有序序号 + 支撑面三态 */
  function renderRuleGroup(labelKey: string): HTMLElement {
    const g = el('div', 'ce-group')
    g.dataset.group = 'rule'
    g.appendChild(el('div', 'ce-label', tl(labelKey)))
    for (const p of ['decor.rule.style', 'decor.rule.height', 'decor.rule.color', 'decor.rule.color2', 'decor.rule.angle']) {
      const spec = PARAM_SPECS.find((s) => s.path === p)
      if (spec) g.appendChild(renderParam(spec))
    }
    for (const p of ['decor.listNo', 'decor.surface.table', 'decor.surface.code', 'decor.surface.image']) {
      const spec = PARAM_SPECS.find((s) => s.path === p)
      if (spec) g.appendChild(renderParam(spec))
    }
    g.appendChild(renderOrnGroup('card.groupOrn'))
    return g
  }

  /** 角饰贴纸：可加可删，每枚 8 个字段（path 用数组下标） */
  function renderOrnGroup(labelKey: string): HTMLElement {
    const wrap = el('div', 'ce-orn')
    wrap.dataset.group = 'orn'
    wrap.appendChild(el('div', 'ce-label', tl(labelKey)))
    const list = state.template.decor.ornaments ?? []
    list.forEach((o, i) => {
      const box = el('div', 'ce-orn-item')
      box.dataset.idx = String(i)
      const head = el('div', 'ce-orn-head')
      head.appendChild(el('span', 'ce-orn-name', `${tl(`tpl.ornshape.${o.shape}`)} · ${tl(`tpl.pos.${o.pos}`)}`))
      const del = el('button', 'ce-mini', '×') as HTMLButtonElement
      del.type = 'button'
      del.title = t('card.ornRemove')
      del.dataset.act = 'orn-del'
      del.onclick = () => {
        const next = [...list.slice(0, i), ...list.slice(i + 1)]
        applyPath('decor.ornaments', next, true)
      }
      head.appendChild(del)
      box.appendChild(head)
      for (const spec of ornSpecs(i)) box.appendChild(renderParam(spec))
      wrap.appendChild(box)
    })
    const add = el('button', 'ce-seg-btn', t('card.ornAdd')) as HTMLButtonElement
    add.type = 'button'
    add.dataset.act = 'orn-add'
    add.disabled = list.length >= 6
    add.onclick = () => {
      const next = [
        ...list,
        { shape: 'star5' as const, pos: 'br' as const, size: 56, rotate: 0, fill: tplAccent(), stroke: '', text: '', bleed: 4 },
      ]
      applyPath('decor.ornaments', next, true)
    }
    const row = el('div', 'ce-seg')
    row.appendChild(add)
    wrap.appendChild(row)
    return wrap
  }

  /** 新贴纸的默认填充色 = 当前强调色，加进来就看得见（不至于加了个透明的） */
  function tplAccent(): string {
    const a = state.template.tokens.accent
    return /^#[0-9a-f]{6}$/i.test(a) ? a : '#ff2e63'
  }

  /**
   * 配色变体：点一下把 token 写进当前模板。
   *
   * 刻意不做"渲染时叠加变体"：那样面板改色会被变体压回去（谁赢取决于执行顺序），
   * 而"存为我的模板"也会存下一个看不出来的隐式状态。写进去则所见即所得。
   */
  function renderVariantGroup(): HTMLElement {
    const g = el('div', 'ce-group')
    g.dataset.group = 'variant'
    g.appendChild(el('div', 'ce-label', t('card.groupVariant')))
    const seg = el('div', 'ce-seg')
    for (const v of state.template.variants ?? []) {
      const b = el('button', 'ce-seg-btn', v.name) as HTMLButtonElement
      b.type = 'button'
      b.dataset.variant = v.id
      const hit = Object.entries(v.tokens).every(
        ([k, val]) => (state.template.tokens as unknown as Record<string, string>)[k] === val,
      )
      b.classList.toggle('on', hit)
      b.onclick = () => {
        state.template = { ...state.template, tokens: { ...state.template.tokens, ...v.tokens } }
        saveCurrent(state.template)
        renderParams()
        void recompute()
      }
      seg.appendChild(b)
    }
    g.appendChild(seg)
    g.appendChild(el('div', 'ce-hint', t('card.variantHint')))
    return g
  }

  function renderParams(): void {
    if (!refs) return
    const groups: { labelKey: string; paths: string[]; special?: 'bg' | 'stamp' | 'panel' | 'head' | 'rule' | 'orn' | 'variant' }[] = [
      { labelKey: 'card.groupColor', paths: ['tokens.paper', 'tokens.ink', 'tokens.accent', 'tokens.codeBg'] },
      {
        labelKey: 'card.groupMetrics',
        paths: ['metrics.fontSize', 'metrics.lineHeight', 'metrics.titleSize', 'metrics.padX', 'metrics.radius'],
      },
      // paths 为空 = 用专用控件渲染（背景要缩略图，不能退化成一行文字 select）
      { labelKey: 'card.groupBg', paths: [], special: 'bg' },
      {
        labelKey: 'card.groupDecor',
        paths: ['decor.texture', 'decor.accent', 'decor.corner', 'decor.cover', 'decor.frame', 'decor.tape', 'decor.binding'],
      },
      // schema 4：引用框 / 项目符号 / 标题装饰 —— 这三项是"这套模板有没有性格"的关键
      { labelKey: 'card.groupType', paths: ['decor.quote', 'decor.bullet', 'decor.title'] },
      /* schema 5「艺术层」三组 */
      { labelKey: 'card.groupPanel', paths: [], special: 'panel' },
      { labelKey: 'card.groupHead', paths: [], special: 'head' },
      { labelKey: 'card.groupRule', paths: [], special: 'rule' },
      { labelKey: 'card.groupStamp', paths: [], special: 'stamp' },
      {
        labelKey: 'card.groupHeaderFooter',
        paths: ['metrics.headRule', 'metrics.headText', 'metrics.headSide', 'metrics.pageNo', 'metrics.footText'],
      },
    ]
    const host = refs.paramHost
    host.replaceChildren()
    for (const g of groups) {
      if (g.special === 'bg') {
        host.appendChild(renderBgGroup(g.labelKey))
        continue
      }
      if (g.special === 'stamp') {
        host.appendChild(renderStampGroup(g.labelKey))
        continue
      }
      if (g.special === 'panel') {
        host.appendChild(renderPanelGroup(g.labelKey))
        continue
      }
      if (g.special === 'head') {
        host.appendChild(renderHeadGroup(g.labelKey))
        continue
      }
      if (g.special === 'rule') {
        host.appendChild(renderRuleGroup(g.labelKey))
        continue
      }
      if (g.special === 'orn') {
        host.appendChild(renderOrnGroup(g.labelKey))
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

    // 配色变体只在这套模板带了变体时才出现（28 套老模板没有，不占地方）
    if ((state.template.variants ?? []).length) host.appendChild(renderVariantGroup())

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
      // 预览用透明底 + 真圆角：圆角画在面板底色上才看得见（见 card-capture 的 keepRadius）
      const url = await renderPagePreview(pages[state.index], size, state.template)
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
        // PNG 走透明底：圆角是真圆角，贴到任何背景上都不带白边
        const res = await renderPagesToPng(pages, size, state.template, 'transparent')
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
      const res = await renderPagesToPng([pages[Math.min(state.index, pages.length - 1)]], size, state.template, 'transparent')
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
    /* 名字是用户写的，就不要再让内置的多语言名压过它：
       templateName() 优先取 names[locale]、其次 enName，两样都是内置那套的话，
       卡片上永远是「素笺清墨」，用户在命名框里敲的新名字等于白敲。 */
    copy.names = {}
    copy.enName = name
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

  /**
   * 上传自定义印章：只收透明背景的图（PNG/WebP 才有 alpha），压到 480px 内。
   * 不强制透明 —— 用户拿一张白底 jpg 来也让他用，只是白底会挡字，
   * 面板里能一眼看出来，比弹个"格式不对"更有用。
   */
  async function onStampFile(file: File): Promise<void> {
    try {
      const url = await shrinkImage(file, 480, 0.9)
      if (!url || !sanitizeStampImage(url)) {
        toast(t('card.stampFailed'))
        return
      }
      state.template = setPath(state.template, 'decor.stampImage', url)
      saveCurrent(state.template)
      // 上传了图就顺手把开关打开：否则"传了没反应"会再来一次
      state.template = setPath(state.template, 'decor.stamp', true)
      saveCurrent(state.template)
      renderParams()
      void recompute()
      toast(t('card.stampApplied'))
    } catch {
      toast(t('card.stampFailed'))
    }
  }

  /** 导出样式包（.zip：template.json + 背景图 + 印章图） */
  async function exportCurrent(): Promise<void> {
    try {
      const { blob, name } = await exportPackage(state.template)
      const r = await saveBinary(blob, name, 'application/zip')
      if (r.ok) toast(t('card.pkgSaved', { path: r.path || name }), 3200)
    } catch (err) {
      toast(t('card.failed'))
      console.error('[beautify] export package', err)
    }
  }

  /** 下载内置范例包：帮助文档说"照这个改"，那总得有个能下载的东西 */
  async function downloadSample(id: string): Promise<void> {
    const { blob, name } = await buildSamplePackage(id)
    const r = await saveBinary(blob, `sample-${id}.zip`, 'application/zip')
    if (r.ok) toast(t('card.pkgSaved', { path: r.path || name }), 3200)
  }

  async function importFromFile(file: File): Promise<void> {
    const existing = listUserTemplates().map((x) => x.id)
    // .zip 样式包与旧版单文件 .lyt.json 都吃（内部按文件头分流）
    const res = await importPackage(file, existing)
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
    toast(t('card.imported', { name: templateName(res.template) }))
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
    // data-act 给验收脚本按语义定位用（不靠按钮文案，切语言也不会断）
    const mkOp = (act: string, label: string, fn: () => void) => {
      const b = el('button', 'ce-seg-btn', label)
      b.type = 'button'
      b.dataset.act = act
      b.onclick = fn
      return b
    }
    opRow.append(
      mkOp('tpl-reset', t('card.reset'), resetTemplate),
      mkOp('tpl-save-mine', t('card.saveAsMine'), () => void saveAsMine()),
      mkOp('tpl-export', t('card.exportTpl'), () => void exportCurrent()),
    )
    const importBtn = mkOp('tpl-import', t('card.importTpl'), () => fileInput.click())
    opRow.appendChild(importBtn)
    const sampleBtn = mkOp('sample-pkg', t('card.samplePkg'), () => void downloadSample('ink'))
    opRow.appendChild(sampleBtn)
    tplOps.appendChild(opRow)
    // 样式包是什么、里面有什么 —— 不写这一行，用户只会看到"导出模板"却在找 .json
    tplOps.appendChild(el('div', 'ce-hint', t('card.pkgHint')))
    settings.appendChild(tplOps)

    const fileInput = el('input') as HTMLInputElement
    fileInput.type = 'file'
    // 样式包 .zip 与旧版 .lyt.json 都要能选（accept 里带 .json 是为了老模板）
    fileInput.accept = '.zip,.json,application/zip,application/json'
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

    const stampInput = el('input') as HTMLInputElement
    stampInput.type = 'file'
    stampInput.accept = 'image/*'
    stampInput.hidden = true
    stampInput.dataset.act = 'stamp-file'
    stampInput.onchange = () => {
      const f = stampInput.files?.[0]
      if (f) void onStampFile(f)
      stampInput.value = ''
    }
    settings.appendChild(stampInput)

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

    refs = {
      root,
      settings,
      img,
      pos,
      status,
      gallery,
      mineWrap,
      paramHost,
      coverInput,
      bgInput,
      stampInput,
      fontSelect: null as unknown as HTMLSelectElement,
    }
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
