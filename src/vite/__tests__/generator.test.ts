import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  parseJsonSafe,
  extractPagesFromConfig,
  generatePlaceholders,
} from '../generator'
import type { PrettyUrlConfig } from '../../core/types'

describe('generator - parseJsonSafe', () => {
  it('should parse standard json', () => {
    expect(parseJsonSafe('{"a": 1, "b": "str"}')).toEqual({ a: 1, b: 'str' })
  })

  it('should strip single-line and multi-line comments', () => {
    const raw = `
      {
        // 这是单行注释
        "name": "dictbuddy",
        /* 这是
           多行注释 */
        "port": 3000
      }
    `
    expect(parseJsonSafe(raw)).toEqual({ name: 'dictbuddy', port: 3000 })
  })

  it('should tolerate trailing commas', () => {
    const raw = `
      {
        "pages": [
          "page1",
          "page2",
        ],
      }
    `
    expect(parseJsonSafe(raw)).toEqual({ pages: ['page1', 'page2'] })
  })

  it('should preserve URLs, slashes and commas inside strings', () => {
    const raw = `
      {
        // 注释 1
        "url": "https://example.com/api?a=1//2",
        /* 注释 2 */
        "text": "hello /* not a comment */ world",
        "trailing": "nested, } comma",
        "pages": [
          { "path": "pages/index/index" },
        ],
      }
    `
    expect(parseJsonSafe(raw)).toEqual({
      url: 'https://example.com/api?a=1//2',
      text: 'hello /* not a comment */ world',
      trailing: 'nested, } comma',
      pages: [{ path: 'pages/index/index' }],
    })
  })

  it('should return null on invalid json or non-string input', () => {
    expect(parseJsonSafe('not json')).toBeNull()
    expect(parseJsonSafe(null as any)).toBeNull()
    expect(parseJsonSafe(123 as any)).toBeNull()
  })

  it('should tolerate multiple consecutive trailing commas', () => {
    const raw = `
      {
        "pages": [
          "page1",,,
        ],,
      }
    `
    expect(parseJsonSafe(raw)).toEqual({ pages: ['page1'] })
  })
})

describe('generator - extractPagesFromConfig', () => {
  it('should extract main pages and subpackages', () => {
    const pagesJson = `
      {
        "pages": [
          { "path": "pages/index/index" },
          { "path": "pages/material/index" }
        ],
        "subPackages": [
          {
            "root": "subA",
            "pages": [
              { "path": "detail" }
            ]
          }
        ]
      }
    `
    const extracted = extractPagesFromConfig(pagesJson)
    expect(extracted).toEqual([
      'pages/index/index',
      'pages/material/index',
      'subA/detail',
    ])
  })

  it('should handle malformed or empty config', () => {
    expect(extractPagesFromConfig('')).toEqual([])
    expect(extractPagesFromConfig('{}')).toEqual([])
    expect(extractPagesFromConfig('{"pages": null}')).toEqual([])
    expect(extractPagesFromConfig('{"pages": [{"no_path": 1}], "subPackages": null}')).toEqual([])
    expect(extractPagesFromConfig('{"subPackages": [{"root": "pkg", "pages": null}]}')).toEqual([])
  })
})

describe('generator - generatePlaceholders', () => {
  let tmpDir: string
  let rootDir: string
  let outDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uni-pretty-url-test-'))
    rootDir = path.join(tmpDir, 'project')
    outDir = path.join(rootDir, 'dist/build/h5')

    fs.mkdirSync(path.join(rootDir, 'src'), { recursive: true })
    fs.mkdirSync(outDir, { recursive: true })

    // 创建 index.html
    fs.writeFileSync(path.join(outDir, 'index.html'), '<!DOCTYPE html><html><head></head><body>SPA</body></html>')

    // 创建 pages.json
    const pagesJson = JSON.stringify({
      pages: [
        { path: 'pages/index/index' },
        { path: 'pages/material/index' },
        { path: 'pages/wrong/index' },
      ],
    })
    fs.writeFileSync(path.join(rootDir, 'src/pages.json'), pagesJson)
  })

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {}
  })

  it('should skip if options is false or enabled is false', () => {
    const config: PrettyUrlConfig = { pagesPrefix: 'pages', aliases: [] }
    const r1 = generatePlaceholders({ root: rootDir, outDir, config, options: false })
    expect(r1.filesGenerated).toHaveLength(0)

    const r2 = generatePlaceholders({ root: rootDir, outDir, config, options: { enabled: false } })
    expect(r2.filesGenerated).toHaveLength(0)
  })

  it('should gracefully return success: false when index.html is missing', () => {
    fs.rmSync(path.join(outDir, 'index.html'))
    const config: PrettyUrlConfig = { pagesPrefix: 'pages', aliases: [] }
    const res = generatePlaceholders({ root: rootDir, outDir, config, options: true })
    expect(res.success).toBe(false)
  })

  it('should generate physical placeholders with aliases and .html suffix', () => {
    const config: PrettyUrlConfig = {
      pagesPrefix: 'pages',
      aliases: [
        { real: '/pages/index/index', pretty: '/' },
        { real: '/pages/material/index', pretty: '/material.html' },
      ],
    }

    const res = generatePlaceholders({
      root: rootDir,
      outDir,
      config,
      options: {
        htmlSuffix: true,
        subDirIndex: true,
        cleanUrlNoExt: true,
      },
    })

    expect(res.success).toBe(true)
    expect(res.routesCount).toBeGreaterThan(0)

    // 验证 /material.html 生成了对应的物理文件
    const htmlTarget = path.join(outDir, 'material.html')
    expect(fs.existsSync(htmlTarget)).toBe(true)
    expect(fs.readFileSync(htmlTarget, 'utf8')).toContain('SPA')

    // 验证同时补齐了 material/index.html
    const dirIndexTarget = path.join(outDir, 'material/index.html')
    expect(fs.existsSync(dirIndexTarget)).toBe(true)

    // 验证原始路由 pages/wrong/index.html 也存在兜底
    expect(fs.existsSync(path.join(outDir, 'pages/wrong/index.html'))).toBe(true)
  })

  it('should generate physical placeholders when pretty route has no extension', () => {
    const config: PrettyUrlConfig = {
      pagesPrefix: 'pages',
      aliases: [
        { real: '/pages/wrong/index', pretty: '/wrong' },
      ],
    }

    const res = generatePlaceholders({
      root: rootDir,
      outDir,
      config,
      options: true,
    })

    expect(res.success).toBe(true)
    // 应该同时生成 wrong.html 和 wrong/index.html
    expect(fs.existsSync(path.join(outDir, 'wrong.html'))).toBe(true)
    expect(fs.existsSync(path.join(outDir, 'wrong/index.html'))).toBe(true)
  })

  it('should support root pages.json fallback and extraRoutes', () => {
    // 移除 src/pages.json，移至 project 根目录 pages.json
    fs.rmSync(path.join(rootDir, 'src/pages.json'))
    fs.writeFileSync(path.join(rootDir, 'pages.json'), '{"pages":[{"path":"pages/extra/index"}]}')

    const config: PrettyUrlConfig = {
      pagesPrefix: 'pages',
      aliases: [
        { real: '/pages/index/index', pretty: '/' },
        // 带参数的别名不应直接生成无参数文件
        { real: '/pages/detail', pretty: '/detail/:id' },
      ],
    }

    const res = generatePlaceholders({
      root: rootDir,
      outDir,
      config,
      options: {
        extraRoutes: ['/custom-page', '/'],
      },
    })

    expect(res.success).toBe(true)
    expect(fs.existsSync(path.join(outDir, 'custom-page.html'))).toBe(true)
    expect(fs.existsSync(path.join(outDir, 'pages/extra/index.html'))).toBe(true)
  })

  it('should respect false flags for htmlSuffix, subDirIndex and cleanUrlNoExt', () => {
    const config: PrettyUrlConfig = {
      pagesPrefix: 'pages',
      aliases: [
        { real: '/pages/material/index', pretty: '/material' },
        { real: '/pages/about/index', pretty: '/about.html' },
      ],
    }

    const res = generatePlaceholders({
      root: rootDir,
      outDir,
      config,
      options: {
        htmlSuffix: false,
        subDirIndex: false,
        cleanUrlNoExt: false,
        extraRoutes: ['', '/'],
      },
    })

    expect(res.success).toBe(true)
    // 所有生成 flag 均为 false 时，不生成对应文件
    expect(fs.existsSync(path.join(outDir, 'material.html'))).toBe(false)
    expect(fs.existsSync(path.join(outDir, 'material/index.html'))).toBe(false)
    expect(fs.existsSync(path.join(outDir, 'about/index.html'))).toBe(false)
  })

  it('should generate cleanUrlNoExt file when subDirIndex is false', () => {
    const config: PrettyUrlConfig = {
      pagesPrefix: 'pages',
      aliases: [{ real: '/pages/material/index', pretty: '/standalone' }],
    }
    const res = generatePlaceholders({
      root: rootDir,
      outDir,
      config,
      options: {
        htmlSuffix: false,
        subDirIndex: false,
        cleanUrlNoExt: true,
      },
    })
    expect(res.success).toBe(true)
    const noExtFile = path.join(outDir, 'standalone')
    expect(fs.existsSync(noExtFile)).toBe(true)
    expect(fs.statSync(noExtFile).isFile()).toBe(true)
  })

  it('should cover branch edges: slash-prefixed pages, catch in toPretty, empty clean paths and undefined aliases', () => {
    // 1. 包含以 / 开头的路径，以及引发 toPretty catch 的带参别名
    const pagesJson = JSON.stringify({
      pages: [
        { path: '/pages/leading-slash' },
        { path: 'pages/need-params' },
      ],
    })
    fs.writeFileSync(path.join(rootDir, 'src/pages.json'), pagesJson)

    const config: PrettyUrlConfig = {
      pagesPrefix: 'pages',
      aliases: [
        {
          real: '/pages/need-params',
          pretty: '/param/:id',
          params: { id: 'query.id' },
        },
      ],
    }

    const res = generatePlaceholders({
      root: rootDir,
      outDir,
      config,
      options: {
        extraRoutes: ['///', '/ok'],
      },
    })
    expect(res.success).toBe(true)

    // 2. config.aliases 为空时的分支
    const resNoAliases = generatePlaceholders({
      root: rootDir,
      outDir,
      config: { pagesPrefix: 'pages' } as any,
      options: true,
    })
    expect(resNoAliases.success).toBe(true)
  })

  it('should resolve default outDir when outDir is not provided (h5 candidate vs dist candidate)', () => {
    const config: PrettyUrlConfig = { pagesPrefix: 'pages', aliases: [] }
    // 1. 当 dist/build/h5 存在时
    const res1 = generatePlaceholders({
      root: rootDir,
      config,
      options: true,
    })
    expect(res1.success).toBe(true)

    // 2. 当 dist/build/h5 不存在，但 dist 存在时
    fs.rmSync(path.join(rootDir, 'dist/build/h5'), { recursive: true, force: true })
    fs.mkdirSync(path.join(rootDir, 'dist'), { recursive: true })
    fs.writeFileSync(path.join(rootDir, 'dist/index.html'), '<html></html>')

    const res2 = generatePlaceholders({
      root: rootDir,
      config,
      options: true,
    })
    expect(res2.success).toBe(true)
  })

  it('should resolve relative outDir correctly', () => {
    const config: PrettyUrlConfig = { pagesPrefix: 'pages', aliases: [] }
    const res = generatePlaceholders({
      root: rootDir,
      outDir: 'dist/build/h5',
      config,
      options: true,
    })
    expect(res.success).toBe(true)
  })

  it('should support README standard options: htmlFiles, dirIndexFiles, noExtFiles, pages', () => {
    const config: PrettyUrlConfig = { pagesPrefix: 'pages', aliases: [] }
    const res = generatePlaceholders({
      root: rootDir,
      outDir,
      config,
      options: {
        htmlFiles: true,
        dirIndexFiles: false,
        noExtFiles: true,
        pages: ['/pages/custom/page1', 'pages/custom/page2'],
      },
    })
    expect(res.success).toBe(true)
    // 验证生成了 .html 文件
    expect(fs.existsSync(path.join(outDir, 'pages/custom/page1.html'))).toBe(true)
    // 验证生成了无后缀文件 (因为 dirIndexFiles 为 false)
    expect(fs.existsSync(path.join(outDir, 'pages/custom/page1'))).toBe(true)
    // 验证没有生成 index.html
    expect(fs.existsSync(path.join(outDir, 'pages/custom/page1/index.html'))).toBe(false)
  })

  it('should support process.env.UNI_INPUT_DIR for pages.json discovery', () => {
    const customInput = path.join(tmpDir, 'custom-uni-src')
    fs.mkdirSync(customInput, { recursive: true })
    fs.writeFileSync(path.join(customInput, 'pages.json'), '{"pages":[{"path":"custom-dir/page"}]}')

    // 临时设置 UNI_INPUT_DIR
    const oldInput = process.env.UNI_INPUT_DIR
    process.env.UNI_INPUT_DIR = customInput

    try {
      const config: PrettyUrlConfig = { pagesPrefix: 'pages', aliases: [] }
      const res = generatePlaceholders({
        root: rootDir,
        outDir,
        config,
        options: true,
      })
      expect(res.success).toBe(true)
      expect(fs.existsSync(path.join(outDir, 'custom-dir/page.html'))).toBe(true)
    } finally {
      if (oldInput) {
        process.env.UNI_INPUT_DIR = oldInput
      } else {
        delete process.env.UNI_INPUT_DIR
      }
    }
  })

  it('should support lowercase subpackages in extractPagesFromConfig', () => {
    const pagesJson = JSON.stringify({
      pages: [{ path: 'pages/home/index' }],
      subpackages: [
        {
          root: 'sub-pkg',
          pages: [{ path: 'item/index' }],
        },
      ],
    })
    const pages = extractPagesFromConfig(pagesJson)
    expect(pages).toContain('pages/home/index')
    expect(pages).toContain('sub-pkg/item/index')
  })

  it('should safely ignore dynamic routes, wildcards, traversal and invalid chars without crashing', () => {
    const config: PrettyUrlConfig = {
      pagesPrefix: 'pages',
      aliases: [
        { real: '/pages/detail', pretty: '/detail/:id' },
        { real: '/pages/wild', pretty: '/wild/*' },
      ],
    }
    const res = generatePlaceholders({
      root: rootDir,
      outDir,
      config,
      options: {
        extraRoutes: [
          '/dynamic/:id',
          '/wildcard/*',
          '../../escape-path',
          '/invalid<char>?foo=1',
        ],
      },
    })
    expect(res.success).toBe(true)
    // 不应生成带 :id 或 * 的非法文件
    expect(fs.existsSync(path.join(outDir, 'dynamic/:id.html'))).toBe(false)
    expect(fs.existsSync(path.join(outDir, 'wildcard/*.html'))).toBe(false)
    expect(fs.existsSync(path.join(rootDir, 'escape-path.html'))).toBe(false)
  })

  it('should safely handle directory vs file conflict when both dirIndexFiles and noExtFiles are true', () => {
    const config: PrettyUrlConfig = {
      pagesPrefix: 'pages',
      aliases: [{ real: '/pages/conflict', pretty: '/conflict' }],
    }
    const res = generatePlaceholders({
      root: rootDir,
      outDir,
      config,
      options: {
        dirIndexFiles: true,
        noExtFiles: true,
        htmlFiles: true,
      },
    })
    expect(res.success).toBe(true)
    // 目录 conflict/index.html 应该正常存在
    expect(fs.existsSync(path.join(outDir, 'conflict/index.html'))).toBe(true)
    // conflict 本身应该是一个目录，且未发生异常报错崩溃
    expect(fs.statSync(path.join(outDir, 'conflict')).isDirectory()).toBe(true)
  })

  it('should generate directory index.html for routes ending with /index even when htmlFiles is false', () => {
    const config: PrettyUrlConfig = {
      pagesPrefix: 'pages',
      aliases: [],
    }
    const res = generatePlaceholders({
      root: rootDir,
      outDir,
      config,
      options: {
        htmlFiles: false,
        dirIndexFiles: true,
        pages: ['/pages/material/index'],
      },
    })
    expect(res.success).toBe(true)
    // 应该在 material/ 目录下生成唯一的目录文件 index.html，供 /material/ 目录请求使用
    expect(fs.existsSync(path.join(outDir, 'material/index.html'))).toBe(true)
    // 因为 htmlFiles 为 false，不应该生成 material.html
    expect(fs.existsSync(path.join(outDir, 'material.html'))).toBe(false)
  })

  it('should generate proper directory index.html for directory-style pretty aliases ending with /', () => {
    const config: PrettyUrlConfig = {
      pagesPrefix: 'pages',
      aliases: [{ real: '/pages/catalog/list', pretty: '/catalog/' }],
    }
    const res = generatePlaceholders({
      root: rootDir,
      outDir,
      config,
      options: {
        dirIndexFiles: true,
        htmlFiles: true,
      },
    })
    expect(res.success).toBe(true)
    expect(fs.existsSync(path.join(outDir, 'catalog/index.html'))).toBe(true)
    expect(fs.existsSync(path.join(outDir, 'catalog.html'))).toBe(true)
  })
})
