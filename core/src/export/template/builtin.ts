/**
 * 12 套内置模板。全部是纯数据 —— 一套模板 = 30 来个字段，没有一行 CSS。
 *
 * 前 8 套与 Lypora v0.8.2 的 8 套风格同名同 id，视觉由 token 重新表达
 * （纸质、墨色、留白、装饰位一致）；后 4 套是新增的。
 *
 * 为什么不再沿用 v0.8.2 的"每套一段手写 CSS"：那种写法下"调字号"要改 12 处、
 * "换纹理"要写真 CSS，用户根本不可能自己动。改成数据后，模板可序列化、可导入导出、
 * 参数面板能自动生成控件。
 */

import { FONT_PRESETS, MONO_STACK, TEMPLATE_SCHEMA, type CardTemplate, type TemplateDecor, type TemplateMetrics } from './types'

const FONT = Object.fromEntries(FONT_PRESETS.map((f) => [f.id, f])) as Record<string, (typeof FONT_PRESETS)[number]>

const DEFAULT_METRICS: TemplateMetrics = {
  padX: 40,
  padTop: 44,
  padBottom: 40,
  fontSize: 15,
  lineHeight: 1.78,
  radius: 6,
  titleSize: 34,
  headRule: true,
  pageNo: true,
  brand: 'Lypora',
}

const DEFAULT_DECOR: TemplateDecor = {
  texture: 'none',
  accent: 'none',
  corner: 'none',
  tape: false,
  stamp: false,
  cover: 'center',
}

interface Spec {
  id: string
  name: string
  enName: string
  dark?: boolean
  /** 纸张 / 墨色 / 弱化 / 极弱 / 强调 / 强调上文字 / 分隔线 / 代码底 / 代码字 / 引用底 / 引用线 / 高亮 / 投影 */
  c: [string, string, string, string, string, string, string, string, string, string, string, string, string]
  /** 代码高亮：注释 / 字符串 / 数字 / 关键字 / 函数 */
  code: [string, string, string, string, string]
  m?: Partial<TemplateMetrics>
  d?: Partial<TemplateDecor>
  font?: 'sans' | 'serif' | 'kai' | 'mono'
  mono?: string
}

function tpl(s: Spec): CardTemplate {
  const [paper, ink, muted, faint, accent, onAccent, rule, codeBg, codeInk, quoteBg, quoteRule, mark, shadow] = s.c
  const [com, str, num, kw, fn] = s.code
  const f = FONT[s.font ?? 'sans'] ?? FONT.sans
  return {
    schema: TEMPLATE_SCHEMA,
    id: s.id,
    name: s.name,
    enName: s.enName,
    dark: s.dark,
    tokens: { paper, ink, muted, faint, accent, onAccent, rule, codeBg, codeInk, quoteBg, quoteRule, mark, shadow },
    metrics: { ...DEFAULT_METRICS, ...s.m },
    decor: { ...DEFAULT_DECOR, ...s.d },
    code: { com, str, num, kw, fn },
    font: { body: f.body, head: f.head, mono: s.mono ?? MONO_STACK },
  }
}

export const BUILTIN_TEMPLATES: CardTemplate[] = [
  /* 1. 素纸 —— 最保险的通用款，白纸黑字细线 */
  tpl({
    id: 'paper',
    name: '素纸',
    enName: 'Plain Paper',
    c: ['#ffffff', '#1a1d21', '#5b6470', '#9aa2ad', '#111418', '#ffffff', '#e8eaed', '#f7f8f9', '#24292f', '#fafbfc', '#111418', '#fff3a3', 'none'],
    code: ['#8b949e', '#2f6f44', '#9a3412', '#1a1d21', '#1d4ed8'],
    m: { titleSize: 36, radius: 4, padTop: 48 },
  }),

  /* 2. 便签 —— 黄纸、折角、胶带 */
  tpl({
    id: 'note',
    name: '便签',
    enName: 'Sticky Note',
    c: ['#fff8c9', '#4a3d12', '#7a6626', '#a3904f', '#b45309', '#fffdf2', '#e7d98f', '#fdf1b0', '#4a3d12', '#fff3ad', '#b45309', '#ffe066', '0 10px 24px rgba(120, 96, 20, 0.16)'],
    code: ['#a3904f', '#6b7a1f', '#b45309', '#7a3d00', '#8a5a00'],
    m: { titleSize: 33, radius: 3, padTop: 52 },
    d: { texture: 'grain', corner: 'fold', tape: true, accent: 'none' },
  }),

  /* 3. 杂志 —— 米白纸、衬线大标题、顶部红条 */
  tpl({
    id: 'magazine',
    name: '杂志',
    enName: 'Magazine',
    c: ['#fbf9f4', '#16130f', '#5c554b', '#9b9285', '#c0392b', '#fffdf9', '#ddd6c9', '#f2ede2', '#16130f', 'transparent', '#c0392b', '#f6e0a8', 'none'],
    code: ['#9b9285', '#4a6b3a', '#a3541f', '#16130f', '#1f4e79'],
    m: { titleSize: 40, radius: 0, padX: 44, lineHeight: 1.72 },
    d: { accent: 'top', cover: 'top' },
    font: 'serif',
  }),

  /* 4. 暗夜 —— 近黑底、青色强调、顶部光晕 */
  tpl({
    id: 'night',
    name: '暗夜',
    enName: 'Midnight',
    dark: true,
    c: ['#14161b', '#e6e9ef', '#9aa3b2', '#6b7484', '#7ee0ff', '#06202a', '#262a33', '#1b1f27', '#e6e9ef', '#191d24', '#7ee0ff', '#3f3a13', 'none'],
    code: ['#6b7484', '#a5e8a1', '#ffab70', '#7ee0ff', '#c792ea'],
    m: { radius: 8, titleSize: 35 },
    d: { texture: 'halo' },
  }),

  /* 5. 渐变海报 —— 深紫蓝渐变 + 半透明块 */
  tpl({
    id: 'gradient',
    name: '渐变海报',
    enName: 'Gradient Poster',
    dark: true,
    c: ['linear-gradient(150deg, #2b1e5e 0%, #4a2f8f 46%, #8f4bb5 100%)', '#fdf7ff', '#dcc9f0', '#b9a4d6', '#ffb3c7', '#3a1b3f', 'rgba(255, 255, 255, 0.18)', 'rgba(12, 6, 28, 0.42)', '#f4ecff', 'rgba(255, 255, 255, 0.08)', '#ffb3c7', 'rgba(255, 179, 199, 0.36)', 'none'],
    code: ['#b9a4d6', '#a7f3c9', '#ffd28a', '#ffb3c7', '#a5d8ff'],
    m: { radius: 14, titleSize: 36, padX: 44 },
    d: { texture: 'halo', accent: 'none' },
  }),

  /* 6. 打字机 —— 米色打字纸、等宽字形 */
  tpl({
    id: 'typewriter',
    name: '打字机',
    enName: 'Typewriter',
    c: ['#f6f1e2', '#3b3325', '#6e6350', '#948872', '#8a3b2e', '#fbf6e8', '#d8cdb4', '#ebe3cf', '#3b3325', 'transparent', '#8a3b2e', '#e8d79a', 'none'],
    code: ['#948872', '#4a6b3a', '#8a3b2e', '#3b3325', '#2b5470'],
    m: { titleSize: 30, radius: 2, padX: 52, lineHeight: 1.86 },
    d: { accent: 'left' },
    font: 'mono',
  }),

  /* 7. 方格笔记 —— 淡蓝网格、左侧色条 */
  tpl({
    id: 'grid',
    name: '方格笔记',
    enName: 'Grid Note',
    c: ['#fdfdfa', '#20242b', '#5c6470', '#98a1ad', '#2563a8', '#ffffff', '#dbe4ef', '#eef4fb', '#20242b', 'transparent', '#2563a8', '#cfe6ff', 'none'],
    code: ['#98a1ad', '#2f6f44', '#b45309', '#1e3f66', '#1d4ed8'],
    m: { titleSize: 34, radius: 5, padX: 46 },
    d: { texture: 'grid', accent: 'left' },
  }),

  /* 8. 水墨 —— 宣纸、楷体、印章 */
  tpl({
    id: 'ink',
    name: '水墨',
    enName: 'Ink Wash',
    c: ['#f7f4ec', '#24211c', '#5f584d', '#8c8577', '#9b2c1f', '#fbf7ee', '#ddd6c6', '#efeade', '#24211c', 'transparent', '#9b2c1f', '#f0e2b8', 'none'],
    code: ['#8c8577', '#4c6b3c', '#9b2c1f', '#24211c', '#2f4f6b'],
    m: { titleSize: 36, radius: 2 },
    d: { texture: 'grain', stamp: true, cover: 'center' },
    font: 'kai',
  }),

  /* 9. 暖沙（新增）—— 粗纤维纸、赭石强调 */
  tpl({
    id: 'sand',
    name: '暖沙',
    enName: 'Warm Sand',
    c: ['#f5ece0', '#3a2f24', '#6d5c48', '#9d8b74', '#8a5a2b', '#fdf8f1', '#e2d3bd', '#efe3d2', '#3a2f24', 'rgba(255, 255, 255, 0.4)', '#a06a35', '#eed9a8', 'none'],
    code: ['#9d8b74', '#5a6b3c', '#a3541f', '#3a2f24', '#2b5470'],
    m: { titleSize: 35, radius: 3, lineHeight: 1.8 },
    d: { texture: 'fiber', accent: 'none' },
    font: 'serif',
  }),

  /* 10. 极简黑白（新增）—— 无装饰，只有字体与留白 */
  tpl({
    id: 'mono',
    name: '极简黑白',
    enName: 'Strict Mono',
    c: ['#ffffff', '#000000', '#555555', '#999999', '#000000', '#ffffff', '#e0e0e0', '#f5f5f5', '#000000', 'transparent', '#000000', '#eaeaea', 'none'],
    code: ['#888888', '#444444', '#000000', '#000000', '#666666'],
    m: { titleSize: 38, radius: 0, fontSize: 14.5, lineHeight: 1.9, padX: 46, padTop: 52 },
    d: { accent: 'top', cover: 'top' },
  }),

  /* 11. 钴蓝（新增）—— 点子纸、蓝色侧边条 */
  tpl({
    id: 'cobalt',
    name: '钴蓝',
    enName: 'Cobalt',
    c: ['#f4f7fc', '#17202e', '#4f5d73', '#8f9bad', '#1d4ed8', '#ffffff', '#d7e0ee', '#e8eefa', '#17202e', 'rgba(29, 78, 216, 0.05)', '#1d4ed8', '#d3e2ff', 'none'],
    code: ['#8f9bad', '#2f6f44', '#9a3412', '#17202e', '#1d4ed8'],
    m: { titleSize: 34, radius: 8, padX: 44 },
    d: { texture: 'dots', accent: 'left' },
  }),

  /* 12. 林间（新增）—— 淡绿纸、深绿强调、衬线 */
  tpl({
    id: 'forest',
    name: '林间',
    enName: 'Forest',
    c: ['#f2f6ef', '#1e2a20', '#4e5f52', '#8b9a8e', '#2f6b3a', '#ffffff', '#d5e0d2', '#e6efe3', '#1e2a20', 'rgba(47, 107, 58, 0.05)', '#2f6b3a', '#d9eccd', 'none'],
    code: ['#8b9a8e', '#3f7a4a', '#9a6012', '#1e2a20', '#1f5f8b'],
    m: { titleSize: 36, radius: 6, lineHeight: 1.8 },
    d: { texture: 'grain', accent: 'left' },
    font: 'serif',
  }),
]

export function builtinById(id: string): CardTemplate {
  return BUILTIN_TEMPLATES.find((t) => t.id === id) ?? BUILTIN_TEMPLATES[0]
}

/** 面板色板（模板画廊的缩略色块） */
export function swatchOf(t: CardTemplate): [string, string] {
  return [t.tokens.paper, t.tokens.accent]
}
