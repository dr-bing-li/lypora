/**
 * 图片引用 —— 设置持久化 + 环境适配（纯逻辑在 image-path-core.ts）
 * ==========================================================================
 * 背景（v0.8.0）：
 *   此前 `![alt](./img/a.png)` 在桌面版里必然显示不出来。原因不是语法解析错，
 *   而是渲染侧把 markdown 里的 src **原样**塞给 `<img>`：Electron 生产版的页面
 *   URL 是 `file:///…/dist/index.html`（安装版还在 app.asar 内），相对路径的基准
 *   是那个 dist 目录，永远命中不了用户文档旁边的 img/。绝对路径之所以"能显示"，
 *   只是因为 `C:/…` 恰好能被 Chromium 当成本地文件解析。
 *
 * 三个概念，别混：
 *   ① ImageRefMode  —— 引用外部文件 / 内嵌 base64。优先级最高，选 embed 时
 *                      ② 整个不生效（状态栏开关置灰）。
 *   ② ImagePathMode —— 引用模式下写进 markdown 的路径形态：拷贝到附件目录 /
 *                      保留相对路径 / 保留绝对路径。
 *   ③ resolveImageSrc —— 有副作用边界很窄：只读"当前文档路径"这个模块级缓存，
 *                      其余全是纯计算（内核见 image-path-core.ts，可单测）。
 *
 * 环境差异（这是分叉点，改之前务必读）：
 *   · Electron：文档有真实绝对路径 `app.path`，相对路径基于其 dirname 拼接，
 *               最终转成 `file:///C:/…`（file 页面加载 file 资源是同源放行的）。
 *   · Android：文档落在 `Directory.Documents/Lypora/`，相对路径以该目录为基准，
 *               再经 `Capacitor.convertFileSrc()` 变成 WebView 可访问的
 *               `http://localhost/_capacitor_file_/…`。
 *   · 浏览器/PWA：没有文档磁盘路径，**维持原行为**（原样返回），不做假解析。
 * ==========================================================================
 */

import { Capacitor } from '@capacitor/core'
import { desktop } from './files'
import { appDirUriSync, isNative } from './native'
import { readSetting, writeSetting } from './store'
import {
  dirname,
  resolveIn,
  type ImagePathMode,
  type ImageRefMode,
  type ResolveEnv,
} from './image-path-core'

export * from './image-path-core'

const REF_KEY = 'imageRefMode'
const PATH_KEY = 'imagePathMode'

export function getImageRefMode(): ImageRefMode {
  return readSetting<ImageRefMode>(REF_KEY, 'reference') === 'embed' ? 'embed' : 'reference'
}

export function setImageRefMode(mode: ImageRefMode): void {
  writeSetting(REF_KEY, mode)
}

export function getImagePathMode(): ImagePathMode {
  const v = readSetting<ImagePathMode>(PATH_KEY, 'copy')
  return v === 'relative' || v === 'absolute' ? v : 'copy'
}

export function setImagePathMode(mode: ImagePathMode): void {
  writeSetting(PATH_KEY, mode)
}

export function nextImagePathMode(): ImagePathMode {
  const v = getImagePathMode()
  return v === 'copy' ? 'relative' : v === 'relative' ? 'absolute' : 'copy'
}

/* ------------------------------------------------------------------ *
 * 当前文档路径（相对路径的基准）
 * ------------------------------------------------------------------ */

let docPathCache: string | undefined

export function setCurrentDocPath(p: string | undefined): void {
  docPathCache = p
}

export function currentDocPath(): string | undefined {
  return docPathCache
}

/** 文档所在目录；伪协议路径（Android 的 android://）与未保存文档返回 undefined */
export function currentDocDir(): string | undefined {
  const p = docPathCache
  if (!p || /^[a-z]+:\/\//i.test(p)) return undefined
  return dirname(p) || undefined
}

/* ------------------------------------------------------------------ *
 * 环境探测
 * ------------------------------------------------------------------ */

function currentEnv(): ResolveEnv {
  if (desktop()) return { kind: 'electron' }
  if (isNative()) {
    return {
      kind: 'native',
      nativeRoot: appDirUriSync(),
      toViewUrl: (uri) => {
        try {
          return Capacitor.convertFileSrc(uri)
        } catch {
          return uri
        }
      },
    }
  }
  return { kind: 'web' }
}

export function resolveImageSrc(src: string, docPath?: string): string {
  return resolveIn(src, docPath ?? docPathCache, currentEnv())
}
