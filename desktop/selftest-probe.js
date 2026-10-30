// Electron 自检注入脚本（在渲染进程执行）
// 单独成文件的原因：可直接用 node --check 校验语法，避免模板字符串里的转义把正则写坏。
;(() => {
  try {
    const sb = document.getElementById('sidebar')
    const ed = document.querySelector('.editor-wrap')
    const sbBox = sb ? sb.getBoundingClientRect() : null
    const edBox = ed ? ed.getBoundingClientRect() : null
    const line = document.querySelector('.cm-line')
    const ua = navigator.userAgent
    const m = ua.match(/Electron\/([\d.]+)/)
    return {
      title: document.title,
      docTitle: (document.getElementById('doc-title') || {}).textContent || null,
      menuRoots: Array.prototype.map.call(
        document.querySelectorAll('#menubar-items .menu-root'),
        (e) => e.textContent.trim()
      ),
      sidebarOnLeft: !!(sbBox && edBox && sbBox.right <= edBox.left + 2),
      sidebarWidth: sbBox ? Math.round(sbBox.width) : null,
      firstLine: line ? (line.textContent || '').slice(0, 40) : null,
      hasHashMark: line ? (line.textContent || '').charAt(0) === '#' : null,
      tables: document.querySelectorAll('table').length,
      /** 列宽拖拽线：首屏没表格时为 0，滚动后才 >0（故仅作存在性参考） */
      tableGrips: document.querySelectorAll('.cm-col-grip').length,
      bullets: document.querySelectorAll('.cm-bullet-widget').length,
      tasks: document.querySelectorAll('.cm-task-box').length,
      outlineItems: document.querySelectorAll('.outline-item').length,
      /** Ctrl+滚轮改的就是这个变量 */
      fontSizeVar: getComputedStyle(document.documentElement).getPropertyValue('--content-font-size').trim(),
      hasFontOsd: !!document.getElementById('font-osd'),
      hasDesktopBridge: !!window.lyporaDesktop,
      bridgeApi: window.lyporaDesktop ? Object.keys(window.lyporaDesktop).sort() : [],
      electronVersion: m ? m[1] : null,
      bodyBg: getComputedStyle(document.body).backgroundColor,
    }
  } catch (e) {
    return { error: String(e && e.message ? e.message : e) }
  }
})()
