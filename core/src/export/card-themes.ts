/**
 * 输出画布尺寸 —— 与「模板」正交的另一个维度。
 *
 * 模板管"长什么样"，尺寸管"多大一张"。两者拆开的好处：12 套模板 × 4 种尺寸
 * 组合出 48 种结果，而只需要维护 12 + 4 份数据。
 *
 * 逻辑尺寸按 96dpi 给版面宽度，scale 只影响清晰度（截图时乘上去）。
 */

export const BRAND = 'Lypora'

export interface CardSize {
  id: string
  /** 中文名（保留给归档、日志与老调用点） */
  label: string
  labelEn: string
  /** 界面显示用：走 i18n，否则切换语言后菜单里会留一串中文 */
  labelKey: string
  /** 逻辑像素宽 */
  w: number
  /** 逻辑像素高 */
  h: number
  /** 输出倍率 */
  scale: number
}

export const CARD_SIZES: CardSize[] = [
  { id: 'xhs', label: '竖版 3:4', labelEn: 'Portrait 3:4', labelKey: 'size.xhs', w: 540, h: 720, scale: 2 },
  { id: 'square', label: '方版 1:1', labelEn: 'Square 1:1', labelKey: 'size.square', w: 540, h: 540, scale: 2 },
  { id: 'story', label: '长竖 9:16', labelEn: 'Story 9:16', labelKey: 'size.story', w: 540, h: 960, scale: 2 },
  { id: 'a4', label: 'A4 纸', labelEn: 'A4', labelKey: 'size.a4', w: 595, h: 842, scale: 2 },
]

export function findSize(id: string): CardSize {
  return CARD_SIZES.find((s) => s.id === id) ?? CARD_SIZES[0]
}
