/**
 * 最小 ZIP 读取器 —— 只为「样式包」服务。
 *
 * 为什么要自己写：样式包要做成 `.zip`（模板 JSON + 背景图 + 印章图），
 * 而项目的硬约束是**零依赖、完全离线**，不能引 jszip。
 * 好在解压不需要自己实现：
 *   - 压缩算法用浏览器原生的 `DecompressionStream('deflate-raw')`（Chromium 80+ / Android WebView 都有）；
 *   - 结构上只支持 ZIP 最常用的两种方法：0 = store（我们自己导出的包就是这种）、8 = deflate。
 *
 * 不做的部分：ZIP64（>4GB）、加密、分卷。样式包是几十 KB 的东西，用不到。
 */

export interface ZipFile {
  name: string
  data: Uint8Array
}

const EOCD_SIG = 0x06054b50
const CEN_SIG = 0x02014b50
const LOC_SIG = 0x04034b50

/** 文件头是否是 ZIP（PK\x03\x04） */
export function looksLikeZip(head: Uint8Array): boolean {
  return head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04
}

export async function unzip(buf: ArrayBuffer): Promise<ZipFile[]> {
  const u8 = new Uint8Array(buf)
  const dv = new DataView(buf)

  // EOCD 在文件末尾，可能带注释（最长 65535），所以从后往前找签名
  let eocd = -1
  const from = Math.max(0, u8.length - 65557)
  for (let i = u8.length - 22; i >= from; i--) {
    if (dv.getUint32(i, true) === EOCD_SIG) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('zip-eocd-not-found')

  const count = dv.getUint16(eocd + 10, true)
  const cenOff = dv.getUint32(eocd + 16, true)
  const dec = new TextDecoder('utf-8')

  const out: ZipFile[] = []
  let p = cenOff
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== CEN_SIG) throw new Error('zip-central-dir-broken')
    const method = dv.getUint16(p + 10, true)
    const compSize = dv.getUint32(p + 20, true)
    const nameLen = dv.getUint16(p + 28, true)
    const extraLen = dv.getUint16(p + 30, true)
    const cmtLen = dv.getUint16(p + 32, true)
    const locOff = dv.getUint32(p + 42, true)
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen))
    p += 46 + nameLen + extraLen + cmtLen

    if (name.endsWith('/')) continue // 目录项

    if (dv.getUint32(locOff, true) !== LOC_SIG) throw new Error('zip-local-header-broken')
    const lNameLen = dv.getUint16(locOff + 26, true)
    const lExtraLen = dv.getUint16(locOff + 28, true)
    const dataStart = locOff + 30 + lNameLen + lExtraLen
    const raw = u8.subarray(dataStart, dataStart + compSize)

    if (method === 0) {
      out.push({ name, data: raw.slice() })
    } else if (method === 8) {
      out.push({ name, data: await inflateRaw(raw) })
    } else {
      throw new Error(`zip-method-unsupported:${method}`)
    }
  }
  return out
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const Ctor = (globalThis as { DecompressionStream?: typeof DecompressionStream }).DecompressionStream
  if (!Ctor) throw new Error('zip-inflate-unavailable')
  const ds = new Ctor('deflate-raw')
  const stream = new Blob([data as unknown as BlobPart]).stream().pipeThrough(ds)
  return new Uint8Array(await new Response(stream).arrayBuffer())
}
