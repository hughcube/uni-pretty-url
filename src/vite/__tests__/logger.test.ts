import { describe, it, expect } from 'vitest'
import { formatPlaceholderSummary } from '../logger'
import type { GenerateResult } from '../generator'

describe('logger: formatPlaceholderSummary', () => {
  it('应当在无 details 或 details 为空时仅输出头部', () => {
    const emptyResult: GenerateResult = {
      success: true,
      filesGenerated: [],
      routesCount: 0,
      details: [],
    }

    const output = formatPlaceholderSummary(emptyResult, {
      outDir: '/test/dist/build/h5',
      root: '/test',
      noColor: true,
    })

    expect(output).toContain('[uni-pretty-url] 静态占位文件生成完成 (共 0 个文件)')
    expect(output).toContain('-> dist/build/h5')
  })

  it('在未提供 root 时直接使用 outDir 作为路径展示', () => {
    const result: GenerateResult = {
      success: true,
      filesGenerated: ['/dist/material.html'],
      routesCount: 1,
      details: [],
    }

    const output = formatPlaceholderSummary(result, {
      outDir: 'dist/build/h5',
      duration: 15,
      noColor: true,
    })

    expect(output).toContain('-> dist/build/h5 (15ms)')
  })

  it('应当正确渲染美化路由、原生兜底路由与自定义路由的树状文件层级', () => {
    const result: GenerateResult = {
      success: true,
      filesGenerated: [
        'material.html',
        'material/index.html',
        'pages/material/index.html',
        'extra/about.html',
      ],
      routesCount: 3,
      details: [
        {
          route: '/material',
          type: 'pretty',
          files: ['material.html', 'material/index.html'],
        },
        {
          route: '/pages/material/index',
          type: 'raw',
          files: ['pages/material/index.html'],
        },
        {
          route: '/about',
          type: 'extra',
          files: ['extra/about.html'],
        },
      ],
    }

    const output = formatPlaceholderSummary(result, {
      outDir: '/app/dist/build/h5',
      root: '/app',
      duration: 23,
      noColor: true,
    })

    expect(output).toContain('✓ [uni-pretty-url] 静态占位文件生成完成 (共 4 个文件) -> dist/build/h5 (23ms)')
    expect(output).toContain('[美化路由占位]')
    expect(output).toContain('• /material')
    expect(output).toContain('├── material.html')
    expect(output).toContain('└── material/index.html')

    expect(output).toContain('[原始路由兜底占位] (防止静态服务器直访或刷新 404)')
    expect(output).toContain('• /pages/material/index')
    expect(output).toContain('└── pages/material/index.html')

    expect(output).toContain('[自定义配置占位]')
    expect(output).toContain('• /about')
    expect(output).toContain('└── extra/about.html')
  })

  it('支持 ANSI 彩色高亮输出（当 noColor 为 false 且无 NO_COLOR 环境变量时）', () => {
    const result: GenerateResult = {
      success: true,
      filesGenerated: ['material.html'],
      routesCount: 1,
      details: [
        {
          route: '/material',
          type: 'pretty',
          files: ['material.html'],
        },
      ],
    }

    const output = formatPlaceholderSummary(result, {
      outDir: '/app/dist',
      root: '/app',
      noColor: false,
    })

    // 包含 ANSI 转义序列
    expect(output).toContain('\x1b[32m✓\x1b[0m')
    expect(output).toContain('\x1b[36m[uni-pretty-url]\x1b[0m')
  })

  it('在超出分组阈值且未开启 verbose 时自动折叠并输出提示文案', () => {
    const details = Array.from({ length: 15 }, (_, i) => ({
      route: `/route-${i}`,
      type: 'pretty' as const,
      files: [`route-${i}.html`],
    }))

    const result: GenerateResult = {
      success: true,
      filesGenerated: details.map((d) => d.files[0]),
      routesCount: details.length,
      details,
    }

    const output = formatPlaceholderSummary(result, {
      outDir: '/app/dist',
      root: '/app',
      maxRoutesPerGroup: 5,
      verbose: false,
      noColor: true,
    })

    expect(output).toContain('• /route-0')
    expect(output).toContain('• /route-4')
    expect(output).not.toContain('• /route-5')
    expect(output).toContain('... 及其他 10 个路由 (配置 staticPlaceholders.verbose: true 查看完整清单)')
  })

  it('开启 verbose 时应完整展开所有路由', () => {
    const details = Array.from({ length: 30 }, (_, i) => ({
      route: `/page-${i}`,
      type: 'pretty' as const,
      files: [`page-${i}.html`],
    }))

    const result: GenerateResult = {
      success: true,
      filesGenerated: details.map((d) => d.files[0]),
      routesCount: details.length,
      details,
    }

    const output = formatPlaceholderSummary(result, {
      outDir: '/app/dist',
      root: '/app',
      verbose: true,
      noColor: true,
    })

    expect(output).toContain('• /page-0')
    expect(output).toContain('• /page-29')
    expect(output).not.toContain('查看完整清单')
  })

  it('总路由数 > 25 且未传 maxRoutesPerGroup 时触发默认防刷屏折叠', () => {
    const details = Array.from({ length: 26 }, (_, i) => ({
      route: `/item-${i}`,
      type: 'pretty' as const,
      files: [`item-${i}.html`],
    }))

    const result: GenerateResult = {
      success: true,
      filesGenerated: details.map((d) => d.files[0]),
      routesCount: details.length,
      details,
    }

    const output = formatPlaceholderSummary(result, {
      outDir: '/app/dist',
      root: '/app',
      noColor: true,
    })

    expect(output).toContain('... 及其他 16 个路由 (配置 staticPlaceholders.verbose: true 查看完整清单)')
  })

  it('当 process.env.NO_COLOR 存在时自动禁用彩色', () => {
    const originalNoColor = process.env.NO_COLOR
    process.env.NO_COLOR = '1'
    try {
      const result: GenerateResult = {
        success: true,
        filesGenerated: ['material.html'],
        routesCount: 1,
        details: [
          {
            route: '/material',
            type: 'pretty',
            files: ['material.html'],
          },
        ],
      }
      const output = formatPlaceholderSummary(result, {
        outDir: '/app/dist',
      })
      expect(output).not.toContain('\x1b[')
    } finally {
      if (originalNoColor === undefined) {
        delete process.env.NO_COLOR
      } else {
        process.env.NO_COLOR = originalNoColor
      }
    }
  })
})
