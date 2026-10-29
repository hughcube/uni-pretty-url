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

  it('should return null on invalid json', () => {
    expect(parseJsonSafe('not json')).toBeNull()
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
})
