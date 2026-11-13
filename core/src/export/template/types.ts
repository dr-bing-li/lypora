/**
 * 模板数据结构 —— 美化输出的唯一契约。
 *
 * 设计目标（按优先级）：
 * 1. **可参数化**：用户能改的不只是"换一套皮"，而是颜色、字号、行高、留白、圆角、
 *    纹理、装饰位、字体族。这些都必须是数据字段，不能是写死的 CSS。
 * 2. **可序列化**：模板本身是纯 JSON，能导出成 `.lyt.json` 传给同事、能存进
 *    localStorage、能作为内置模板与用户模板的同构载体（内置也只是 JSON 常量）。
 * 3. **可校验**：外部导入的模板一律过 normalizeTemplate，字段缺失/越界/版本不符都拒收，
 *    绝不把可疑数值直接塞进 CSS（那会变成布局炸弹）。
 *
 * 版本史：
 *   schema 2 — 12 套模板 + 基础 token/metrics/decor
 *   schema 3 — 新增背景底纹 / 自定义背景图 / 背景不透明度（v0.10.0）
 *   schema 4 — 引用框 / 项目符号 / 标题装饰 / 外边框 / 印章预设与上传 /
 *              页眉页脚文本（v0.12.0，「样式包」那版）
 * 归一化不留旧版本分支：缺字段一律回落默认值，所以旧模板与旧 .lyt.json 照旧能读。
 */

export const TEMPLATE_SCHEMA = 4

/** 纸张与墨色：决定"这是什么质地"的六个基础色 */
export interface TemplateTokens {
  /** 纸张底色，允许 CSS 渐变（如 linear-gradient(...)） */
  paper: string
  /** 正文墨色 */
  ink: string
  /** 次要文字 */
  muted: string
  /** 极弱文字（页脚、语法标记） */
  faint: string
  /** 强调色：标题线、列表符号、链接 */
  accent: string
  /** 强调色上的文字色（kicker 徽标） */
  onAccent: string
  /** 分隔线 */
  rule: string
  /** 代码块底色 / 底色相近的浅层（表头、引用底） */
  codeBg: string
  /** 代码块正文色 */
  codeInk: string
  /** 引用块底色 */
  quoteBg: string
  /** 引用左侧竖线 */
  quoteRule: string
  /** ==高亮== 底色 */
  mark: string
  /** 卡片投影，'none' 表示无 */
  shadow: string
}

/** 版面度量：决定"读起来什么感觉" */
export interface TemplateMetrics {
  /** 左右留白 px */
  padX: number
  /** 上留白 px */
  padTop: number
  /** 下留白 px */
  padBottom: number
  /** 正文字号 px（其他所有字号按 em 相对它） */
  fontSize: number
  /** 行高倍率 */
  lineHeight: number
  /** 卡片圆角 px */
  radius: number
  /** 封面主标题字号 px */
  titleSize: number
  /** 是否显示页眉 */
  headRule: boolean
  /** 是否显示页码 */
  pageNo: boolean
  /** 页脚品牌字样，空串表示不显示（schema 4 起由 footText 接管渲染，保留字段兼容旧模板） */
  brand: string
  /**
   * 页眉左侧文本模板（schema 4）。
   * 支持占位符 `{doc} {sec} {date} {page} {total}`，空串表示不显示。
   */
  headText: string
  /** 页眉右侧文本模板（schema 4），默认 `{sec}` */
  headSide: string
  /** 页脚左侧文本模板（schema 4），默认空（等于不显示品牌字样） */
  footText: string
}

/** 纹理与装饰：决定"有没有手工感" */
export type Texture = 'none' | 'grain' | 'grid' | 'dots' | 'ruled' | 'fiber' | 'halo' | 'stripe' | 'perf'
export type AccentMark = 'none' | 'left' | 'top' | 'corner'
/** 角处理：none 直角 / fold 折角 / round 圆切角（明显的大圆角，与 radius 滑块叠加） */
export type CornerStyle = 'none' | 'fold' | 'round'
export type CoverLayout = 'center' | 'top' | 'band'

/**
 * 装订位：线圈本、回形针、订书钉。
 * 单独一个字段而不是并进 accent —— 强调条在内容边缘，装订位在纸张边缘，
 * 两者的语义（"强调"vs"这是张被装订的纸"）和视觉层都不一样。
 */
export type BindingStyle = 'none' | 'spiral' | 'clip' | 'staple'

export const BINDINGS: readonly BindingStyle[] = ['none', 'spiral', 'clip', 'staple']

/**
 * 背景底纹预设。全部由代码生成 CSS 渐变 / SVG data URL，
 * 不落图片文件：离线必然可用、导出天然内联、缩放不糊、包体积零增长。
 */
export type BgPreset = 'none' | 'kraft' | 'lined' | 'grid' | 'dots' | 'watercolor' | 'paper' | 'mesh'

/**
 * 这张表是「面板按钮 ↔ CSS 常量 ↔ 词表键」三处的唯一索引：
 * 每一 id 必须在 params.ts 的 `BG_PREVIEW` 里有图案、在 `tpl.bg.*` 里有文案。
 * 0.10.0 踩过：枚举里写的是 `wire`，而 CSS 与词表里叫 `paper` —— 面板照样生成按钮，
 * 点下去既没图案也没文案，看起来就是「这个底纹坏了」。
 */
export const BG_PRESETS: readonly BgPreset[] = ['none', 'kraft', 'lined', 'grid', 'dots', 'watercolor', 'paper', 'mesh']

/** 引用框形态：左竖线 / 卡片 / 四角书引 / 气泡 / 无 */
export type QuoteStyle = 'bar' | 'card' | 'quad' | 'bubble' | 'none'
export const QUOTE_STYLES: readonly QuoteStyle[] = ['bar', 'card', 'quad', 'bubble', 'none']

/** 项目符号：实心点 / 破折 / 方块 / 空心圈 / 汉字序号 / 无 */
export type BulletStyle = 'dot' | 'dash' | 'square' | 'ring' | 'cjk' | 'none'
export const BULLET_STYLES: readonly BulletStyle[] = ['dot', 'dash', 'square', 'ring', 'cjk', 'none']

/** 标题装饰：无 / 下划线 / 左侧竖条 / 底色块 / 直角括号 */
export type TitleMark = 'none' | 'underline' | 'bar' | 'block' | 'bracket'
export const TITLE_MARKS: readonly TitleMark[] = ['none', 'underline', 'bar', 'block', 'bracket']

/** 整卡外边框：无 / 细线 / 双线 / 虚线 / 内嵌细线 */
export type FrameStyle = 'none' | 'thin' | 'double' | 'dashed' | 'inset'
export const FRAME_STYLES: readonly FrameStyle[] = ['none', 'thin', 'double', 'dashed', 'inset']

/** 印章预设：朱文圆印 / 白文方印 / 「已阅」长条印 / 手写签名（全部 HTML+CSS 画，零文件） */
export type StampPreset = 'seal' | 'square' | 'strip' | 'signature'
export const STAMP_PRESETS: readonly StampPreset[] = ['seal', 'square', 'strip', 'signature']

/** 印章落点：右下 / 左下 / 右上 / 左上 */
export type StampPos = 'br' | 'bl' | 'tr' | 'tl'
export const STAMP_POSITIONS: readonly StampPos[] = ['br', 'bl', 'tr', 'tl']

export interface TemplateDecor {
  texture: Texture
  accent: AccentMark
  corner: CornerStyle
  /** 顶部胶带 */
  tape: boolean
  /** 右下角印章色块 */
  stamp: boolean
  /** 封面排布 */
  cover: CoverLayout
  /** 装订位（线圈 / 回形针 / 订书钉） */
  binding: BindingStyle
  /** 背景底纹预设（与 bgImage 互斥，bgImage 非空时以图为准） */
  bg: BgPreset
  /** 自定义背景图：data:image/... 或空串。存 localStorage 前必须压到 1200px 内 */
  bgImage: string
  /** 背景图层不透明度 0–100 */
  bgOpacity: number
  /* ---- schema 4 ---- */
  /** 引用框形态 */
  quote: QuoteStyle
  /** 项目符号 */
  bullet: BulletStyle
  /** 标题装饰 */
  title: TitleMark
  /** 整卡外边框 */
  frame: FrameStyle
  /** 印章预设图形（stampImage 非空时以图为准） */
  stampPreset: StampPreset
  /** 自定义印章图：透明 PNG 的 data URL，空串表示用预设 */
  stampImage: string
  /** 印章边长 px（预设与上传图共用） */
  stampSize: number
  /** 印章落点 */
  stampPos: StampPos
}

/** 代码高亮配色：5 类 token */
export interface TemplateCode {
  com: string
  str: string
  num: string
  kw: string
  fn: string
}

export interface TemplateFont {
  body: string
  head: string
  mono: string
}

export interface CardTemplate {
  schema: number
  id: string
  name: string
  enName: string
  /**
   * 各语言的模板名（schema 4）。键是 locale id（zh-CN/en/ja/ko/es/fr/de）。
   * 不放进 i18n 词表：模板名属于「模板数据」而不是界面文案 —— 用户自建模板
   * 自带名字，导入导出时随模板一起走；放进词表反而会造出 28 × 7 个用户永远
   * 不会去改的键。取值用 `templateName()`。
   */
  names?: Record<string, string>
  /** 深色模板：导出时背板色与默认值会不同 */
  dark?: boolean
  tokens: TemplateTokens
  metrics: TemplateMetrics
  decor: TemplateDecor
  code: TemplateCode
  font: TemplateFont
}

/** 面板上要暴露的"可调项"元数据 —— 界面据此自动生成控件，不手写 28 套表单 */
export type ParamKind = 'color' | 'number' | 'toggle' | 'select' | 'text'

export interface ParamSpec {
  /** 'tokens.accent' 这种点路径 */
  path: string
  kind: ParamKind
  labelKey: string
  min?: number
  max?: number
  step?: number
  unit?: string
  options?: { value: string; labelKey: string }[]
  /** text 类控件的占位提示键 */
  placeholderKey?: string
  /** text 类控件的最大长度 */
  maxLength?: number
}

/** 字体族预设：全部是系统字体栈，离线可用（不引任何 webfont） */
export const FONT_PRESETS = [
  {
    id: 'sans',
    labelKey: 'tpl.font.sans',
    body: "-apple-system, 'Segoe UI', 'Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', sans-serif",
    head: "-apple-system, 'Segoe UI', 'Microsoft YaHei', 'PingFang SC', sans-serif",
  },
  {
    id: 'serif',
    labelKey: 'tpl.font.serif',
    body: "Georgia, 'Times New Roman', 'Songti SC', 'SimSun', serif",
    head: "Georgia, 'Times New Roman', 'Songti SC', 'SimSun', serif",
  },
  {
    id: 'kai',
    labelKey: 'tpl.font.kai',
    body: "'Kaiti SC', 'KaiTi', 'STKaiti', 'Songti SC', serif",
    head: "'Kaiti SC', 'KaiTi', 'STKaiti', 'Songti SC', serif",
  },
  {
    id: 'mono',
    labelKey: 'tpl.font.mono',
    body: "'Courier New', Consolas, 'Songti SC', monospace",
    head: "'Courier New', Consolas, 'Songti SC', monospace",
  },
] as const

export const MONO_STACK = "'JetBrains Mono', Consolas, 'Courier New', monospace"
