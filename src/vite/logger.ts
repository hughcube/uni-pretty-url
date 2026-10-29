import path from 'node:path'
import type { GenerateResult, PlaceholderDetail } from './generator'

export interface FormatSummaryOptions {
  outDir: string
  root?: string
  duration?: number
  verbose?: boolean
  maxRoutesPerGroup?: number
  noColor?: boolean
}

function createColors(disabled: boolean) {
  if (disabled) {
    return {
      green: (s: string) => s,
      cyan: (s: string) => s,
      dim: (s: string) => s,
      bold: (s: string) => s,
    }
  }
  return {
    green: (s: string) => `\x1b[32m${s}\x1b[0m`,
    cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
    dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
    bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  }
}

/**
 * 格式化输出静态占位文件生成清单
 */
export function formatPlaceholderSummary(
  result: GenerateResult,
  options: FormatSummaryOptions
): string {
  const isNoColor = options.noColor ?? Boolean(process.env.NO_COLOR)
  const c = createColors(isNoColor)

  const relOutDir = options.root
    ? path.relative(options.root, options.outDir).replace(/\\/g, '/') || '.'
    : options.outDir.replace(/\\/g, '/')

  const durationStr = typeof options.duration === 'number' ? ` (${options.duration}ms)` : ''
  const totalFiles = result.filesGenerated.length

  const header = `${c.green('✓')} ${c.cyan('[uni-pretty-url]')} 静态占位文件生成完成 (共 ${totalFiles} 个文件) ${c.dim(`-> ${relOutDir}${durationStr}`)}`

  if (!result.details || result.details.length === 0) {
    return header
  }

  const lines: string[] = [header]

  const prettyItems = result.details.filter((d) => d.type === 'pretty')
  const rawItems = result.details.filter((d) => d.type === 'raw')
  const extraItems = result.details.filter((d) => d.type === 'extra')

  const totalRoutes = result.details.length
  // 当总路由数较大且未显式指定 verbose 时，限制单组显示数量以防刷屏
  const isVerbose = Boolean(options.verbose)
  const defaultLimit = totalRoutes > 25 ? 10 : 9999
  const limit = options.maxRoutesPerGroup ?? (isVerbose ? 9999 : defaultLimit)

  const renderGroup = (title: string, items: PlaceholderDetail[], hint?: string) => {
    if (items.length === 0) return

    lines.push('')
    const titleLine = hint ? `  ${c.bold(title)} ${c.dim(hint)}` : `  ${c.bold(title)}`
    lines.push(titleLine)

    const displayed = items.slice(0, limit)
    for (const item of displayed) {
      lines.push(`  • ${c.cyan(item.route)}`)
      const fileCount = item.files.length
      for (let i = 0; i < fileCount; i++) {
        const isLast = i === fileCount - 1
        const prefix = isLast ? '    └── ' : '    ├── '
        lines.push(`${c.dim(prefix)}${item.files[i]}`)
      }
    }

    if (items.length > limit) {
      const remaining = items.length - limit
      lines.push(`  ${c.dim(`... 及其他 ${remaining} 个路由 (配置 staticPlaceholders.verbose: true 查看完整清单)`)}`)
    }
  }

  renderGroup('[美化路由占位]', prettyItems)
  renderGroup('[原始路由兜底占位]', rawItems, '(防止静态服务器直访或刷新 404)')
  renderGroup('[自定义配置占位]', extraItems)

  return lines.join('\n')
}
