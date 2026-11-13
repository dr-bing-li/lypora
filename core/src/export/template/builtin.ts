/**
 * 28 套内置模板。全部是纯数据 —— 一套模板 = 40 来个字段，没有一行 CSS。
 *
 * 命名：v0.12.0 起全部改用四字词（素笺清墨 / 夜阑星垂 / 水墨氤氲 …）。
 * 用户的原话是「不要用简单的『杂志』『暗夜』这种没品位的」。所以每套除了中文名，
 * 还带 6 种语言的对应词（`names`），都按同一调性取：宁可是意象，不要是品类。
 * 名字放在模板数据里而不是 i18n 词表里 —— 用户自建模板自带名字，导入导出时
 * 随模板一起走；放进词表会造出 28×7 个用户永远不会去改的键。
 *
 * 版本史：1–8（v0.8.2 的八套，id 不变）· 9–12（v0.9.0）· 13–20（v0.10.0）
 *        21–28（v0.12.0：朱线蓝格 / 旧报泛黄 / 胶片定格 / 黑板粉痕 /
 *              水彩晕染 / 樱色和纸 / 瑞士秩序 / 冷银鎏金）
 */

import { getLocale, type LocaleId } from '../../i18n'
import {
  FONT_PRESETS,
  MONO_STACK,
  TEMPLATE_SCHEMA,
  type CardTemplate,
  type TemplateDecor,
  type TemplateMetrics,
} from './types'

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
  headText: '{doc}',
  headSide: '{sec}',
  footText: '',
}

const DEFAULT_DECOR: TemplateDecor = {
  texture: 'none',
  accent: 'none',
  corner: 'none',
  tape: false,
  stamp: false,
  cover: 'center',
  bg: 'none',
  bgImage: '',
  bgOpacity: 100,
  binding: 'none',
  quote: 'bar',
  bullet: 'dot',
  title: 'none',
  frame: 'none',
  stampPreset: 'seal',
  stampImage: '',
  stampSize: 64,
  stampPos: 'br',
}

interface Spec {
  id: string
  name: string
  enName: string
  names: Partial<Record<Exclude<LocaleId, 'zh-CN'>, string>>
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
    names: { 'zh-CN': s.name, ...s.names, en: s.enName },
    dark: s.dark,
    tokens: { paper, ink, muted, faint, accent, onAccent, rule, codeBg, codeInk, quoteBg, quoteRule, mark, shadow },
    metrics: { ...DEFAULT_METRICS, ...s.m },
    decor: { ...DEFAULT_DECOR, ...s.d },
    code: { com, str, num, kw, fn },
    font: { body: f.body, head: f.head, mono: s.mono ?? MONO_STACK },
  }
}

export const BUILTIN_TEMPLATES: CardTemplate[] = [
  /* 1. 素笺清墨 —— 白纸细线，最克制的那套 */
  tpl({
    id: 'paper',
    name: '素笺清墨',
    enName: 'Plain Leaf',
    names: { ja: '白紙淡墨', ko: '담백한 종이', fr: 'Feuille Simple', de: 'Schlichtes Blatt', es: 'Hoja Serena' },
    c: ['#ffffff', '#1a1d21', '#5b6470', '#9aa2ad', '#111418', '#ffffff', '#e8eaed', '#f7f8f9', '#24292f', '#fafbfc', '#111418', '#fff3a3', 'none'],
    code: ['#8b949e', '#2f6f44', '#9a3412', '#1a1d21', '#1d4ed8'],
    m: { titleSize: 36, radius: 4, padTop: 48 },
    d: { quote: 'bar', bullet: 'dot', title: 'none' },
  }),

  /* 2. 鹅黄小笺 —— 黄纸、折角、胶带 */
  tpl({
    id: 'note',
    name: '鹅黄小笺',
    enName: 'Amber Note',
    names: { ja: '鵞黄の箋', ko: '담황 메모', fr: 'Note Ambrée', de: 'Bernsteinnotiz', es: 'Nota Ámbar' },
    c: ['#fff8c9', '#4a3d12', '#7a6626', '#a3904f', '#b45309', '#fffdf2', '#e7d98f', '#fdf1b0', '#4a3d12', '#fff3ad', '#b45309', '#ffe066', '0 10px 24px rgba(120, 96, 20, 0.16)'],
    code: ['#a3904f', '#6b7a1f', '#b45309', '#7a3d00', '#8a5a00'],
    m: { titleSize: 33, radius: 3, padTop: 52 },
    d: { texture: 'grain', corner: 'fold', tape: true, accent: 'none', quote: 'bubble', title: 'underline', stamp: true, stampPreset: 'strip' },
  }),

  /* 3. 铅字排印 —— 米白衬线大标题、顶部红条 */
  tpl({
    id: 'magazine',
    name: '铅字排印',
    enName: 'Letterpress',
    names: { ja: '活字印刷', ko: '활자 인쇄', fr: 'Imprimerie', de: 'Bleisatz', es: 'Imprenta' },
    c: ['#fbf9f4', '#16130f', '#5c554b', '#9b9285', '#c0392b', '#fffdf9', '#ddd6c9', '#f2ede2', '#16130f', 'transparent', '#c0392b', '#f6e0a8', 'none'],
    code: ['#9b9285', '#4a6b3a', '#a3541f', '#16130f', '#1f4e79'],
    m: { titleSize: 40, radius: 0, padX: 44, lineHeight: 1.72 },
    d: { accent: 'top', cover: 'top', title: 'underline', quote: 'quad', bullet: 'square' },
    font: 'serif',
  }),

  /* 4. 夜阑星垂 —— 近黑底、青色强调、顶部光晕 */
  tpl({
    id: 'night',
    name: '夜阑星垂',
    enName: 'Midnight Sky',
    names: { ja: '星降る夜', ko: '밤하늘', fr: 'Ciel de Nuit', de: 'Nachthimmel', es: 'Cielo Nocturno' },
    dark: true,
    c: ['#14161b', '#e6e9ef', '#9aa3b2', '#6b7484', '#7ee0ff', '#06202a', '#262a33', '#1b1f27', '#e6e9ef', '#191d24', '#7ee0ff', '#3f3a13', 'none'],
    code: ['#6b7484', '#a5e8a1', '#ffab70', '#7ee0ff', '#c792ea'],
    m: { radius: 8, titleSize: 35 },
    d: { texture: 'halo', quote: 'card', bullet: 'ring' },
  }),

  /* 5. 紫霞流光 —— 深紫蓝渐变 + 半透明块 */
  tpl({
    id: 'gradient',
    name: '紫霞流光',
    enName: 'Violet Drift',
    names: { ja: '紫霞の流れ', ko: '보랏빛 노을', fr: 'Dérive Violette', de: 'Violetter Fluss', es: 'Deriva Violeta' },
    dark: true,
    c: ['linear-gradient(150deg, #2b1e5e 0%, #4a2f8f 46%, #8f4bb5 100%)', '#fdf7ff', '#dcc9f0', '#b9a4d6', '#ffb3c7', '#3a1b3f', 'rgba(255, 255, 255, 0.18)', 'rgba(12, 6, 28, 0.42)', '#f4ecff', 'rgba(255, 255, 255, 0.08)', '#ffb3c7', 'rgba(255, 179, 199, 0.36)', 'none'],
    code: ['#b9a4d6', '#a7f3c9', '#ffd28a', '#ffb3c7', '#a5d8ff'],
    m: { radius: 14, titleSize: 36, padX: 44 },
    d: { texture: 'halo', accent: 'none', quote: 'bubble' },
  }),

  /* 6. 复写纸痕 —— 米色打字纸、等宽字形 */
  tpl({
    id: 'typewriter',
    name: '复写纸痕',
    enName: 'Carbon Copy',
    names: { ja: '謄写版', ko: '복사지 자국', fr: 'Calque Carbone', de: 'Durchschlag', es: 'Papel Carbón' },
    c: ['#f6f1e2', '#3b3325', '#6e6350', '#948872', '#8a3b2e', '#fbf6e8', '#d8cdb4', '#ebe3cf', '#3b3325', 'transparent', '#8a3b2e', '#e8d79a', 'none'],
    code: ['#948872', '#4a6b3a', '#8a3b2e', '#3b3325', '#2b5470'],
    m: { titleSize: 30, radius: 2, padX: 52, lineHeight: 1.86 },
    d: { accent: 'left', quote: 'card', bullet: 'dash' },
    font: 'mono',
  }),

  /* 7. 经纬方格 —— 淡蓝网格、左侧色条 */
  tpl({
    id: 'grid',
    name: '经纬方格',
    enName: 'Blue Ruled',
    names: { ja: '経緯方眼', ko: '격자 노트', fr: 'Quadrillage', de: 'Karopapier', es: 'Cuadrícula' },
    c: ['#fdfdfa', '#20242b', '#5c6470', '#98a1ad', '#2563a8', '#ffffff', '#dbe4ef', '#eef4fb', '#20242b', 'transparent', '#2563a8', '#cfe6ff', 'none'],
    code: ['#98a1ad', '#2f6f44', '#b45309', '#1e3f66', '#1d4ed8'],
    m: { titleSize: 34, radius: 5, padX: 46 },
    d: { texture: 'grid', accent: 'left', quote: 'quad', bullet: 'square' },
  }),

  /* 8. 水墨氤氲 —— 宣纸、楷体、印章 */
  tpl({
    id: 'ink',
    name: '水墨氤氲',
    enName: 'Ink Wash',
    names: { ja: '水墨の翳', ko: '수묵 담채', fr: "Lavis d'Encre", de: 'Tuschewolke', es: 'Tinta Aguada' },
    c: ['#f7f4ec', '#24211c', '#5f584d', '#8c8577', '#9b2c1f', '#fbf7ee', '#ddd6c6', '#efeade', '#24211c', 'transparent', '#9b2c1f', '#f0e2b8', 'none'],
    code: ['#8c8577', '#4c6b3c', '#9b2c1f', '#24211c', '#2f4f6b'],
    m: { titleSize: 36, radius: 2 },
    d: { texture: 'grain', stamp: true, stampPreset: 'seal', cover: 'center', quote: 'quad', title: 'bar', bullet: 'cjk' },
    font: 'kai',
  }),

  /* 9. 沙暖晴窗 —— 粗纤维纸、赭石强调 */
  tpl({
    id: 'sand',
    name: '沙暖晴窗',
    enName: 'Warm Dune',
    names: { ja: '陽だまりの砂', ko: '따뜻한 모래', fr: 'Dune Chaude', de: 'Warme Düne', es: 'Duna Cálida' },
    c: ['#f5ece0', '#3a2f24', '#6d5c48', '#9d8b74', '#8a5a2b', '#fdf8f1', '#e2d3bd', '#efe3d2', '#3a2f24', 'rgba(255, 255, 255, 0.4)', '#a06a35', '#eed9a8', 'none'],
    code: ['#9d8b74', '#5a6b3c', '#a3541f', '#3a2f24', '#2b5470'],
    m: { titleSize: 35, radius: 3, lineHeight: 1.8 },
    d: { texture: 'fiber', accent: 'none', quote: 'card', bullet: 'dash' },
    font: 'serif',
  }),

  /* 10. 玄素之间 —— 无装饰，只有字体与留白 */
  tpl({
    id: 'mono',
    name: '玄素之间',
    enName: 'Monochrome',
    names: { ja: '玄素の間', ko: '흑백지간', fr: 'Monochrome', de: 'Schwarzweiß', es: 'Monocromo' },
    c: ['#ffffff', '#000000', '#555555', '#999999', '#000000', '#ffffff', '#e0e0e0', '#f5f5f5', '#000000', 'transparent', '#000000', '#eaeaea', 'none'],
    code: ['#888888', '#444444', '#000000', '#000000', '#666666'],
    m: { titleSize: 38, radius: 0, fontSize: 14.5, lineHeight: 1.9, padX: 46, padTop: 52 },
    d: { accent: 'top', cover: 'top', title: 'underline', bullet: 'square', quote: 'bar' },
  }),

  /* 11. 青金沉碧 —— 点子纸、蓝色侧边条 */
  tpl({
    id: 'cobalt',
    name: '青金沉碧',
    enName: 'Lapis Calm',
    names: { ja: '紺青の静', ko: '청금석', fr: 'Lapis Bleu', de: 'Kobaltblau', es: 'Azul Lapislázuli' },
    c: ['#f4f7fc', '#17202e', '#4f5d73', '#8f9bad', '#1d4ed8', '#ffffff', '#d7e0ee', '#e8eefa', '#17202e', 'rgba(29, 78, 216, 0.05)', '#1d4ed8', '#d3e2ff', 'none'],
    code: ['#8f9bad', '#2f6f44', '#9a3412', '#17202e', '#1d4ed8'],
    m: { titleSize: 34, radius: 8, padX: 44 },
    d: { texture: 'dots', accent: 'left', quote: 'card', bullet: 'square' },
  }),

  /* 12. 林深见鹿 —— 淡绿纸、深绿强调、衬线 */
  tpl({
    id: 'forest',
    name: '林深见鹿',
    enName: 'Deer in Pines',
    names: { ja: '鹿躍る森', ko: '숲속의 사슴', fr: 'Cerf des Bois', de: 'Waldlichtung', es: 'Ciervo del Bosque' },
    c: ['#f2f6ef', '#1e2a20', '#4e5f52', '#8b9a8e', '#2f6b3a', '#ffffff', '#d5e0d2', '#e6efe3', '#1e2a20', 'rgba(47, 107, 58, 0.05)', '#2f6b3a', '#d9eccd', 'none'],
    code: ['#8b9a8e', '#3f7a4a', '#9a6012', '#1e2a20', '#1f5f8b'],
    m: { titleSize: 36, radius: 6, lineHeight: 1.8 },
    d: { texture: 'grain', accent: 'left', quote: 'quad', bullet: 'ring' },
    font: 'serif',
  }),

  /* 13. 黄纸小记 —— 纯白纸、黄色小标题、横线纸 */
  tpl({
    id: 'memo',
    name: '黄纸小记',
    enName: 'Memo Leaf',
    names: { ja: '黄紙のメモ', ko: '노란 메모', fr: 'Mémo Jaune', de: 'Notizzettel', es: 'Nota Amarilla' },
    c: ['#ffffff', '#1d1d1f', '#6e6e73', '#a1a1a6', '#e0a020', '#3a2a00', '#ececee', '#f5f5f7', '#1d1d1f', '#f5f5f7', '#d2d2d7', '#fff3a3', 'none'],
    code: ['#a1a1a6', '#2f7d43', '#9a4a12', '#1d1d1f', '#1d5fbf'],
    m: { titleSize: 34, radius: 10, padX: 44, lineHeight: 1.75 },
    d: { bg: 'lined', bgOpacity: 55, quote: 'bubble', bullet: 'dot' },
  }),

  /* 14. 粉镜流霞 —— 纯白大圆角、洋红强调、水彩底 */
  tpl({
    id: 'insta',
    name: '粉镜流霞',
    enName: 'Rose Filter',
    names: { ja: '薔薇の濾過鏡', ko: '장밋빛 필터', fr: 'Filtre Rose', de: 'Roséfilter', es: 'Filtro Rosa' },
    c: ['#ffffff', '#262626', '#737373', '#a8a8a8', '#d6249f', '#ffffff', '#efefef', '#fafafa', '#262626', '#fafafa', '#dbdbdb', '#ffe8f4', '0 8px 24px rgba(0, 0, 0, 0.08)'],
    code: ['#a8a8a8', '#2f7d43', '#b45309', '#262626', '#1d4ed8'],
    m: { titleSize: 36, radius: 16, padX: 42 },
    d: { accent: 'top', bg: 'watercolor', bgOpacity: 80, corner: 'round', quote: 'card' },
  }),

  /* 15. 线圈旧本 —— 米白横线纸 + 左侧线圈 */
  tpl({
    id: 'spiral',
    name: '线圈旧本',
    enName: 'Worn Spiral',
    names: { ja: '螺旋の旧帳', ko: '나선 노트', fr: 'Carnet Spirale', de: 'Ringbuch', es: 'Espiral Usado' },
    c: ['#fffdf7', '#2b2b2b', '#666666', '#9a9a9a', '#2f6bb0', '#ffffff', '#d9e2ee', '#f2f6fb', '#2b2b2b', '#f2f6fb', '#b9cde6', '#cfe6ff', 'none'],
    code: ['#9a9a9a', '#2f7d43', '#9a4a12', '#2b2b2b', '#1d4ed8'],
    m: { padX: 58, titleSize: 34, radius: 2, lineHeight: 1.92 },
    d: { bg: 'lined', binding: 'spiral', bgOpacity: 70, quote: 'bar', bullet: 'dash' },
  }),

  /* 16. 波普撞色 —— 高饱和黄底 + 红角标 + 网点 */
  tpl({
    id: 'pop',
    name: '波普撞色',
    enName: 'Pop Contrast',
    names: { ja: 'ポップ対比', ko: '팝 아트', fr: 'Pop Contrasté', de: 'Pop-Kontrast', es: 'Pop Contrastado' },
    c: ['#ffd93d', '#111111', '#3a3a3a', '#6b6b6b', '#e63946', '#ffffff', '#111111', '#fff3b0', '#111111', '#ffec99', '#111111', '#7ee8ff', 'none'],
    code: ['#6b6b6b', '#1d6b3a', '#a34a00', '#111111', '#1d4ed8'],
    m: { titleSize: 44, radius: 0, lineHeight: 1.62, padX: 40 },
    d: { texture: 'dots', accent: 'corner', title: 'block', bullet: 'square', quote: 'card', frame: 'thin' },
  }),

  /* 17. 鎏金几何 —— 黑金、衬线、顶部金线 */
  tpl({
    id: 'artdeco',
    name: '鎏金几何',
    enName: 'Gilded Grid',
    names: { ja: '金線の幾何', ko: '금빛 기하', fr: 'Grille Dorée', de: 'Goldene Linien', es: 'Rejilla Dorada' },
    dark: true,
    c: ['#12100c', '#f2e9d8', '#bda98c', '#8a7a63', '#c9a227', '#1a1508', '#2e2a22', '#1a1813', '#f2e9d8', '#1a1813', '#6b5a3a', '#4a3f14', 'none'],
    code: ['#8a7a63', '#a7d9a0', '#e8c07a', '#c9a227', '#8fc7e8'],
    m: { titleSize: 38, radius: 2, padX: 48, lineHeight: 1.85 },
    d: { texture: 'halo', accent: 'top', corner: 'none', frame: 'double', bullet: 'ring', quote: 'quad' },
    font: 'serif',
  }),

  /* 18. 巨幅跨栏 —— 超大标题、粗黑侧条 */
  tpl({
    id: 'jumbo',
    name: '巨幅跨栏',
    enName: 'Wide Column',
    names: { ja: '大判段抜き', ko: '대형 활자', fr: 'Grande Colonne', de: 'Breite Spalte', es: 'Columna Ancha' },
    c: ['#f7f5f1', '#0f0f0f', '#555555', '#8f8f8f', '#0f0f0f', '#f7f5f1', '#d8d4cc', '#ece8e0', '#0f0f0f', '#ece8e0', '#0f0f0f', '#ffe680', 'none'],
    code: ['#8f8f8f', '#2f5d3a', '#9a4a12', '#0f0f0f', '#1d4ed8'],
    m: { titleSize: 48, radius: 0, padX: 38, fontSize: 15.5, lineHeight: 1.66 },
    d: { accent: 'left', title: 'bar', bullet: 'square', quote: 'bar' },
  }),

  /* 19. 霓虹夜行 —— 深蓝黑 + 洋红青双色 */
  tpl({
    id: 'neon',
    name: '霓虹夜行',
    enName: 'Neon Night',
    names: { ja: '霓虹の夜行', ko: '네온 야행', fr: 'Néon Nocturne', de: 'Neonlicht', es: 'Neón Nocturno' },
    dark: true,
    c: ['#0b0d17', '#e8ecff', '#9aa3c7', '#6b74a0', '#ff2d95', '#ffffff', '#232842', '#131829', '#e8ecff', '#131829', '#ff2d95', '#2a1a3f', 'none'],
    code: ['#6b74a0', '#4dffa6', '#ffd166', '#ff2d95', '#2de2ff'],
    m: { titleSize: 36, radius: 10, padX: 42 },
    d: { texture: 'halo', accent: 'left', title: 'bar', quote: 'bubble' },
  }),

  /* 20. 牛皮手帐 —— 牛皮纸 + 胶带 + 折角 + 签名 */
  tpl({
    id: 'craft',
    name: '牛皮手帐',
    enName: 'Kraft Journal',
    names: { ja: '牛皮の手帳', ko: '크라프트 수첩', fr: 'Carnet Kraft', de: 'Kraftpapier', es: 'Cuaderno Kraft' },
    c: ['#e8d7bc', '#3b2f1f', '#6b5a41', '#94805f', '#a2673a', '#fff8ef', '#c9b48f', '#f0e3cb', '#3b2f1f', '#f0e3cb', '#a2673a', '#f5dfa0', '0 8px 20px rgba(90, 70, 40, 0.18)'],
    code: ['#94805f', '#4a6b34', '#8a4a1c', '#3b2f1f', '#2b5470'],
    m: { titleSize: 34, radius: 4, padX: 46, lineHeight: 1.82 },
    d: { bg: 'kraft', tape: true, corner: 'fold', bullet: 'dash', quote: 'card', stamp: true, stampPreset: 'signature', stampPos: 'bl' },
  }),

  /* ---------- v0.12.0 新增 8 套 ---------- */

  /* 21. 朱线蓝格 —— 作业本：蓝格 + 一条红边距线 */
  tpl({
    id: 'graph',
    name: '朱线蓝格',
    enName: 'Red Margin',
    names: { ja: '朱線青罫', ko: '주홍 여백', fr: 'Marge Rouge', de: 'Roter Rand', es: 'Margen Rojo' },
    c: ['#fdfefb', '#1b2430', '#556374', '#93a0af', '#cf3a2e', '#ffffff', '#cfdae8', '#eef4fb', '#1b2430', 'rgba(37, 99, 168, 0.05)', '#2563a8', '#d9ecff', 'none'],
    code: ['#93a0af', '#2f6f44', '#b45309', '#1b2430', '#1d4ed8'],
    m: { titleSize: 33, radius: 3, padX: 52, lineHeight: 1.92, fontSize: 15 },
    // 强调位 left 就是那条"红边距线"，网格线走 texture（颜色由 paper 自动推）
    d: { texture: 'grid', accent: 'left', quote: 'bar', bullet: 'square', title: 'underline' },
  }),

  /* 22. 旧报泛黄 —— 窄栏、旧报纸网纹、衬线小标题 */
  tpl({
    id: 'news',
    name: '旧报泛黄',
    enName: 'Yellowed News',
    names: { ja: '古新聞', ko: '누런 신문', fr: 'Vieux Journal', de: 'Zeitungspapier', es: 'Periódico Añejo' },
    c: ['#efe6cf', '#241f18', '#5c5344', '#8f8672', '#7d2b21', '#f7f1e2', '#c9bda0', '#e6dcc4', '#241f18', 'rgba(125, 43, 33, 0.045)', '#7d2b21', '#e3d6a3', 'none'],
    code: ['#8f8672', '#4c6b3c', '#8a4a1c', '#241f18', '#2f4f6b'],
    m: { titleSize: 30, radius: 0, padX: 34, lineHeight: 1.62, fontSize: 14 },
    d: { texture: 'fiber', quote: 'quad', bullet: 'dash', title: 'underline', frame: 'thin' },
    font: 'serif',
  }),

  /* 23. 胶片定格 —— 黑边、齿孔、橙红日期字 */
  tpl({
    id: 'film',
    name: '胶片定格',
    enName: 'Film Still',
    names: { ja: 'フイルムの一コマ', ko: '필름 한 컷', fr: 'Arrêt sur Film', de: 'Filmstill', es: 'Fotograma' },
    dark: true,
    c: ['#12100f', '#f4ecdf', '#b9ac9c', '#8a8074', '#ff6a3d', '#1a0f08', '#2b2723', '#1a1815', '#f4ecdf', '#1a1815', '#4a4038', '#4a2a12', 'none'],
    code: ['#8a8074', '#a8d9a0', '#ffb27a', '#ff6a3d', '#8fc7e8'],
    m: { titleSize: 34, radius: 0, padX: 44, padTop: 56, padBottom: 52, lineHeight: 1.74 },
    d: { texture: 'perf', accent: 'none', quote: 'card', bullet: 'square', title: 'none' },
    font: 'mono',
  }),

  /* 24. 黑板粉痕 —— 深绿黑板、粉笔白、手写感 */
  tpl({
    id: 'chalk',
    name: '黑板粉痕',
    enName: 'Chalk Dust',
    names: { ja: '黒板の白墨', ko: '분필 자국', fr: 'Craie Poussière', de: 'Kreidestaub', es: 'Polvo de Tiza' },
    dark: true,
    c: ['#22322b', '#f2f5ee', '#c3cdc0', '#8f9c92', '#f6e9b8', '#1c2a24', '#3a4b42', '#1b2a24', '#eef2e8', '#1b2a24', '#f6e9b8', '#4a4426', 'none'],
    code: ['#8f9c92', '#a8e6b0', '#ffd48a', '#f6e9b8', '#9ecbe8'],
    m: { titleSize: 36, radius: 4, padX: 44, lineHeight: 1.85 },
    d: { texture: 'grain', frame: 'inset', quote: 'quad', bullet: 'dash', title: 'underline' },
    font: 'kai',
  }),

  /* 25. 水彩晕染 —— 湿边色块、淡墨引文 */
  tpl({
    id: 'wash',
    name: '水彩晕染',
    enName: 'Watercolor Wash',
    names: { ja: '水彩のにじみ', ko: '수채 번짐', fr: 'Aquarelle', de: 'Aquarell', es: 'Acuarela' },
    c: ['#fdfcfa', '#25303c', '#5c6b7a', '#94a1ae', '#4a7fb5', '#ffffff', '#dde5ee', '#f0f5fa', '#25303c', 'rgba(74, 127, 181, 0.06)', '#4a7fb5', '#d7ebff', '0 10px 26px rgba(60, 90, 130, 0.10)'],
    code: ['#94a1ae', '#3f7a4a', '#a3541f', '#25303c', '#1d4ed8'],
    m: { titleSize: 36, radius: 14, padX: 46, lineHeight: 1.82 },
    d: { bg: 'watercolor', bgOpacity: 90, quote: 'bubble', corner: 'round', bullet: 'dot' },
    font: 'serif',
  }),

  /* 26. 樱色和纸 —— 和纸纤维、樱粉、留白 */
  tpl({
    id: 'washi',
    name: '樱色和纸',
    enName: 'Sakura Washi',
    names: { ja: '桜色和紙', ko: '벚꽃 화지', fr: 'Washi Sakura', de: 'Sakura-Washi', es: 'Papel Sakura' },
    c: ['#fdf3f1', '#3b2a2b', '#6f585a', '#a68e90', '#c96a7a', '#fff8f7', '#efd9d8', '#fbeeed', '#3b2a2b', 'rgba(201, 106, 122, 0.06)', '#c96a7a', '#ffe1e6', 'none'],
    code: ['#a68e90', '#4c6b3c', '#9b4a2c', '#3b2a2b', '#2f4f6b'],
    m: { titleSize: 33, radius: 2, padX: 50, lineHeight: 1.9 },
    d: { texture: 'fiber', quote: 'quad', bullet: 'ring', title: 'underline', stamp: true, stampPreset: 'seal', stampPos: 'bl', stampSize: 58 },
    font: 'kai',
  }),

  /* 27. 瑞士秩序 —— 严格栅格、无衬线、红黑两色 */
  tpl({
    id: 'swiss',
    name: '瑞士秩序',
    enName: 'Swiss Order',
    names: { ja: 'スイス秩序', ko: '스위스 질서', fr: 'Ordre Suisse', de: 'Schweizer Raster', es: 'Orden Suizo' },
    c: ['#ffffff', '#111111', '#4a4a4a', '#8c8c8c', '#e2231a', '#ffffff', '#dcdcdc', '#f2f2f2', '#111111', 'transparent', '#111111', '#f7e9a0', 'none'],
    code: ['#8c8c8c', '#2f6f44', '#9a3412', '#111111', '#1d4ed8'],
    m: { titleSize: 40, radius: 0, padX: 48, padTop: 52, lineHeight: 1.68, fontSize: 15 },
    d: { accent: 'top', quote: 'bar', bullet: 'square', title: 'none', cover: 'top' },
  }),

  /* 28. 冷银鎏金 —— 银灰渐变、金属细线 */
  tpl({
    id: 'silver',
    name: '冷银鎏金',
    enName: 'Silver Fade',
    names: { ja: '銀灰の階調', ko: '은빛 그라데이션', fr: 'Argent Froid', de: 'Silbergrau', es: 'Plata Fría' },
    c: ['linear-gradient(160deg, #f7f8fa 0%, #e6e9ee 52%, #d7dbe2 100%)', '#262c36', '#5a6373', '#8e97a6', '#8a7440', '#fffdf6', '#cdd3dc', '#eef1f5', '#262c36', 'rgba(138, 116, 64, 0.07)', '#8a7440', '#f2e7c4', '0 12px 30px rgba(40, 50, 70, 0.12)'],
    code: ['#8e97a6', '#3f7a4a', '#9a6a1f', '#262c36', '#1d4ed8'],
    m: { titleSize: 38, radius: 10, padX: 48, lineHeight: 1.8 },
    d: { texture: 'halo', frame: 'thin', quote: 'card', bullet: 'ring', title: 'underline' },
    font: 'serif',
  }),
]

export function builtinById(id: string): CardTemplate {
  return BUILTIN_TEMPLATES.find((t) => t.id === id) ?? BUILTIN_TEMPLATES[0]
}

/**
 * 模板显示名：优先当前语言的 `names`，回落 enName / 中文名。
 *
 * 为什么不在 builtin 里写死中文：模板画廊是用户第一眼看到的东西，
 * 一个日语界面里冒出「素笺清墨」比不翻译更糟。语言包不做这些键（见文件头注释）。
 */
export function templateName(t: CardTemplate): string {
  const loc = getLocale()
  const hit = t.names?.[loc]
  if (hit) return hit
  if (loc !== 'zh-CN' && t.enName) return t.enName
  return t.name
}
