/** IndexedDB 轻量封装：用于最近文件与草稿持久化（浏览器/PWA 无本地文件系统时的主要存储） */

const DB_NAME = 'lypora'
const STORE = 'docs'
const META = 'meta'

export interface StoredDoc {
  id: string
  name: string
  content: string
  updated: number
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDB()
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode)
    const req = fn(t.objectStore(store))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function putDoc(doc: StoredDoc): Promise<void> {
  await tx(STORE, 'readwrite', (s) => s.put(doc) as unknown as IDBRequest<void>)
}

export async function getDoc(id: string): Promise<StoredDoc | undefined> {
  return tx<StoredDoc | undefined>(STORE, 'readonly', (s) => s.get(id) as IDBRequest<StoredDoc | undefined>)
}

export async function listDocs(): Promise<StoredDoc[]> {
  const all = await tx<StoredDoc[]>(STORE, 'readonly', (s) => s.getAll() as IDBRequest<StoredDoc[]>)
  return (all || []).sort((a, b) => b.updated - a.updated)
}

export async function deleteDoc(id: string): Promise<void> {
  await tx(STORE, 'readwrite', (s) => s.delete(id) as unknown as IDBRequest<void>)
}

/** 会话状态（主题、字号、折叠状态）存 localStorage，读写频繁且体量小 */
export function readSetting<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem('lypora:' + key)
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function writeSetting(key: string, value: unknown): void {
  try {
    localStorage.setItem('lypora:' + key, JSON.stringify(value))
  } catch {
    /* 存储满或隐私模式，忽略 */
  }
}

/* ---------------------------------------------------------------------------
 * 0.4.0 起产品更名为 Lypora，设置项的 localStorage 前缀随之改变。
 * 老用户（含本机回归测试）升级后不该丢主题/字号/列宽，这里做一次性搬迁：
 *   typorax:fontSize / :pageWidth / :theme / :tableCols / typorax.customThemes
 * 只搬「新键不存在」的那些，搬完删旧键，并打一个 lypora:migrated 旗标。
 * IndexedDB 的草稿库不做搬迁：库名换了，旧草稿留作本地历史，不影响使用。
 * ------------------------------------------------------------------------- */
const LEGACY_PREFIX = 'typorax'
const MIGRATED_FLAG = 'lypora:migrated'

export function migrateLegacySettings(): void {
  try {
    if (localStorage.getItem(MIGRATED_FLAG)) return
    const legacy: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(LEGACY_PREFIX)) legacy.push(k)
    }
    for (const k of legacy) {
      const next = 'lypora' + k.slice(LEGACY_PREFIX.length)
      const val = localStorage.getItem(k)
      if (val !== null && localStorage.getItem(next) === null) localStorage.setItem(next, val)
      localStorage.removeItem(k)
    }
    localStorage.setItem(MIGRATED_FLAG, '1')
  } catch {
    /* 隐私模式 / 配额满：跳过，不影响启动 */
  }
}
