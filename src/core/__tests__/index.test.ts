import { describe, it, expect } from 'vitest'
import { toPretty, toReal, compile, match, generate } from '../index'
import type { PrettyUrlConfig } from '../types'

const defaultConfig: PrettyUrlConfig = {
  pagesPrefix: 'pages',
  aliases: [],
}

function cfg(overrides: Partial<PrettyUrlConfig> = {}): PrettyUrlConfig {
  return {
    pagesPrefix: 'pages',
    aliases: [],
    ...overrides,
  }
}

describe('toPretty', () => {
  // === 基本前缀删除 ===
  describe('默认前缀删除', () => {
    it('删除 /pages/ 前缀', () => {
      expect(toPretty('/pages/course/detail', defaultConfig)).toBe('/course/detail')
    })

    it('保留非 /pages/ 开头的路径', () => {
      expect(toPretty('/other/path', defaultConfig)).toBe('/other/path')
    })

    it('仅匹配完整前缀目录 /pages/', () => {
      expect(toPretty('/pageSomething', defaultConfig)).toBe('/pageSomething')
    })

    it('空 URL 原样返回', () => {
      expect(toPretty('', defaultConfig)).toBe('')
    })

    it('根路径 / 原样返回', () => {
      expect(toPretty('/', defaultConfig)).toBe('/')
    })

    it('自定义前缀', () => {
      const c = cfg({ pagesPrefix: 'pkg' })
      expect(toPretty('/pkg/home', c)).toBe('/home')
    })
  })

  // === query / hash 保持 ===
  describe('query 和 hash 保持', () => {
    it('query 参数原样保留', () => {
      expect(toPretty('/pages/course/detail?id=123', defaultConfig)).toBe('/course/detail?id=123')
    })

    it('hash 原样保留', () => {
      expect(toPretty('/pages/course/detail#section', defaultConfig)).toBe('/course/detail#section')
    })

    it('query + hash 均保留且顺序正确', () => {
      expect(toPretty('/pages/course/detail?id=123#section', defaultConfig)).toBe(
        '/course/detail?id=123#section',
      )
    })

    it('多 query 参数原样保留', () => {
      expect(toPretty('/pages/search?q=hello&page=1', defaultConfig)).toBe('/search?q=hello&page=1')
    })
  })

  // === alias 替换 ===
  describe('alias 路径参数替换', () => {
    const aliasConfig = cfg({
      aliases: [
        {
          real: '/pages/course/detail',
          pretty: '/topics/:id(\\d+)',
          params: { id: 'query.id' },
        },
        {
          real: '/pages/user/profile',
          pretty: '/u/:username',
          params: { username: 'query.name' },
        },
      ],
    })

    it('将 query param 映射到 path param', () => {
      expect(toPretty('/pages/course/detail?id=123', aliasConfig)).toBe('/topics/123')
    })

    it('未消费的 query 参数保留', () => {
      expect(toPretty('/pages/course/detail?id=123&tab=comments', aliasConfig)).toBe(
        '/topics/123?tab=comments',
      )
    })

    it('path 未消费的 query + hash', () => {
      expect(toPretty('/pages/course/detail?id=42#section', aliasConfig)).toBe('/topics/42#section')
    })

    it('第二个 alias 规则正确匹配', () => {
      expect(toPretty('/pages/user/profile?name=alice', aliasConfig)).toBe('/u/alice')
    })

    it('alias 不匹配的回退到前缀删除', () => {
      expect(toPretty('/pages/home', aliasConfig)).toBe('/home')
    })

    it('带 excludePrefixes 时不删除指定前缀', () => {
      const c = cfg({
        strip: { excludePrefixes: ['/special'] },
      })
      expect(toPretty('/pages/special/page', c)).toBe('/pages/special/page')
    })

    it('excludePrefixes 不影响其他路径', () => {
      const c = cfg({
        strip: { excludePrefixes: ['/special'] },
      })
      expect(toPretty('/pages/normal/page', c)).toBe('/normal/page')
    })
  })

  // === 错误路径 ===
  describe('错误路径', () => {
    it('alias 要求的 query param 缺失时 throw', () => {
      const c = cfg({
        aliases: [
          {
            real: '/pages/course/detail',
            pretty: '/topics/:id',
            params: { id: 'query.id' },
          },
        ],
      })
      expect(() => toPretty('/pages/course/detail', c)).toThrow('missing required query param')
    })

    it('alias query param 为数组时 throw', () => {
      const c = cfg({
        aliases: [
          {
            real: '/pages/course/detail',
            pretty: '/topics/:id',
            params: { id: 'query.id' },
          },
        ],
      })
      expect(() => toPretty('/pages/course/detail?id=1&id=2', c)).toThrow('multiple values')
    })

    it('alias 生成结果不满足 pretty regex 时 throw', () => {
      const c = cfg({
        aliases: [
          {
            real: '/pages/course/detail',
            pretty: '/topics/:id(\\d+)',
            params: { id: 'query.id' },
          },
        ],
      })
      expect(() => toPretty('/pages/course/detail?id=abc', c)).toThrow(
        'does not satisfy alias pattern',
      )
    })

    it('pretty pattern 有路径参数但缺少 params 映射时 throw', () => {
      const c = cfg({
        aliases: [
          {
            real: '/pages/course/detail',
            pretty: '/topics/:id',
          },
        ],
      })
      expect(() => toReal('/topics/42', c)).toThrow('missing param source "id"')
    })

    it('params 映射了 pretty pattern 中不存在的参数时 throw', () => {
      const c = cfg({
        aliases: [
          {
            real: '/pages/course/detail',
            pretty: '/topics',
            params: { id: 'query.id' },
          },
        ],
      })
      expect(() => toPretty('/pages/course/detail?id=42', c)).toThrow(
        'does not exist in alias pattern',
      )
    })
  })

  // === 边界情况 ===
  describe('边界情况', () => {
    it('仅 query 无 pathname', () => {
      expect(toPretty('?id=1', defaultConfig)).toBe('?id=1')
    })

    it('仅 hash', () => {
      expect(toPretty('#section', defaultConfig)).toBe('#section')
    })

    it('已经是美化路径的不再处理', () => {
      expect(toPretty('/topics/42', defaultConfig)).toBe('/topics/42')
    })

    it('已是 /pages/ 的路径且无别名匹配，去掉前缀', () => {
      expect(toPretty('/pages/foo', defaultConfig)).toBe('/foo')
    })

    it('URL 编码的参数正确保留', () => {
      expect(toPretty('/pages/search?q=hello%20world', defaultConfig)).toBe(
        '/search?q=hello%20world',
      )
    })
  })
})

describe('toReal', () => {
  // === 基本前缀添加 ===
  describe('默认前缀添加', () => {
    it('给非 /pages/ 路径添加前缀', () => {
      expect(toReal('/course/detail', defaultConfig)).toBe('/pages/course/detail')
    })

    it('已是 /pages/ 开头的路径不加前缀', () => {
      expect(toReal('/pages/course/detail', defaultConfig)).toBe('/pages/course/detail')
    })

    it('根路径 / 保持为 /', () => {
      expect(toReal('/', defaultConfig)).toBe('/')
    })

    it('空 URL 原样返回', () => {
      expect(toReal('', defaultConfig)).toBe('')
    })

    it('自定义前缀', () => {
      const c = cfg({ pagesPrefix: 'pkg' })
      expect(toReal('/home', c)).toBe('/pkg/home')
    })
  })

  // === alias 匹配 ===
  describe('alias 反向匹配', () => {
    const aliasConfig = cfg({
      aliases: [
        {
          real: '/pages/course/detail',
          pretty: '/topics/:id(\\d+)',
          params: { id: 'query.id' },
        },
        {
          real: '/pages/user/profile',
          pretty: '/u/:username',
          params: { username: 'query.name' },
        },
      ],
    })

    it('pretty path 还原为 real path', () => {
      expect(toReal('/topics/42', aliasConfig)).toBe('/pages/course/detail?id=42')
    })

    it('pretty path 带额外 query 参数', () => {
      expect(toReal('/topics/42?tab=comments', aliasConfig)).toBe(
        '/pages/course/detail?id=42&tab=comments',
      )
    })

    it('pretty path 带 hash', () => {
      expect(toReal('/topics/42#section', aliasConfig)).toBe(
        '/pages/course/detail?id=42#section',
      )
    })

    it('第二个 alias', () => {
      expect(toReal('/u/alice', aliasConfig)).toBe('/pages/user/profile?name=alice')
    })

    it('不匹配 alias 则走默认前缀逻辑', () => {
      expect(toReal('/home', aliasConfig)).toBe('/pages/home')
    })

    it('regex 不匹配的 pretty path 走默认逻辑', () => {
      expect(toReal('/topics/abc', aliasConfig)).toBe('/pages/topics/abc')
    })
  })

  // === query / hash 保持 ===
  describe('query 和 hash 保持', () => {
    it('query 参数原样保留', () => {
      expect(toReal('/course/detail?id=123', defaultConfig)).toBe('/pages/course/detail?id=123')
    })

    it('hash 原样保留', () => {
      expect(toReal('/course/detail#section', defaultConfig)).toBe('/pages/course/detail#section')
    })

    it('query + hash 顺序正确', () => {
      expect(toReal('/course/detail?id=123#section', defaultConfig)).toBe(
        '/pages/course/detail?id=123#section',
      )
    })
  })

  // === 边界情况 ===
  describe('边界情况', () => {
    it('非 / 开头的路径原样返回', () => {
      expect(toReal('relative/path', defaultConfig)).toBe('relative/path')
    })

    it('已包含前缀但不完全匹配 /pages/ 结构', () => {
      expect(toReal('/pages', defaultConfig)).toBe('/pages')
    })

    it('仅 query 无 pathname', () => {
      expect(toReal('?id=1', defaultConfig)).toBe('?id=1')
    })

    it('仅 hash', () => {
      expect(toReal('#section', defaultConfig)).toBe('#section')
    })

    it('pagesPrefix 为 undefined 时使用默认值', () => {
      const c = { pagesPrefix: undefined as any, aliases: [] }
      expect(toReal('/foo', c)).toBe('/pages/foo')
    })

    it('toReal pagesPrefix 为空字符串时使用默认值', () => {
      const c = cfg({ pagesPrefix: '' })
      expect(toReal('/home', c)).toBe('/pages/home')
    })

    it('toPretty pagesPrefix 为空字符串时使用默认值', () => {
      const c = cfg({ pagesPrefix: '' })
      expect(toPretty('/pages/home', c)).toBe('/home')
    })

    it('根路径带 hash', () => {
      expect(toReal('/#section', defaultConfig)).toBe('/#section')
    })

    it('根路径带 query', () => {
      expect(toReal('/?tab=home', defaultConfig)).toBe('/?tab=home')
    })

    it('多级路径', () => {
      expect(toReal('/a/b/c', defaultConfig)).toBe('/pages/a/b/c')
    })
  })
})

// === re-export 覆盖 ===
describe('re-exports', () => {
  it('compile 可从 index 导入', () => {
    const c = compile('/test/:id')
    expect(c.paramNames).toEqual(['id'])
  })

  it('match 可从 index 导入', () => {
    const c = compile('/test/:id')
    expect(match(c, '/test/42')).toEqual({ id: '42' })
  })

  it('generate 可从 index 导入', () => {
    const c = compile('/test/:id')
    expect(generate(c, { id: '42' })).toBe('/test/42')
  })
})

// === 多值 query 参数覆盖 ===
describe('多值 query 参数', () => {
  it('toPretty 处理重复 query 参数（3+次）', () => {
    expect(toPretty('/pages/search?id=1&id=2&id=3', defaultConfig)).toBe(
      '/search?id=1&id=2&id=3',
    )
  })

  it('toReal 处理重复 query 参数', () => {
    expect(toReal('/search?id=1&id=2&id=3', defaultConfig)).toBe(
      '/pages/search?id=1&id=2&id=3',
    )
  })

  it('toReal alias 反向匹配时保留多值 query', () => {
    const c = cfg({
      aliases: [
        {
          real: '/pages/course/detail',
          pretty: '/topics/:id(\\d+)',
          params: { id: 'query.id' },
        },
      ],
    })
    expect(toReal('/topics/42?filter=a&filter=b', c)).toBe(
      '/pages/course/detail?id=42&filter=a&filter=b',
    )
  })

  it('空 query 段兼容', () => {
    expect(toPretty('/pages/search?', defaultConfig)).toBe('/search')
  })

  it('toPretty alias 全部 query 被消费时无 ?', () => {
    const c = cfg({
      aliases: [
        {
          real: '/pages/course/detail',
          pretty: '/topics/:id',
          params: { id: 'query.id' },
        },
      ],
    })
    expect(toPretty('/pages/course/detail?id=42', c)).toBe('/topics/42')
  })

  it('toReal alias 无额外 query 无 hash', () => {
    const c = cfg({
      aliases: [
        {
          real: '/pages/course/detail',
          pretty: '/topics/:id(\\d+)',
          params: { id: 'query.id' },
        },
      ],
    })
    expect(toReal('/topics/42', c)).toBe('/pages/course/detail?id=42')
  })

  it('toReal alias 路径参数含 URL 编码时不双重编码', () => {
    const c = cfg({
      aliases: [
        {
          real: '/pages/user/profile',
          pretty: '/u/:username',
          params: { username: 'query.name' },
        },
      ],
    })
    expect(toReal('/u/john%20doe', c)).toBe('/pages/user/profile?name=john%20doe')
  })

  it('toReal alias 路径参数含中文编码时不双重编码', () => {
    const c = cfg({
      aliases: [
        {
          real: '/pages/search',
          pretty: '/s/:q',
          params: { q: 'query.q' },
        },
      ],
    })
    expect(toReal('/s/%E4%BD%A0%E5%A5%BD', c)).toBe('/pages/search?q=%E4%BD%A0%E5%A5%BD')
  })

  it('parseQuery 无效百分号编码不抛异常', () => {
    expect(toPretty('/pages/search?q=%ZZ', defaultConfig)).toBe('/search?q=%ZZ')
  })

  it('toPretty alias 非法 param source 抛异常', () => {
    const c = cfg({
      aliases: [
        {
          real: '/pages/course/detail',
          pretty: '/topics/:id',
          params: { id: 'body.id' },
        },
      ],
    })
    expect(() => toPretty('/pages/course/detail?id=42', c)).toThrow('unsupported param source')
  })

  it('toReal alias 非法 param source 抛异常', () => {
    const c = cfg({
      aliases: [
        {
          real: '/pages/course/detail',
          pretty: '/topics/:id(\\d+)',
          params: { id: 'body.id' },
        },
      ],
    })
    expect(() => toReal('/topics/42', c)).toThrow('unsupported param source')
  })

  it('toReal alias 无 params 字段时正常还原', () => {
    const c = cfg({
      aliases: [
        {
          real: '/pages/index/index',
          pretty: '/',
        },
      ],
    })
    expect(toReal('/', c)).toBe('/pages/index/index')
  })

  it('toReal alias 无 params 带 hash', () => {
    const c = cfg({
      aliases: [
        {
          real: '/pages/about/about',
          pretty: '/about',
        },
      ],
    })
    expect(toReal('/about#section', c)).toBe('/pages/about/about#section')
  })

  it('parseQuery 连续 & 间空值不抛异常 (alias 匹配)', () => {
    const c = cfg({
      aliases: [
        {
          real: '/pages/course/detail',
          pretty: '/topics/:id',
          params: { id: 'query.id' },
        },
      ],
    })
    // double & creates empty split part, parseQuery skips it
    expect(toPretty('/pages/course/detail?id=42&&sort=desc', c)).toBe('/topics/42?sort=desc')
  })

  it('parseQuery 无 = 的裸 key 不抛异常', () => {
    const c = cfg({
      aliases: [
        {
          real: '/pages/course/detail',
          pretty: '/topics/:id',
          params: { id: 'query.id' },
        },
      ],
    })
    // bare key without = is not consumed and should keep its raw query shape
    expect(toPretty('/pages/course/detail?id=42&novalue', c)).toBe('/topics/42?novalue')
  })

  it('toPretty alias 保留未消费 query 的原始编码和值形态', () => {
    const c = cfg({
      aliases: [
        {
          real: '/pages/course/detail',
          pretty: '/topics/:id',
          params: { id: 'query.id' },
        },
      ],
    })
    expect(toPretty('/pages/course/detail?id=42&sig=a+b%2Fc&novalue', c)).toBe(
      '/topics/42?sig=a+b%2Fc&novalue',
    )
  })

  it('toReal alias 保留额外 query 的原始编码和值形态', () => {
    const c = cfg({
      aliases: [
        {
          real: '/pages/course/detail',
          pretty: '/topics/:id',
          params: { id: 'query.id' },
        },
      ],
    })
    expect(toReal('/topics/42?sig=a+b%2Fc&novalue', c)).toBe(
      '/pages/course/detail?id=42&sig=a+b%2Fc&novalue',
    )
  })

  it('toPretty alias 无 params 字段时正常生成', () => {
    const c = cfg({
      aliases: [
        {
          real: '/pages/index/index',
          pretty: '/',
        },
      ],
    })
    expect(toPretty('/pages/index/index', c)).toBe('/')
  })

  it('toPretty alias 无 params 带 hash (qs 为空)', () => {
    const c = cfg({
      aliases: [
        {
          real: '/pages/about/about',
          pretty: '/about',
        },
      ],
    })
    expect(toPretty('/pages/about/about#intro', c)).toBe('/about#intro')
  })

  it('toPretty alias 有 params 带 hash 和未消费 query', () => {
    const c = cfg({
      aliases: [
        {
          real: '/pages/course/detail',
          pretty: '/topics/:id',
          params: { id: 'query.id' },
        },
      ],
    })
    expect(toPretty('/pages/course/detail?id=42&tab=comments#section', c)).toBe(
      '/topics/42?tab=comments#section',
    )
  })

  it('带中文 query key 和 value 的路径', () => {
    expect(toReal('/search?关键词=%E4%BD%A0%E5%A5%BD', defaultConfig)).toBe(
      '/pages/search?关键词=%E4%BD%A0%E5%A5%BD',
    )
  })

  it('带中文 query 参数通过 alias 转换', () => {
    const c = cfg({
      aliases: [
        {
          real: '/pages/user/profile',
          pretty: '/u/:username',
          params: { username: 'query.姓名' },
        },
      ],
    })
    expect(toPretty('/pages/user/profile?姓名=%E5%BC%A0%E4%B8%89', c)).toBe(
      '/u/%E5%BC%A0%E4%B8%89',
    )
  })

  it('带中文 query key 无值 (eqIdx === -1)', () => {
    expect(toReal('/search?中文key', defaultConfig)).toBe('/pages/search?中文key')
  })

  it('toReal alias 无 params 但有额外 query', () => {
    const c = cfg({
      aliases: [
        {
          real: '/pages/index/index',
          pretty: '/',
        },
      ],
    })
    expect(toReal('/?ref=homepage', c)).toBe('/pages/index/index?ref=homepage')
  })
})
