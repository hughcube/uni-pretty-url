export interface CompiledPattern {
  regex: RegExp
  paramNames: string[]
  pattern: string
}

// Token from unified parser — shared by compile() and generate()
type Token = StaticToken | ParamToken
interface StaticToken {
  type: 'static'
  value: string
}
interface ParamToken {
  type: 'param'
  name: string
  constraint?: string
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/**
 * Scan a constraint string and convert every *capturing* group to non-capturing,
 * so the only capturing group is the param wrapper compile() adds around it —
 * keeping match() index alignment correct for multi-param patterns.
 * Converts: bare groups `(...)` and named groups `(?<name>...)`.
 * Preserves: escaped parens `\(...\)`, character class parens `[...]`, already
 * non-capturing `(?:...)`, lookahead `(?=...)` / `(?!...)`, lookbehind
 * `(?<=...)` / `(?<!...)`.
 */
function normalizeConstraint(constraint: string): string {
  let out = ''
  let inClass = false
  let escaped = false
  for (let i = 0; i < constraint.length; i++) {
    const ch = constraint[i]
    if (escaped) {
      out += ch
      escaped = false
      continue
    }
    if (ch === '\\') {
      out += ch
      escaped = true
      continue
    }
    if (ch === '[') {
      inClass = true
      out += ch
      continue
    }
    if (ch === ']' && inClass) {
      inClass = false
      out += ch
      continue
    }
    if (ch === '(' && !inClass) {
      if (constraint[i + 1] !== '?') {
        // bare capturing group → non-capturing
        out += '(?:'
        continue
      }
      // `(?<X` where X is not `=`/`!` is a named capturing group, not a
      // lookbehind — drop the name and make it non-capturing.
      if (
        constraint[i + 2] === '<' &&
        constraint[i + 3] !== '=' &&
        constraint[i + 3] !== '!'
      ) {
        const gt = constraint.indexOf('>', i + 3)
        if (gt >= 0) {
          out += '(?:'
          i = gt
          continue
        }
      }
      // `(?:` / `(?=` / `(?!` / `(?<=` / `(?<!` — already non-capturing
      out += ch
      continue
    }
    out += ch
  }
  return out
}

function findConstraintEnd(pattern: string, start: number): number {
  let depth = 1
  let inClass = false
  let escaped = false

  for (let i = start + 1; i < pattern.length; i++) {
    const ch = pattern[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\') {
      escaped = true
      continue
    }
    if (ch === '[') {
      inClass = true
      continue
    }
    if (ch === ']' && inClass) {
      inClass = false
      continue
    }
    if (inClass) continue
    if (ch === '(') {
      depth++
      continue
    }
    if (ch === ')') {
      depth--
      if (depth === 0) return i
    }
  }

  return -1
}

// Unified tokenizer for URL patterns supporting :name and :name(constraint)
function parsePattern(pattern: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  let staticStart = 0

  while (i < pattern.length) {
    if (pattern[i] === ':') {
      if (staticStart < i) {
        tokens.push({ type: 'static', value: pattern.slice(staticStart, i) })
      }
      // Parse param name
      let j = i + 1
      while (j < pattern.length && /\w/.test(pattern[j])) j++
      const name = pattern.slice(i + 1, j)
      if (!name) {
        throw new Error(`uni-pretty-url: empty param name in pattern "${pattern}"`)
      }
      if (j < pattern.length && pattern[j] === '(') {
        const end = findConstraintEnd(pattern, j)
        if (end < 0) {
          throw new Error(
            `uni-pretty-url: unclosed constraint for param "${name}" in pattern "${pattern}"`,
          )
        }
        tokens.push({ type: 'param', name, constraint: pattern.slice(j + 1, end) })
        i = end + 1
      } else {
        tokens.push({ type: 'param', name })
        i = j
      }
      staticStart = i
    } else {
      i++
    }
  }
  if (staticStart < i) {
    tokens.push({ type: 'static', value: pattern.slice(staticStart, i) })
  }
  return tokens
}

export function compile(pattern: string): CompiledPattern {
  const tokens = parsePattern(pattern)
  const paramNames: string[] = []
  const parts: string[] = []

  for (const token of tokens) {
    if (token.type === 'static') {
      parts.push(escapeRegex(token.value))
    } else {
      paramNames.push(token.name)
      if (token.constraint) {
        parts.push(`(${normalizeConstraint(token.constraint)})`)
      } else {
        parts.push('([^/]+)')
      }
    }
  }
  let regex: RegExp
  try {
    regex = new RegExp(`^${parts.join('')}$`)
  } catch (e) {
    throw new Error(
      `uni-pretty-url: invalid pattern "${pattern}": ${(e as Error).message}`,
    )
  }
  return { regex, paramNames, pattern }
}

export function match(compiled: CompiledPattern, path: string): Record<string, string> | null {
  const m = path.match(compiled.regex)
  if (!m) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < compiled.paramNames.length; i++) {
    params[compiled.paramNames[i]] = safeDecode(m[i + 1])
  }
  return params
}

export function generate(compiled: CompiledPattern, params: Record<string, string>): string {
  const tokens = parsePattern(compiled.pattern)
  const parts: string[] = []

  for (const token of tokens) {
    if (token.type === 'static') {
      parts.push(token.value)
    } else {
      if (!(token.name in params)) {
        throw new Error(
          `uni-pretty-url: missing required param "${token.name}" for pattern "${compiled.pattern}"`,
        )
      }
      parts.push(encodeURIComponent(params[token.name]))
    }
  }
  return parts.join('')
}
