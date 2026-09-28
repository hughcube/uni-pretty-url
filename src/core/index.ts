import type { AliasRule, PrettyUrlConfig } from './types'
import type { CompiledPattern } from './matcher'
import { compile, generate, match, safeDecode } from './matcher'

export * from './types'
export { compile, match, generate } from './matcher'

// compile() builds a RegExp on every call; cache by pattern string so the
// per-navigation hot path (toPretty/toReal) does not recompile each alias.
const compileCache = new Map<string, CompiledPattern>()

function compileCached(pattern: string): CompiledPattern {
  let compiled = compileCache.get(pattern)
  if (!compiled) {
    compiled = compile(pattern)
    compileCache.set(pattern, compiled)
  }
  return compiled
}

function parseUrl(url: string): { pathname: string; query: string; hash: string } {
  const hashIdx = url.indexOf('#')
  const hash = hashIdx >= 0 ? url.slice(hashIdx) : ''
  const noHash = hashIdx >= 0 ? url.slice(0, hashIdx) : url
  const queryIdx = noHash.indexOf('?')
  const pathname = queryIdx >= 0 ? noHash.slice(0, queryIdx) : noHash
  const query = queryIdx >= 0 ? noHash.slice(queryIdx + 1) : ''
  return { pathname, query, hash }
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

function normalizePath(path: string): string {
  if (path.length > 1 && path.endsWith('/')) {
    return path.slice(0, -1)
  }
  return path
}

function normalizeExcludePrefix(prefix: string): string {
  return prefix.startsWith('/') ? prefix : `/${prefix}`
}

function stripPagesPrefix(pathname: string, prefix: string): string | null {
  const normPath = normalizePath(pathname)
  const stem = `/${prefix}/`
  if (normPath.startsWith(stem)) {
    return normalizePath(normPath.slice(stem.length - 1))
  }
  if (normPath === `/${prefix}`) {
    return '/'
  }
  return null
}

function findMatchingAliases(aliases: AliasRule[], pathname: string): AliasRule[] {
  const normPath = normalizePath(pathname)
  return aliases.filter((a) => a.real === pathname || normalizePath(a.real) === normPath)
}

function resolvePretty(aliases: AliasRule[], pathname: string): {
  alias: AliasRule
  params: Record<string, string>
} | null {
  const normPath = normalizePath(pathname)
  for (const alias of aliases) {
    const compiled = compileCached(alias.pretty)
    const params = match(compiled, pathname) || match(compiled, normPath)
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

  const matchingAliases = findMatchingAliases(config.aliases, pathname)
  if (matchingAliases.length > 0) {
    let selectedAlias: AliasRule | null = null
    let selectedParamSources: Record<string, string> = {}
    let selectedCompiled: CompiledPattern | null = null
    let firstError: Error | null = null

    for (const alias of matchingAliases) {
      try {
        const compiled = compileCached(alias.pretty)
        const paramSources = getAliasParamSources(alias, compiled.paramNames)
        let canSatisfy = true
        for (const [_, source] of Object.entries(paramSources)) {
          if (!source.startsWith('query.')) {
            throw new Error(
              `uni-pretty-url: unsupported param source "${source}" in alias "${alias.pretty}". Only "query.*" is supported.`,
            )
          }
          const queryKey = source.slice(6)
          const result = extractQueryParam(q, queryKey)
          if ('error' in result) {
            canSatisfy = false
            break
          }
        }
        if (canSatisfy) {
          selectedAlias = alias
          selectedParamSources = paramSources
          selectedCompiled = compiled
          break
        }
      } catch (e) {
        if (!firstError) firstError = e as Error
      }
    }

    if (!selectedAlias) {
      if (firstError) {
        throw firstError
      }
      const fallbackAlias = matchingAliases[0]
      const fallbackCompiled = compileCached(fallbackAlias.pretty)
      const fallbackSources = getAliasParamSources(fallbackAlias, fallbackCompiled.paramNames)
      for (const [_, source] of Object.entries(fallbackSources)) {
        const queryKey = source.slice(6)
        const result = extractQueryParam(q, queryKey)
        if ('error' in result) {
          throw new Error(
            `uni-pretty-url: ${result.error} for alias "${fallbackAlias.pretty}" (real: "${fallbackAlias.real}")`,
          )
        }
      }
    }

    if (selectedAlias && selectedCompiled) {
      const pathParams: Record<string, string> = {}
      const consumedKeys = new Set<string>()
      for (const [paramName, source] of Object.entries(selectedParamSources)) {
        const queryKey = source.slice(6)
        const result = extractQueryParam(q, queryKey)
        if ('value' in result) {
          pathParams[paramName] = result.value
          consumedKeys.add(queryKey)
        }
      }

      const prettyPath = generate(selectedCompiled, pathParams)
      if (!match(selectedCompiled, prettyPath)) {
        throw new Error(
          `uni-pretty-url: generated pretty path "${prettyPath}" does not satisfy alias pattern "${selectedAlias.pretty}" (real: "${selectedAlias.real}")`,
        )
      }
      const qs = omitQueryKeys(q, consumedKeys)
      if (hash) return `${prettyPath}${qs ? '?' + qs : ''}${hash}`
      return `${prettyPath}${qs ? '?' + qs : ''}`
    }
  }

  const prefix = config.pagesPrefix || 'pages'

  const stripped = stripPagesPrefix(pathname, prefix)
  if (stripped !== null) {
    const excludePrefixes = (config.strip?.excludePrefixes ?? []).map(normalizeExcludePrefix)
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
    const compiled = compileCached(resolved.alias.pretty)
    const paramSources = getAliasParamSources(resolved.alias, compiled.paramNames)

    for (const [paramName, source] of Object.entries(paramSources)) {
      if (!source.startsWith('query.')) {
        throw new Error(
          `uni-pretty-url: unsupported param source "${source}" in alias "${resolved.alias.pretty}". Only "query.*" is supported.`,
        )
      }
      const queryKey = source.slice(6)
      const value = resolved.params[paramName]
      if (value === undefined || value === '') {
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

  const normPath = normalizePath(pathname)

  if (normPath.startsWith(`/${prefix}/`) || normPath === `/${prefix}`) return prettyUrl

  if (normPath === '/') {
    if (config.homeRoute) {
      const home = config.homeRoute.startsWith('/') ? config.homeRoute : `/${config.homeRoute}`
      if (hash) return `${home}${query ? '?' + query : ''}${hash}`
      if (query) return `${home}?${query}`
      return home
    }
    return prettyUrl
  }

  const excludePrefixes = (config.strip?.excludePrefixes ?? []).map(normalizeExcludePrefix)
  for (const ep of excludePrefixes) {
    if (normPath.startsWith(ep)) {
      return prettyUrl
    }
  }

  const realPath = `/${prefix}${normPath}`
  if (hash) return `${realPath}${query ? '?' + query : ''}${hash}`
  if (query) return `${realPath}?${query}`
  return realPath
}
