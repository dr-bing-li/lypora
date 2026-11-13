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
 *   schema 5 — 「艺术层」：双面卡片（外圈带 + 内面板）、逐级标题形态、分隔线、
 *              角饰贴纸数组、支撑面（表格/代码/图片）三态、有序序号形态、
 *              配色变体（v0.13.0，拆 md2card 波普那一版）
 *   schema 6 — 「字体与渐层」：标题的字重/字距/前置标记/柔和投影/对角圆角，
 *              标题底与顶条支持渐变，分隔线加渐隐与点线，纹理加菱形网格，
 *              引用块加大引号（v0.14.0，另外四套艺术风）
 * 归一化不留旧版本分支：缺字段一律回落默认值，所以旧模板与旧 .lyt.json 照旧能读。
 */

export const TEMPLATE_SCHEMA = 6

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
  /* ---- schema 5 ---- */
  /**
   * 内面板底色（"白卡"那一层）。空串 = 不铺底，等价于旧行为。
   * 与外圈带配合才有意义：纸色铺满整卡，面板压在上面，中间挖出一块干净的书写区。
   */
  panelBg: string
  /**
   * 纹理/点阵的颜色。空串 = 自动（按纸色亮度算，见 compile.ts 的 texLine）。
   * 波普的黄底点阵要的是「深一号的黄」，靠自动推算永远得不到，必须能指定。
   */
  patternInk: string
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
export type Texture =
  | 'none'
  | 'grain'
  | 'grid'
  | 'dots'
  | 'ruled'
  | 'fiber'
  | 'halo'
  | 'stripe'
  | 'perf'
  | 'lattice'
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

/** 引用框形态：左竖线 / 卡片 / 四角书引 / 气泡 / 大引号 / 无 */
export type QuoteStyle = 'bar' | 'card' | 'quad' | 'bubble' | 'quotemark' | 'none'
export const QUOTE_STYLES: readonly QuoteStyle[] = ['bar', 'card', 'quad', 'bubble', 'quotemark', 'none']

/** 项目符号：实心点 / 破折 / 方块 / 空心圈 / 汉字序号 / 五角星 / 无 */
export type BulletStyle = 'dot' | 'dash' | 'square' | 'ring' | 'cjk' | 'star' | 'none'
export const BULLET_STYLES: readonly BulletStyle[] = ['dot', 'dash', 'square', 'ring', 'cjk', 'star', 'none']

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
  /* ---- schema 5 ---- */
  /** 双面卡片：外圈带 + 内面板 */
  panel: PanelSpec
  /** 逐级标题形态（h1..h4 各一套） */
  headings: HeadingsSpec
  /** 分隔线（hr）形态 */
  rule: RuleSpec
  /** 角饰贴纸，最多 6 枚 */
  ornaments: OrnamentSpec[]
  /** 支撑面：表格 / 代码 / 图片 */
  surface: SurfaceSpec
  /** 有序列表序号形态 */
  listNo: ListNo
  /* ---- schema 6 ---- */
  /** 卡片顶部的横向色条（品牌栏那种） */
  topBar: TopBarSpec
}

/* ================================================================== *
 * schema 5「艺术层」
 *
 * 拆 md2card 波普得到的三条判断，决定了这一层的形状：
 * 1. 所谓"黄色边框"其实是 `padding: 30px` + 点阵底，中间的白卡是第二个面 ——
 *    所以需要的是**面板**，不是更粗的 border。
 * 2. 白卡的"厚度"来自 `box-shadow: 10px 10px 0`（模糊半径 0）—— 所以阴影必须是
 *    **预设**而不是自由字符串：一旦允许 `box-shadow: 0 0 40px red` 进来，
 *    "贴纸感"就没了，而且任意 CSS 会绕过 normalize 的夹取。
 * 3. 三级标题三种形态（重影 / 青块旋转 / 珊瑚圆角块）—— 所以标题必须**逐级**，
 *    一个全局 `decor.title` 表达不了。
 *
 * 这一层所有字段都是数字 / 枚举 / 颜色，没有一处自由字符串进 CSS。
 * ================================================================== */

/** 面板投影预设：无 / 贴纸（零模糊硬影）/ 浮起（柔影） */
export type PanelShadow = 'none' | 'sticker' | 'float'
export const PANEL_SHADOWS: readonly PanelShadow[] = ['none', 'sticker', 'float']

/** 双面卡片：外圈带宽度 + 内面板的底/边/圆角/投影/内边距 */
export interface PanelSpec {
  /** 外圈宽度 px；0 = 单面（等价于 schema 4 的行为） */
  band: number
  /** 内面板描边 px，0 = 无（颜色固定取墨色：面板边是"墨线"，换色用 tokens.ink） */
  border: number
  /** 内面板圆角 px */
  radius: number
  /** 投影预设 */
  shadow: PanelShadow
  /** 面板内边距 px；0 = 沿用 metrics 的 padX/padTop/padBottom */
  pad: number
}

/** 标题下划线：无 / 实线 / 斜纹（双色重复渐变） / 渐隐（两端透明） / 短棒（居中定宽） */
export type HeadRuleStyle = 'none' | 'solid' | 'stripe' | 'fade' | 'bar'
export const HEAD_RULES: readonly HeadRuleStyle[] = ['none', 'solid', 'stripe', 'fade', 'bar']

/**
 * 标题前置标记：无 / 竖条 / 菱形。
 * 竖条是"引文式"的左饰条（左内边距让它有地方站），菱形是装饰艺术风格的小菱形。
 * 两者都用 ::before 画，因此**与「下划线」不冲突**（下划线走 background，占的是自身盒子）。
 */
export type HeadMark = 'none' | 'bar' | 'diamond'
export const HEAD_MARKS: readonly HeadMark[] = ['none', 'bar', 'diamond']

/**
 * 标题块的投影：无 / 柔和（下落 4px、模糊 12px、取 accent 的淡影） / 光晕（同尺寸的辉光）。
 * 波普那种"零模糊硬阴影"是 HeadSpec.shadow（文字位移重影），这里管的是**盒子**的影。
 */
export type HeadElev = 'none' | 'soft' | 'glow'
export const HEAD_ELEVS: readonly HeadElev[] = ['none', 'soft', 'glow']

/** 单级标题形态（h1..h4 各一份） */
export interface HeadSpec {
  /** 底色或渐变，空串 = 不铺底。渐变走 background 而不是 background-color */
  bg: string
  /** 文字色，空串 = 继承正文墨色 */
  fg: string
  /** 左右内边距 px */
  padX: number
  /** 上下内边距 px */
  padY: number
  /** 圆角 px */
  radius: number
  /**
   * 对角圆角 px（第 2、4 角），0 = 等于 radius。
   * 四值圆角没法用一个滑块表达，但"胶囊 + 一对大角"这种形态靠两个值就够了。
   */
  radiusAlt: number
  /** 旋转角度 −3..3；0 = 不转 */
  rotate: number
  /** 位移重影 px（文字阴影，色取 accent）；0 = 无 */
  shadow: number
  /** 块投影 */
  elev: HeadElev
  /** 字重；0 = 不设（跟随基础样式） */
  weight: number
  /** 字距 px，−2..8；正数拉开、负数收紧 */
  track: number
  /** 前置标记 */
  mark: HeadMark
  /** 标记色，空串 = 跟随文字色；标记也用作下划线以外的小装饰 */
  markColor: string
  /** 全大写 */
  caps: boolean
  /** 斜体 */
  italic: boolean
  /** 对齐：左 / 居中 */
  align: 'start' | 'center'
  /** 收窄到内容宽（色块只包住字，不铺满整行） */
  inline: boolean
  /** 下划线样式 */
  rule: HeadRuleStyle
}

export const HEAD_LEVELS = ['h1', 'h2', 'h3', 'h4'] as const
export type HeadLevel = (typeof HEAD_LEVELS)[number]
export type HeadingsSpec = Record<HeadLevel, HeadSpec>

/**
 * 分隔线形态：无 / 实线 / 虚线 / 斜纹 / 胶带（横条双色） / 渐隐（两端透明） / 点线（打字机虚线）
 */
export type HrStyle = 'none' | 'solid' | 'dashed' | 'stripe' | 'tape' | 'fade' | 'dot'
export const HR_STYLES: readonly HrStyle[] = ['none', 'solid', 'dashed', 'stripe', 'tape', 'fade', 'dot']

export interface RuleSpec {
  style: HrStyle
  /** 线高 px */
  height: number
  /** 主色，空串 = 跟随 tokens.rule */
  color: string
  /** 第二色（斜纹与胶带用），空串 = 跟随 tokens.ink */
  color2: string
  /** 斜纹角度 */
  angle: number
}

/** 贴纸图元：五角星 / 四角星 / 爆炸星 / 圆徽标（带字）/ 墨点 */
export type OrnamentShape = 'star5' | 'star4' | 'burst' | 'badge' | 'blob'
export const ORNAMENT_SHAPES: readonly OrnamentShape[] = ['star5', 'star4', 'burst', 'badge', 'blob']

export interface OrnamentSpec {
  shape: OrnamentShape
  /** 落点（四角，与印章共用枚举） */
  pos: StampPos
  /** 边长 px */
  size: number
  /** 旋转角度 −45..45 */
  rotate: number
  /** 填充色 */
  fill: string
  /** 描边色（空串 = 不描边） */
  stroke: string
  /** badge/blob 上的字，≤6 字符 */
  text: string
  /** 出血：向卡片外顶出的 px，0 = 完全贴边 */
  bleed: number
}

/** 支撑面三态：扁平 / 描边 / 波普（粗描边 + 硬投影） */
export type SurfaceBox = 'flat' | 'boxed' | 'pop'
export const SURFACE_BOXES: readonly SurfaceBox[] = ['flat', 'boxed', 'pop']
/** 图片态：朴素 / 画框 / 胶带贴 */
export type SurfaceImage = 'plain' | 'framed' | 'taped'
export const SURFACE_IMAGES: readonly SurfaceImage[] = ['plain', 'framed', 'taped']

export interface SurfaceSpec {
  table: SurfaceBox
  code: SurfaceBox
  image: SurfaceImage
}

/** 有序序号：默认（1. 2.）/ 圆形徽标 / 方形徽标 */
export type ListNo = 'plain' | 'circle' | 'square'
export const LIST_NOS: readonly ListNo[] = ['plain', 'circle', 'square']

/**
 * 卡片顶部的横向色条（"品牌栏"）。
 *
 * 一行高度 + 两个色值，就是一个水平渐变条。做成数据而不是"再来一个 frame 枚举"，
 * 是因为它的三个自由度（多高、哪两色、要不要渐变）都必须是可调的：
 * 同一套模板换个主色，这条栏得跟着变。
 *
 * 高度默认 0 = 不画，所以老模板加这个字段不会有任何像素变化。
 */
export interface TopBarSpec {
  /** 高度 px，0 = 不画 */
  height: number
  /** 起始色，空串 = 跟随 tokens.accent */
  from: string
  /** 结束色，空串 = 同 from（即纯色条） */
  to: string
}

/**
 * 配色变体：只覆盖 token，不动任何布局。
 *
 * 这是性价比最高的一项 —— 一套模板四套配色，用户点一下就是另一张卡。
 * 刻意**不做成"渲染时叠加"**：点击即写进当前模板的 tokens（见 beautify-panel 的
 * applyVariant），当前项靠比对 tokens 高亮。这样"存为我的模板"拿到的是所见即所得的颜色，
 * 也不会出现"面板改色被变体压回去"的优先级怪事。
 */
export interface TemplateVariant {
  id: string
  name: string
  tokens: Partial<TemplateTokens>
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
  /** 配色变体（schema 5）：只覆盖 token，随模板一起导出/导入 */
  variants?: TemplateVariant[]
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
