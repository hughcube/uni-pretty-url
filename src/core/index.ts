import type { AliasRule, PrettyUrlConfig } from './types'
import { compile, generate, match } from './matcher'

export * from './types'
export { compile, match, generate } from './matcher'

function parseUrl(url: string): { pathname: string; query: string; hash: string } {
  const hashIdx = url.indexOf('#')
  const hash = hashIdx >= 0 ? url.slice(hashIdx) : ''
  const noHash = hashIdx >= 0 ? url.slice(0, hashIdx) : url
  const queryIdx = noHash.indexOf('?')
  const pathname = queryIdx >= 0 ? noHash.slice(0, queryIdx) : noHash
  const query = queryIdx >= 0 ? noHash.slice(queryIdx + 1) : ''
  return { pathname, query, hash }
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

interface QueryPart {
  raw: string
  key: string
  value: string
}

function parseQueryParts(qs: string): QueryPart[] {
  if (!qs) return []
  const result: QueryPart[] = []
  for (const raw of qs.split('&')) {
    if (!raw) continue
    const eqIdx = raw.indexOf('=')
    const key = safeDecode(eqIdx >= 0 ? raw.slice(0, eqIdx) : raw)
    const value = eqIdx >= 0 ? safeDecode(raw.slice(eqIdx + 1)) : ''
    result.push({ raw, key, value })
  }
  return result
}

function buildQueryParam(key: string, value: string): string {
  return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
}

function joinQueryParts(generated: string[], rawRemainder: string): string {
  if (generated.length && rawRemainder) return `${generated.join('&')}&${rawRemainder}`
  if (generated.length) return generated.join('&')
  return rawRemainder
}

function omitQueryKeys(parts: QueryPart[], consumedKeys: Set<string>): string {
  return parts
    .filter((part) => !consumedKeys.has(part.key))
    .map((part) => part.raw)
    .join('&')
}

function stripPagesPrefix(pathname: string, prefix: string): string | null {
  const stem = `/${prefix}/`
  if (pathname.startsWith(stem)) {
    return pathname.slice(stem.length - 1)
  }
  return null
}

function resolveAlias(aliases: AliasRule[], pathname: string): AliasRule | null {
  for (const alias of aliases) {
    if (pathname === alias.real) return alias
  }
  return null
}

function resolvePretty(aliases: AliasRule[], pathname: string): {
  alias: AliasRule
  params: Record<string, string>
} | null {
  for (const alias of aliases) {
    const compiled = compile(alias.pretty)
    const params = match(compiled, pathname)
    if (params) return { alias, params }
  }
  return null
}

function extractQueryParam(
  query: QueryPart[],
  paramName: string,
): { value: string } | { error: string } {
  const matches = query.filter((part) => part.key === paramName)
  if (matches.length === 0) {
    return { error: `missing required query param "${paramName}"` }
  }
  if (matches.length > 1) {
    return { error: `query param "${paramName}" has multiple values, expected single value` }
  }
  return { value: matches[0].value }
}

function getAliasParamSources(alias: AliasRule, paramNames: string[]): Record<string, string> {
  const sources = alias.params || {}
  const expected = new Set(paramNames)

  for (const paramName of paramNames) {
    if (!(paramName in sources)) {
      throw new Error(
        `uni-pretty-url: missing param source "${paramName}" for alias "${alias.pretty}" (real: "${alias.real}")`,
      )
    }
  }

  for (const paramName of Object.keys(sources)) {
    if (!expected.has(paramName)) {
      throw new Error(
        `uni-pretty-url: param source "${paramName}" does not exist in alias pattern "${alias.pretty}" (real: "${alias.real}")`,
      )
    }
  }

  return sources
}

export function toPretty(rawUrl: string, config: PrettyUrlConfig): string {
  if (!rawUrl) return rawUrl
  const { pathname, query, hash } = parseUrl(rawUrl)
  const q = parseQueryParts(query)

  const alias = resolveAlias(config.aliases, pathname)
  if (alias) {
    const pathParams: Record<string, string> = {}
    const consumedKeys = new Set<string>()
    const compiled = compile(alias.pretty)
    const paramSources = getAliasParamSources(alias, compiled.paramNames)

    for (const [paramName, source] of Object.entries(paramSources)) {
      if (!source.startsWith('query.')) {
        throw new Error(
          `uni-pretty-url: unsupported param source "${source}" in alias "${alias.pretty}". Only "query.*" is supported.`,
        )
      }
      const queryKey = source.slice(6)
      const result = extractQueryParam(q, queryKey)
      if ('error' in result) {
        throw new Error(
          `uni-pretty-url: ${result.error} for alias "${alias.pretty}" (real: "${alias.real}")`,
        )
      }
      pathParams[paramName] = result.value
      consumedKeys.add(queryKey)
    }

    const prettyPath = generate(compiled, pathParams)
    if (!match(compiled, prettyPath)) {
      throw new Error(
        `uni-pretty-url: generated pretty path "${prettyPath}" does not satisfy alias pattern "${alias.pretty}" (real: "${alias.real}")`,
      )
    }
    const qs = omitQueryKeys(q, consumedKeys)
    if (hash) return `${prettyPath}${qs ? '?' + qs : ''}${hash}`
    return `${prettyPath}${qs ? '?' + qs : ''}`
  }

  const prefix = config.pagesPrefix || 'pages'

  const stripped = stripPagesPrefix(pathname, prefix)
  if (stripped !== null) {
    const excludePrefixes = config.strip?.excludePrefixes ?? []
    for (const ep of excludePrefixes) {
      if (stripped.startsWith(ep)) return rawUrl
    }
    if (hash) return `${stripped}${query ? '?' + query : ''}${hash}`
    if (query) return `${stripped}?${query}`
    return stripped
  }

  return rawUrl
}

export function toReal(prettyUrl: string, config: PrettyUrlConfig): string {
  if (!prettyUrl) return prettyUrl
  const { pathname, query, hash } = parseUrl(prettyUrl)
  const q = parseQueryParts(query)

  const resolved = resolvePretty(config.aliases, pathname)
  if (resolved) {
    const generatedQuery: string[] = []
    const consumedKeys = new Set<string>()
    const compiled = compile(resolved.alias.pretty)
    const paramSources = getAliasParamSources(resolved.alias, compiled.paramNames)

    for (const [paramName, source] of Object.entries(paramSources)) {
      if (!source.startsWith('query.')) {
        throw new Error(
          `uni-pretty-url: unsupported param source "${source}" in alias "${resolved.alias.pretty}". Only "query.*" is supported.`,
        )
      }
      const queryKey = source.slice(6)
      const value = resolved.params[paramName]
      if (value === undefined) {
        throw new Error(
          `uni-pretty-url: missing path param "${paramName}" for alias "${resolved.alias.pretty}" (real: "${resolved.alias.real}")`,
        )
      }
      generatedQuery.push(buildQueryParam(queryKey, value))
      consumedKeys.add(queryKey)
    }

    const qs = joinQueryParts(generatedQuery, omitQueryKeys(q, consumedKeys))
    if (hash) return `${resolved.alias.real}${qs ? '?' + qs : ''}${hash}`
    return `${resolved.alias.real}${qs ? '?' + qs : ''}`
  }

  const prefix = config.pagesPrefix || 'pages'
  if (!pathname.startsWith('/')) return prettyUrl

  if (pathname.startsWith(`/${prefix}/`) || pathname === `/${prefix}`) return prettyUrl

  if (pathname === '/') {
    return prettyUrl
  }

  const realPath = `/${prefix}${pathname}`
  if (hash) return `${realPath}${query ? '?' + query : ''}${hash}`
  if (query) return `${realPath}?${query}`
  return realPath
}
