/**
 * 关窗流程验收 —— 点右上角叉号（= window close 事件）必须能把程序关掉，
 * 并且脏文档先走「保存并退出 / 不保存 / 取消」三选一。
 *
 * 用法：
 *   node tools/closetest.mjs                 # 打源码态的 Electron
 *   node tools/closetest.mjs --exe           # 打 release/Lypora/Lypora.exe（打包产物）
 *
 * 四个场景（每个都真启动进程，靠退出码与文件内容判定）：
 *   clean         无修改 → 直接关掉，退出码 0
 *   dirty-cancel  有修改 + 取消 → 窗口保持打开（我们的探针在 3.2s 后退出码 4）
 *   dirty-discard 有修改 + 不保存 → 关掉，退出码 0，磁盘文件不变
 *   dirty-save    有修改 + 保存并退出 → 关掉，退出码 0，磁盘文件出现 CLOSETEST_EDIT
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const useExe = process.argv.includes('--exe')
const EXE = useExe ? path.join(ROOT, 'release', 'Lypora', 'Lypora.exe') : path.join(ROOT, 'desktop', 'node_modules', 'electron', 'dist', 'electron.exe')
const APP_DIR = path.join(ROOT, 'desktop')

if (!existsSync(EXE)) {
  console.error(`找不到可执行文件：${EXE}`)
  process.exit(2)
}

const work = mkdtempSync(path.join(tmpdir(), 'lypora-close-'))
const seed = (name) => {
  const p = path.join(work, name)
  writeFileSync(p, '# 关窗测试\n\n原始内容。\n', 'utf8')
  return p
}

function run(args, { timeout = 25000 } = {}) {
  return new Promise((resolve) => {
    const env = { ...process.env }
    // 宿主会注入 ELECTRON_RUN_AS_NODE，必须剔除，否则主进程里 ipcMain 是 undefined
    delete env.ELECTRON_RUN_AS_NODE
    const argv = useExe ? args : [APP_DIR, ...args]
    const child = spawn(EXE, argv, { cwd: ROOT, env, windowsHide: false })
    let out = ''
    child.stdout.on('data', (d) => (out += d.toString()))
    child.stderr.on('data', (d) => (out += d.toString()))
    const timer = setTimeout(() => {
      out += '\n[TIMEOUT]'
      child.kill()
    }, timeout)
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve({ code, out })
    })
  })
}

const scenarios = []

// ① 干净文档：点叉号应当直接退出
scenarios.push({
  name: 'clean',
  args: ['--closetest=clean'],
  expectExit: 0,
  check: (r) => {
    const ready = JSON.parse((r.out.match(/CLOSETEST_READY (\{.*\})/) || [])[1] || '{}')
    return {
      ready: /CLOSETEST_READY/.test(r.out),
      // 干净文档不该弹询问框
      guardSkipped: !/CLOSE_GUARD/.test(r.out),
      notDirty: ready.dirty === false,
    }
  },
})

// ② 有修改 + 取消：窗口必须留下（探针 3.2s 后以 4 退出）
scenarios.push({
  name: 'dirty-cancel',
  args: ['--closetest=dirty-cancel', '--close-choice=cancel'],
  expectExit: 4,
  check: (r) => ({
    guard: /CLOSE_GUARD .*"choice":"cancel"/.test(r.out),
    stillAlive: /CLOSETEST_STILL_ALIVE/.test(r.out),
  }),
})

// ③ 有修改 + 不保存：退出但不写盘
{
  const f = seed('discard.md')
  const before = readFileSync(f, 'utf8')
  scenarios.push({
    name: 'dirty-discard',
    args: ['--closetest=dirty-discard', '--close-choice=discard', f],
    expectExit: 0,
    check: (r) => ({
      guard: /CLOSE_GUARD .*"choice":"discard"/.test(r.out),
      fileUntouched: readFileSync(f, 'utf8') === before,
    }),
  })
}

// ④ 有修改 + 保存并退出：退出且内容落盘
{
  const f = seed('save.md')
  scenarios.push({
    name: 'dirty-save',
    args: ['--closetest=dirty-save', '--close-choice=save', f],
    expectExit: 0,
    check: (r) => {
      const after = readFileSync(f, 'utf8')
      return {
        guard: /CLOSE_GUARD .*"choice":"save"/.test(r.out),
        saved: after.includes('CLOSETEST_EDIT'),
        bytes: Buffer.byteLength(after),
      }
    },
  })
}

let failed = 0
const results = []
for (const s of scenarios) {
  const r = await run(s.args)
  const details = s.check(r)
  const ok = r.code === s.expectExit && Object.values(details).every((v) => v !== false && v !== null && v !== undefined)
  if (!ok) failed++
  results.push({ scenario: s.name, ok, exitCode: r.code, expectExit: s.expectExit, ...details })
  const log = r.out
    .split('\n')
    .filter((l) => /CLOSETEST_|CLOSE_GUARD|CLOSE_ABORTED|SELFTEST_FAIL/.test(l))
    .join(' | ')
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${s.name.padEnd(14)} exit=${r.code}  ${log.slice(0, 220)}`)
}

console.log('\n' + JSON.stringify({ ok: failed === 0, failed, results }, null, 2))
process.exit(failed === 0 ? 0 : 1)
