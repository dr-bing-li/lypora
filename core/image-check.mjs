/**
 * 图片路径解析用例表 —— 零浏览器、零构建，直接跑纯函数内核
 *
 *   node --experimental-strip-types image-check.mjs
 *
 * 为什么要单独一个：相对路径显示不出来是这个 bug 的核心，而它只在 Electron
 * 的 file:// 页面下必然复现。用一个覆盖三端分支的用例表把它钉死，
 * 比"打开软件拖一张图看看"可靠得多 —— 后者验不出 ../、跨盘、编码这些边角。
 */

import {
  assetDirCandidates,
  assetDirFromContent,
  dirname,
  encodeRefPath,
  joinPath,
  normalizePath,
  relativePath,
  resolveIn,
  toFileUrl,
} from './src/io/image-path-core.ts'

const results = []
function eq(name, got, want) {
  const ok = got === want
  results.push({ name, ok, got, want })
}

const E = { kind: 'electron' }
const W = { kind: 'web' }
const N = {
  kind: 'native',
  nativeRoot: 'file:///storage/emulated/0/Android/data/app.lypora.editor/files/Documents/Lypora',
  toViewUrl: (u) => `http://localhost/_capacitor_file_${u.replace(/^file:\/\//, '')}`,
}

/* ---------------- Electron：相对/绝对路径 ---------------- */
eq('electron ./img', resolveIn('./img/a.png', 'D:/docs/a.md', E), 'file:///D:/docs/img/a.png')
eq('electron img', resolveIn('img/a.png', 'D:/docs/a.md', E), 'file:///D:/docs/img/a.png')
eq('electron ../', resolveIn('../pics/b.png', 'D:/docs/sub/a.md', E), 'file:///D:/docs/pics/b.png')
eq('electron 同盘深处', resolveIn('../../x/y.png', 'D:/a/b/c/a.md', E), 'file:///D:/a/x/y.png')
eq('electron 正斜杠绝对', resolveIn('C:/x/y.png', 'D:/docs/a.md', E), 'file:///C:/x/y.png')
eq('electron 反斜杠绝对', resolveIn('C:\\x\\y.png', 'D:/docs/a.md', E), 'file:///C:/x/y.png')
eq('electron unix 绝对', resolveIn('/tmp/a.png', 'D:/docs/a.md', E), 'file:///tmp/a.png')
eq('electron 空格与井号', resolveIn('./img/a b#c.png', 'D:/docs/a.md', E), 'file:///D:/docs/img/a%20b%23c.png')
eq('electron 中文名', resolveIn('./图片/测试.png', 'D:/docs/a.md', E), 'file:///D:/docs/%E5%9B%BE%E7%89%87/%E6%B5%8B%E8%AF%95.png')
eq('electron 无文档路径', resolveIn('./img/a.png', undefined, E), './img/a.png')

/* ---------------- 外部 src 一律不动 ---------------- */
eq('data uri', resolveIn('data:image/png;base64,AAAA', 'D:/docs/a.md', E), 'data:image/png;base64,AAAA')
eq('https', resolveIn('https://e.com/a.png', 'D:/docs/a.md', E), 'https://e.com/a.png')
eq('file url', resolveIn('file:///C:/x/a.png', 'D:/docs/a.md', E), 'file:///C:/x/a.png')
eq('锚点', resolveIn('#a', 'D:/docs/a.md', E), '#a')

/* ---------------- Android ---------------- */
eq(
  'native 相对',
  resolveIn('./img/a.png', 'android://a.md', N),
  'http://localhost/_capacitor_file_/storage/emulated/0/Android/data/app.lypora.editor/files/Documents/Lypora/img/a.png',
)
eq(
  'native file url',
  resolveIn('file:///storage/x/a.png', 'android://a.md', N),
  'http://localhost/_capacitor_file_/storage/x/a.png',
)
eq('native 无根目录', resolveIn('./img/a.png', 'android://a.md', { kind: 'native' }), './img/a.png')

/* ---------------- 浏览器：维持旧行为 ---------------- */
eq('web 相对', resolveIn('./img/a.png', undefined, W), './img/a.png')
eq('web 绝对', resolveIn('C:/x/a.png', undefined, W), 'C:/x/a.png')

/* ---------------- 路径工具 ---------------- */
eq('dirname 文件', dirname('C:/a/b.md'), 'C:/a')
eq('dirname 盘根', dirname('C:/a.md'), 'C:/')
eq('dirname 无斜杠', dirname('a.md'), '')
eq('normalize ..', normalizePath('C:/a/../b/./c.png'), 'C:/b/c.png')
eq('normalize 相对保留 ..', normalizePath('../a/b.png'), '../a/b.png')
eq('join', joinPath('D:/docs', './img/a.png'), 'D:/docs/img/a.png')
eq('relative 同级', relativePath('D:/docs/img/a.png', 'D:/docs'), 'img/a.png')
eq('relative 子目录', relativePath('D:/docs/sub/a.png', 'D:/docs'), 'sub/a.png')
eq('relative 上级', relativePath('D:/x/a.png', 'D:/docs'), '../x/a.png')
eq('relative 跨盘', relativePath('E:/x.png', 'D:/docs'), null)
eq('toFileUrl', toFileUrl('C:/x/y.png'), 'file:///C:/x/y.png')
eq('toFileUrl 空格', toFileUrl('C:/x/a b.png'), 'file:///C:/x/a%20b.png')

/* ---------------- 附件目录探测 ---------------- */
eq('探测多数派', assetDirFromContent('![a](img/x.png)\n![b](img/y.png)\n![c](assets/z.png)'), 'img')
eq('探测忽略同级图', assetDirFromContent('![a](a.png)'), null)
eq('探测忽略外链', assetDirFromContent('![a](https://e.com/x/a.png)'), null)
eq('探测 ./ 前缀', assetDirFromContent('![a](./pics/x.png)'), 'pics')
eq('候选首位是探测结果', assetDirCandidates('![a](images/x.png)')[0], 'images')
eq('候选兜底 assets', assetDirCandidates('')[0], 'assets')
eq('编码空格井号问号', encodeRefPath('a b#c?d.png'), 'a%20b%23c%3Fd.png')

/* ---------------- 汇总 ---------------- */
const bad = results.filter((r) => !r.ok)
for (const r of bad) {
  console.error(`✗ ${r.name}\n    got  ${JSON.stringify(r.got)}\n    want ${JSON.stringify(r.want)}`)
}
console.log(JSON.stringify({ total: results.length, pass: results.length - bad.length, fail: bad.length }, null, 2))
process.exit(bad.length ? 1 : 0)
