#!/usr/bin/env node
/**
 * 一键构建 Android APK（Windows）。
 *
 * 用法：
 *   node tools/build-android.mjs                 # debug 包，产物 release/Lypora-<ver>-android.apk
 *   node tools/build-android.mjs --release       # 未签名 release 包，产物 release/Lypora-<ver>-android-unsigned.apk
 *                                               # 签名要么在 app/build.gradle 配 signingConfigs，要么之后用 apksigner 补签；
 *                                               # 未签名包 Android 装不上，别直接分发。
 *
 * 为什么要这个脚本而不是让用户敲三行命令：
 *   1) `cap copy` 有一个安静的坑：**旧的 hash 文件名不会被清掉**，
 *      曾出现 APK 里躺着上一版的 CSS（面板遮罩修复没生效）却在本地看着正常。
 *      这里强制先删 assets/public，再 copy，然后逐文件比对 dist 与 assets/public 的哈希，
 *      不一致直接失败。
 *   2) Gradle 需要 JDK 21（Capacitor 7 的插件声明 toolchain 21），而本机默认是 25，
 *      脚本按顺序找 JDK：JAVA_HOME → lypora-toolchain/jdk-21 → 报错并说明。
 *   3) 产物改名、算 SHA256、打印安装提示，省得每次翻 build/outputs。
 */

import { execFileSync, execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const CORE = path.join(ROOT, 'core')
const ANDROID = path.join(CORE, 'android')
const OUT = path.join(ROOT, 'release')
const isRelease = process.argv.includes('--release')

const log = (...a) => console.log('[android]', ...a)
const die = (msg) => {
  console.error('[android] 失败：' + msg)
  process.exit(1)
}

/* 1. 找 JDK 21 --------------------------------------------------------- */
const candidates = [
  process.env.JAVA_HOME,
  'C:\\Users\\lenovo\\lypora-toolchain\\jdk-21.0.2',
  'C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.2.13-hotspot',
  'C:\\Program Files\\Java\\jdk-21',
].filter(Boolean)
let javaHome = null
for (const c of candidates) {
  const exe = path.join(c, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
  if (!fs.existsSync(exe)) continue
  let v = ''
  try {
    // java -version 把版本号打到 stderr，必须 2>&1 才能取到
    v = execSync(`"${exe}" -version 2>&1`, { encoding: 'utf8' })
  } catch {
    continue
  }
  const m = /version "(\d+)/.exec(v)
  // 必须**正好** 21：JDK 25 起不了 Gradle 8.11，JDK 17 又不满足 Capacitor 插件的 toolchain=21。
  // 早先写成 ">= 21"，结果脚本自己挑了本机的 25，构建照样失败 —— 判据写松等于没写。
  if (m && Number(m[1]) === 21) {
    javaHome = c
    log(`JDK ${m[1]} → ${c}`)
    break
  }
}
if (!javaHome)
  die(
    '找不到 JDK 21。\n' +
      '  · JDK 17 → Capacitor 7 插件声明 toolchain=21，报 "Cannot find a Java installation … languageVersion=21"\n' +
      '  · JDK 25 → Gradle 8.11.1 起不来\n' +
      '  安装 JDK 21 后设 JAVA_HOME，或放到 C:////Users////<你>////lypora-toolchain////jdk-21.x',
  )

/* 2. 找 SDK ------------------------------------------------------------ */
const sdkCandidates = [
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  'C:\\Users\\lenovo\\lypora-toolchain\\sdk',
  path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk'),
].filter(Boolean)
const sdk = sdkCandidates.find((p) => fs.existsSync(path.join(p, 'platforms')))
if (!sdk) die('找不到 Android SDK（需要 ANDROID_HOME 或 local.properties）')
log(`SDK → ${sdk}`)
fs.writeFileSync(path.join(ANDROID, 'local.properties'), `sdk.dir=${sdk.replace(/\\/g, '\\\\')}\n`)

const env = { ...process.env, JAVA_HOME: javaHome, ANDROID_HOME: sdk }

/* 3. 构建 Web 资源 ----------------------------------------------------- */
log('构建核心（vite build）…')
execSync('npm run build', { cwd: CORE, stdio: 'inherit', env })

/* 4. 清理 + copy + 哈希比对 -------------------------------------------- */
const publicDir = path.join(ANDROID, 'app', 'src', 'main', 'assets', 'public')
fs.rmSync(publicDir, { recursive: true, force: true })
log('已清空 assets/public（旧 hash 文件不清会残留上一版样式）')
execSync('npx cap copy android', { cwd: CORE, stdio: 'inherit', env })

const hashFile = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')
const distAssets = path.join(CORE, 'dist', 'assets')
const apkAssets = path.join(publicDir, 'assets')
const list = (d) => fs.readdirSync(d).sort()
const a = list(distAssets)
const b = fs.existsSync(apkAssets) ? list(apkAssets) : []
if (a.join('|') !== b.join('|')) {
  die(`dist 与 assets/public 文件列表不一致：\n  dist: ${a.join(', ')}\n  apk:  ${b.join(', ')}`)
}
for (const f of a) {
  if (hashFile(path.join(distAssets, f)) !== hashFile(path.join(apkAssets, f))) die(`内容不一致：${f}`)
}
log(`资源比对通过（${a.length} 个文件，逐字节一致）`)

/* 5. Gradle ------------------------------------------------------------ */
const task = isRelease ? 'assembleRelease' : 'assembleDebug'
const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew'
log(`gradle ${task} …`)
execSync(`${gradlew} ${task} --no-daemon --console=plain`, { cwd: ANDROID, stdio: 'inherit', env })

/* 6. 收产物 ------------------------------------------------------------ */
const pkg = JSON.parse(fs.readFileSync(path.join(CORE, 'package.json'), 'utf8'))
const src = path.join(ANDROID, 'app', 'build', 'outputs', 'apk', isRelease ? 'release' : 'debug')
const apkName = isRelease ? `app-release-unsigned.apk` : 'app-debug.apk'
const srcApk = path.join(src, apkName)
if (!fs.existsSync(srcApk)) die(`没找到产物 ${srcApk}`)
fs.mkdirSync(OUT, { recursive: true })
const target = path.join(OUT, `Lypora-${pkg.version}-android${isRelease ? '-unsigned' : ''}.apk`)
fs.copyFileSync(srcApk, target)

const size = fs.statSync(target).size
const sha = hashFile(target)
log(`产物 ${path.relative(ROOT, target)}  ${(size / 1048576).toFixed(1)} MiB`)
log(`sha256 ${sha}`)
log('安装：adb install -r "' + target + '"   或把 APK 传到手机点开安装（需允许未知来源）')
