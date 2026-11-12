/**
 * 内置帮助文档（v0.11.0）。
 *
 * 为什么用 .md 而不是写死一段 HTML：帮助正文本身就是 Markdown，交给编辑器现成的
 * 渲染管线（装饰层）显示即可 —— 排版、代码块、表格、图片全都不用重写一遍，
 * 而且"帮助"和"文档"用同一个只读视图，样式天然一致。
 *
 * 语言：中文 / 英文两份。其余 5 种语言回落英文（界面文案仍全量 7 种，只有长正文
 * 不翻译 —— 8 篇 × 7 种正文的维护成本远超收益，见 docs/04 V57）。
 * 打包方式：`?raw` 让 vite 把 md 当字符串内联进 bundle，离线可用、不额外发请求。
 */

import { getLocale, type MessageKey } from '../i18n'

import zhShortcuts from './zh/shortcuts.md?raw'
import zhFeatures from './zh/features.md?raw'
import zhThemes from './zh/themes.md?raw'
import zhWidth from './zh/width.md?raw'
import zhImages from './zh/images.md?raw'
import zhLayout from './zh/layout.md?raw'
import zhSettings from './zh/settings.md?raw'
import zhAbout from './zh/about.md?raw'

import enShortcuts from './en/shortcuts.md?raw'
import enFeatures from './en/features.md?raw'
import enThemes from './en/themes.md?raw'
import enWidth from './en/width.md?raw'
import enImages from './en/images.md?raw'
import enLayout from './en/layout.md?raw'
import enSettings from './en/settings.md?raw'
import enAbout from './en/about.md?raw'

export type HelpId =
  | 'shortcuts'
  | 'features'
  | 'themes'
  | 'width'
  | 'images'
  | 'layout'
  | 'settings'
  | 'about'

interface HelpEntry {
  id: HelpId
  titleKey: MessageKey
  zh: string
  en: string
}

/** 顺序即「帮助」菜单顺序：先给人看怎么用，最后才是关于 */
export const HELP_DOCS: readonly HelpEntry[] = [
  { id: 'shortcuts', titleKey: 'help.shortcuts', zh: zhShortcuts, en: enShortcuts },
  { id: 'features', titleKey: 'help.features', zh: zhFeatures, en: enFeatures },
  { id: 'themes', titleKey: 'help.themes', zh: zhThemes, en: enThemes },
  { id: 'width', titleKey: 'help.width', zh: zhWidth, en: enWidth },
  { id: 'images', titleKey: 'help.images', zh: zhImages, en: enImages },
  { id: 'layout', titleKey: 'help.layoutDoc', zh: zhLayout, en: enLayout },
  { id: 'settings', titleKey: 'help.settingsDoc', zh: zhSettings, en: enSettings },
  { id: 'about', titleKey: 'help.about', zh: zhAbout, en: enAbout },
]

export function helpTitle(id: HelpId): MessageKey {
  const doc = HELP_DOCS.find((d) => d.id === id)
  return doc ? doc.titleKey : 'help.about'
}

/** 按当前界面语言取正文；非中文一律走英文版 */
export function helpText(id: HelpId): string {
  const doc = HELP_DOCS.find((d) => d.id === id)
  if (!doc) return ''
  return getLocale() === 'zh-CN' ? doc.zh : doc.en
}
