import { describe, it, expect } from 'vitest'
import { compile, match, generate } from '../matcher'

describe('compile', () => {
  it('编译无参数 pattern', () => {
    const c = compile('/topics')
    expect(c.pattern).toBe('/topics')
    expect(c.paramNames).toEqual([])
  })

  it('编译单个命名参数 :name', () => {
    const c = compile('/topics/:id')
    expect(c.paramNames).toEqual(['id'])
    expect(c.regex.source).toContain('([^/]+)')
  })

  it('编译带正则约束的参数 :name(regex)', () => {
    const c = compile('/topics/:id(\\d+)')
    expect(c.paramNames).toEqual(['id'])
    expect(c.regex.source).toContain('(\\d+)')
  })

  it('编译多个参数', () => {
    const c = compile('/:a/:b')
    expect(c.paramNames).toEqual(['a', 'b'])
  })

  it('编译多种参数混合', () => {
    const c = compile('/topics/:id(\\d+)/comments/:cid')
    expect(c.paramNames).toEqual(['id', 'cid'])
  })

  it('生成的正则以 ^ 开头、$ 结尾', () => {
    const c = compile('/topics/:id')
    expect(c.regex.source.startsWith('^')).toBe(true)
    expect(c.regex.source.endsWith('$')).toBe(true)
  })

  it('静态部分中的正则元字符被转义', () => {
    const c = compile('/api/v1.0/test+extra/:id')
    // '.' is a regex wildcard, but should be treated as literal dot
    expect(match(c, '/api/v1.0/test+extra/42')).toEqual({ id: '42' })
    // '.0' should NOT match 'X0' (if '.' was unescaped)
    expect(match(c, '/api/v1X0/test+extra/42')).toBeNull()
    expect(match(c, '/api/v1.0/test+extra/abc')).toEqual({ id: 'abc' })
  })

  it('约束中内嵌的捕获组不破坏多参数索引', () => {
    const c = compile('/date/:date((\\d{4})-(\\d{2})-(\\d{2}))/info/:id(\\d+)')
    const result = match(c, '/date/2024-01-15/info/42')
    expect(result).toEqual({ date: '2024-01-15', id: '42' })
  })
})

describe('match', () => {
  it('精确匹配无参数 pattern', () => {
    const c = compile('/topics')
    expect(match(c, '/topics')).toEqual({})
    expect(match(c, '/topics/')).toBeNull()
    expect(match(c, '/other')).toBeNull()
  })

  it('匹配并提取参数值', () => {
    const c = compile('/topics/:id')
    expect(match(c, '/topics/42')).toEqual({ id: '42' })
    expect(match(c, '/topics/hello-world')).toEqual({ id: 'hello-world' })
  })

  it('正则约束匹配通过', () => {
    const c = compile('/topics/:id(\\d+)')
    expect(match(c, '/topics/42')).toEqual({ id: '42' })
  })

  it('正则约束匹配失败', () => {
    const c = compile('/topics/:id(\\d+)')
    expect(match(c, '/topics/abc')).toBeNull()
  })

  it('匹配多个参数', () => {
    const c = compile('/:a/:b')
    expect(match(c, '/foo/bar')).toEqual({ a: 'foo', b: 'bar' })
  })

  it('部分路径不匹配', () => {
    const c = compile('/topics/:id')
    expect(match(c, '/topics/42/extra')).toBeNull()
  })

  it('路径包含特殊字符', () => {
    const c = compile('/search/:q')
    expect(match(c, '/search/hello%20world')).toEqual({ q: 'hello world' })
  })

  it('空字符串不匹配', () => {
    const c = compile('/topics/:id')
    expect(match(c, '')).toBeNull()
  })

  it('路径参数值含无效百分号编码时不抛异常', () => {
    const c = compile('/search/:q')
    const result = match(c, '/search/%ZZinvalid')
    expect(result).toEqual({ q: '%ZZinvalid' })
  })
})

describe('generate', () => {
  it('替换单个参数', () => {
    const c = compile('/topics/:id')
    expect(generate(c, { id: '42' })).toBe('/topics/42')
  })

  it('替换多个参数', () => {
    const c = compile('/:a/:b')
    expect(generate(c, { a: 'foo', b: 'bar' })).toBe('/foo/bar')
  })

  it('对参数值进行 URL 编码', () => {
    const c = compile('/search/:q')
    expect(generate(c, { q: 'hello world' })).toBe('/search/hello%20world')
  })

  it('对中文参数值编码', () => {
    const c = compile('/search/:q')
    expect(generate(c, { q: '你好' })).toBe('/search/%E4%BD%A0%E5%A5%BD')
  })

  it('空 params 且 pattern 无参数时正常', () => {
    const c = compile('/topics')
    expect(generate(c, {})).toBe('/topics')
  })

  it('缺少必需的参数时 throw', () => {
    const c = compile('/topics/:id')
    expect(() => generate(c, {})).toThrow('missing required param')
  })

  it('缺少多个参数中的某个时 throw', () => {
    const c = compile('/topics/:id/comments/:cid')
    expect(() => generate(c, { id: '42' })).toThrow('missing required param "cid"')
  })

  it('带正则约束的参数替换正确', () => {
    const c = compile('/topics/:id(\\d+)')
    expect(generate(c, { id: '42' })).toBe('/topics/42')
  })

  it('额外参数不影响生成', () => {
    const c = compile('/topics/:id')
    expect(generate(c, { id: '42', extra: 'ignored' })).toBe('/topics/42')
  })

  it('参数名有前缀关系时不冲突', () => {
    const c = compile('/items/:id/:idVersion')
    expect(generate(c, { id: '42', idVersion: 'v2' })).toBe('/items/42/v2')
  })

  it('约束含嵌套括号的 pattern 生成正确 URL', () => {
    const c = compile('/date/:date((\\d{4})-(\\d{2})-(\\d{2}))/info/:id(\\d+)')
    expect(generate(c, { date: '2024-01-15', id: '42' })).toBe(
      '/date/2024-01-15/info/42',
    )
  })

  it('compile 和 generate 对嵌套约束 pattern 可逆', () => {
    const pattern = '/date/:date((\\d{4})-(\\d{2})-(\\d{2}))/info/:id(\\d+)'
    const c = compile(pattern)
    const params = { date: '2024-01-15', id: '42' }
    const generated = generate(c, params)
    expect(match(c, generated)).toEqual(params)
  })

  it('约束中 \\ 转义的反斜杠不影响括号归一化', () => {
    const c = compile('/path/:name(\\\\d+)')
    expect(c.regex.source).toContain('(\\\\d+)')
    expect(match(c, '/path/foo')).toBeNull()
  })

  it('约束中 \\ 转义括号后跟普通括号时不误改', () => {
    const c = compile('/path/:name(\\(escaped\\)(\\d+))')
    const m = match(c, '/path/(escaped)42')
    expect(m).toEqual({ name: '(escaped)42' })
  })
})

describe('normalizeConstraint (via compile)', () => {
  it('字符类里的括号不被归一化', () => {
    const c = compile('/path/:name([()a]+)')
    // [()a]+ should stay as-is because parens inside char class are literals
    expect(c.regex.source).toContain('([()a]+)')
    expect(match(c, '/path/a()a')).toEqual({ name: 'a()a' })
  })

  it('字符类里的右括号不结束约束扫描', () => {
    const c = compile('/path/:name([^)]+)')
    expect(match(c, '/path/abc')).toEqual({ name: 'abc' })
    expect(match(c, '/path/a)c')).toBeNull()
  })

  it('转义右括号不结束约束扫描', () => {
    const c = compile('/path/:name(foo\\)bar)')
    expect(match(c, '/path/foo)bar')).toEqual({ name: 'foo)bar' })
    expect(match(c, '/path/foobar')).toBeNull()
  })

  it('未闭合的正则约束抛出清晰错误', () => {
    expect(() => compile('/path/:name(\\d+')).toThrow('unclosed constraint')
  })

  it('已有的 (?:...) 不被二次包裹', () => {
    const c = compile('/path/:name((?:\\d+))')
    // outer bare group → (?:...), inner (?:\\d+) stays as-is
    expect(match(c, '/path/42')).toEqual({ name: '42' })
  })

  it('混合转义括号和字符类括号', () => {
    const c = compile('/path/:name(\\(x\\)|[()]+)')
    // \(x\) escaped parens + [()]+ char class, outer bare group → (?:...)
    expect(match(c, '/path/(x)')).toEqual({ name: '(x)' })
    expect(match(c, '/path/())')).toEqual({ name: '())' })
  })
})
