/**
 * 轻量语法高亮器
 * ------------------------------------------------------------------
 * 设计取舍：不引入 @codemirror/language-data（它会拉几十个语言包，包体和依赖都不可控），
 * 改用一套通用词法规则 + 各语言关键字表。对常见的 js/ts/py/java/c/cpp/go/rust/sql/sh/json
 * 已足够；未识别的语言退化为纯文本。
 */

export interface Token {
  from: number
  to: number
  cls: string
}

const COMMON = [
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue',
  'return', 'function', 'class', 'extends', 'implements', 'interface', 'enum', 'struct',
  'import', 'export', 'from', 'as', 'package', 'namespace', 'using', 'include',
  'try', 'catch', 'finally', 'throw', 'throws', 'new', 'delete', 'this', 'super',
  'public', 'private', 'protected', 'static', 'final', 'const', 'let', 'var', 'val',
  'async', 'await', 'yield', 'def', 'lambda', 'pass', 'raise', 'with', 'in', 'is', 'not',
  'and', 'or', 'elif', 'except', 'global', 'nonlocal', 'assert', 'del', 'None', 'True',
  'False', 'null', 'undefined', 'true', 'false', 'nil', 'void', 'int', 'float', 'double',
  'char', 'bool', 'boolean', 'string', 'byte', 'long', 'short', 'unsigned', 'signed',
  'fn', 'impl', 'trait', 'pub', 'mut', 'match', 'loop', 'use', 'mod', 'crate', 'where',
  'self', 'typeof', 'instanceof', 'select', 'from', 'where', 'group', 'order', 'limit',
  'insert', 'update', 'delete', 'create', 'table', 'join', 'on', 'having', 'union',
  'func', 'go', 'defer', 'chan', 'map', 'range', 'type',
]

const KEYWORDS = new Set(COMMON)

/** 取语言标识的归一化 key */
function normLang(lang: string): string {
  const l = lang.trim().toLowerCase()
  const map: Record<string, string> = {
    js: 'js', javascript: 'js', jsx: 'js', mjs: 'js', cjs: 'js', ts: 'js', typescript: 'js', tsx: 'js',
    py: 'py', python: 'py', py3: 'py',
    java: 'java', kotlin: 'java', kt: 'java', scala: 'java',
    c: 'c', h: 'c', cpp: 'c', 'c++': 'c', cc: 'c', hpp: 'c', cs: 'c', csharp: 'c', objc: 'c',
    go: 'go', golang: 'go',
    rs: 'rs', rust: 'rs',
    sh: 'sh', bash: 'sh', shell: 'sh', zsh: 'sh', console: 'sh',
    sql: 'sql', mysql: 'sql', postgres: 'sql', psql: 'sql',
    json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'yaml', ini: 'yaml',
    html: 'html', htm: 'html', xml: 'html', svg: 'html', vue: 'html',
    css: 'css', scss: 'css', less: 'css',
  }
  return map[l] || l
}

function commentStyle(kind: string): RegExp | null {
  if (kind === 'sh' || kind === 'py' || kind === 'yaml') return /#[^\n]*/g
  if (kind === 'sql') return /--[^\n]*/g
  return /\/\/[^\n]*|\/\*[\s\S]*?\*\//g
}

/**
 * 对一段代码文本做高亮，返回相对于代码起始位置的 token 列表。
 */
export function highlightCode(code: string, lang: string): Token[] {
  const kind = normLang(lang)
  const tokens: Token[] = []
  const taken: boolean[] = new Array(code.length).fill(false)

  const mark = (from: number, to: number, cls: string) => {
    if (to <= from) return
    // 已被占用的区间不重复标记（先匹配到的优先级更高）
    for (let i = from; i < to; i++) if (taken[i]) return
    for (let i = from; i < to; i++) taken[i] = true
    tokens.push({ from, to, cls })
  }

  // 1) 注释（最高优先级）
  const cs = commentStyle(kind)
  if (cs) {
    let m: RegExpExecArray | null
    cs.lastIndex = 0
    while ((m = cs.exec(code))) mark(m.index, m.index + m[0].length, 'tok-com')
  }

  // 2) 字符串
  const strRe = /'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g
  let m: RegExpExecArray | null
  strRe.lastIndex = 0
  while ((m = strRe.exec(code))) mark(m.index, m.index + m[0].length, 'tok-str')

  // 3) 数字
  const numRe = /\b(?:0[xXbBoO][0-9a-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/g
  numRe.lastIndex = 0
  while ((m = numRe.exec(code))) mark(m.index, m.index + m[0].length, 'tok-num')

  // 4) 关键字
  const idRe = /\b[A-Za-z_$][\w$]*\b/g
  idRe.lastIndex = 0
  while ((m = idRe.exec(code))) {
    const word = m[0]
    if (KEYWORDS.has(word) && kind !== 'json') {
      mark(m.index, m.index + word.length, 'tok-kw')
    } else if (code[m.index + word.length] === '(') {
      mark(m.index, m.index + word.length, 'tok-fn')
    }
  }

  tokens.sort((a, b) => a.from - b.from)
  return tokens
}
