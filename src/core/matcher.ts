export interface CompiledPattern {
  regex: RegExp
  paramNames: string[]
  pattern: string
  segments: PatternSegment[]
}

export type PatternSegment = StaticSegment | ParamSegment
export interface StaticSegment {
  type: 'static'
  value: string
}
export interface ParamSegment {
  type: 'param'
  name: string
  constraint?: string
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function safeDecode(s?: string): string {
  if (s === undefined) return ''
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
function parsePattern(pattern: string): PatternSegment[] {
  const segments: PatternSegment[] = []
  let i = 0
  let staticStart = 0

  while (i < pattern.length) {
    if (pattern[i] === ':') {
      if (staticStart < i) {
        segments.push({ type: 'static', value: pattern.slice(staticStart, i) })
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
        segments.push({ type: 'param', name, constraint: pattern.slice(j + 1, end) })
        i = end + 1
      } else {
        segments.push({ type: 'param', name })
        i = j
      }
      staticStart = i
    } else {
      i++
    }
  }
  if (staticStart < i) {
    segments.push({ type: 'static', value: pattern.slice(staticStart, i) })
  }
  return segments
}

export function compile(pattern: string): CompiledPattern {
  const segments = parsePattern(pattern)
  const paramNames: string[] = []
  const parts: string[] = []

  for (const seg of segments) {
    if (seg.type === 'static') {
      parts.push(escapeRegex(seg.value))
    } else {
      paramNames.push(seg.name)
      if (seg.constraint) {
        parts.push(`(${normalizeConstraint(seg.constraint)})`)
      } else {
        parts.push('([^/]+)')
      }
    }
  }
  let regex: RegExp
  const rawParts = parts.join('')
  const regexStr =
    rawParts === '/'
      ? '^/$'
      : rawParts.endsWith('/')
        ? `^${rawParts.slice(0, -1)}/?$`
        : `^${rawParts}/?$`

  try {
    regex = new RegExp(regexStr)
  } catch (e) {
    throw new Error(
      `uni-pretty-url: invalid pattern "${pattern}": ${(e as Error).message}`,
    )
  }
  return { regex, paramNames, pattern, segments }
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
  const segments = compiled.segments || parsePattern(compiled.pattern)
  const parts: string[] = []

  for (const seg of segments) {
    if (seg.type === 'static') {
      parts.push(seg.value)
    } else {
      if (!(seg.name in params)) {
        throw new Error(
          `uni-pretty-url: missing required param "${seg.name}" for pattern "${compiled.pattern}"`,
        )
      }
      parts.push(encodeURIComponent(params[seg.name]))
    }
  }
  return parts.join('')
}
