import fs from 'node:fs'
import path from 'node:path'
import type { PrettyUrlConfig } from '../core/types'
import { toPretty } from '../core/index'

export interface StaticPlaceholdersOptions {
  /**
   * 是否启用静态占位生成
   * @default true
   */
  enabled?: boolean

  /**
   * 输出目录（默认自动探测 dist/build/h5 或 dist）
   */
  outDir?: string

  /**
   * 是否生成 .html 后缀文件 (如 material.html)
   * @default true
   */
  htmlFiles?: boolean
  /** @deprecated 请优先使用 htmlFiles */
  htmlSuffix?: boolean

  /**
   * 是否生成子目录/index.html (如 material/index.html)
   * @default true
   */
  dirIndexFiles?: boolean
  /** @deprecated 请优先使用 dirIndexFiles */
  subDirIndex?: boolean

  /**
   * 是否生成同名无扩展名文件 (如 material)
   * 注意：当同时生成子目录/index.html 时，由于文件系统中同名路径无法既是目录又是普通文件，此项会自动规避冲突。
   * @default false
   */
  noExtFiles?: boolean
  /** @deprecated 请优先使用 noExtFiles */
  cleanUrlNoExt?: boolean

  /**
   * 自定义页面路径列表（若提供则作为基础页面路由；未提供则自动从 pages.json 提取）
   */
  pages?: string[]

  /**
   * 额外补充的自定义物理占位路径（向后兼容别名）
   */
  extraRoutes?: string[]
}

/**
 * 稳健地剥离 JSON 中的注释与尾随逗号（保证字符串内部的 URL/注释符号/逗号不受影响）
 */
export function parseJsonSafe(content: string): any {
  if (typeof content !== 'string') return null
  try {
    // 1. 剥离注释：优先保留包含转义字符的双引号字符串，非字符串区域的 // 与 /* */ 注释替换为空格
    const withoutComments = content.replace(
      /("(?:[^"\\]|\\.)*")|(\/\*[\s\S]*?\*\/|\/\/[^\r\n]*)/g,
      (_, str) => (str !== undefined ? str : ' ')
    )
    // 2. 移除尾随逗号：优先保留字符串，非字符串区域的一个或多个尾随逗号替换为闭合括号
    const withoutTrailingCommas = withoutComments.replace(
      /("(?:[^"\\]|\\.)*")|(?:,\s*)+([\]}])/g,
      (_, str, closeBracket) => (str !== undefined ? str : closeBracket)
    )
    return JSON.parse(withoutTrailingCommas)
  } catch {
    return null
  }
}

/**
 * 从 pages.json 中提取所有页面原始路径
 */
export function extractPagesFromConfig(pagesJsonContent: string): string[] {
  const data = parseJsonSafe(pagesJsonContent)
  if (!data || typeof data !== 'object') return []

  const routes: string[] = []

  // 1. 普通 pages
  if (Array.isArray(data.pages)) {
    for (const p of data.pages) {
      if (p && typeof p.path === 'string' && p.path.trim()) {
        routes.push(p.path.trim())
      }
    }
  }

  // 2. 分包 subPackages (同时兼容 subpackages 小写写法)
  const subPackages = data.subPackages || data.subpackages
  if (Array.isArray(subPackages)) {
    for (const sub of subPackages) {
      const root = sub && typeof sub.root === 'string' ? sub.root.trim() : ''
      if (Array.isArray(sub.pages)) {
        for (const p of sub.pages) {
          if (p && typeof p.path === 'string' && p.path.trim()) {
            const full = root ? `${root.replace(/\/+$/, '')}/${p.path.trim().replace(/^\/+/, '')}` : p.path.trim()
            routes.push(full)
          }
        }
      }
    }
  }

  return Array.from(new Set(routes))
}

export interface GeneratePlaceholdersParams {
  root: string
  outDir?: string
  config: PrettyUrlConfig
  options?: boolean | StaticPlaceholdersOptions
}

export interface GenerateResult {
  success: boolean
  filesGenerated: string[]
  routesCount: number
}

/**
 * 执行静态物理路由占位 HTML 生成
 */
export function generatePlaceholders(params: GeneratePlaceholdersParams): GenerateResult {
  const { root, config } = params
  const rawOpts = params.options

  if (rawOpts === false) {
    return { success: true, filesGenerated: [], routesCount: 0 }
  }

  const opts: StaticPlaceholdersOptions = typeof rawOpts === 'object' && rawOpts !== null ? rawOpts : {}
  if (opts.enabled === false) {
    return { success: true, filesGenerated: [], routesCount: 0 }
  }

  // 兼容双套字段命名，默认值与规范统一
  const htmlFiles = opts.htmlFiles ?? opts.htmlSuffix ?? true
  const dirIndexFiles = opts.dirIndexFiles ?? opts.subDirIndex ?? true
  const noExtFiles = opts.noExtFiles ?? opts.cleanUrlNoExt ?? false

  // 1. 确定输出目录 (优先传参 -> dist/build/h5 -> dist)
  let outDir = opts.outDir || params.outDir
  if (!outDir) {
    const candidateH5 = path.join(root, 'dist/build/h5')
    const candidateDist = path.join(root, 'dist')
    outDir = fs.existsSync(candidateH5) ? candidateH5 : candidateDist
  } else if (!path.isAbsolute(outDir)) {
    outDir = path.resolve(root, outDir)
  }

  const indexPath = path.join(outDir, 'index.html')
  if (!fs.existsSync(indexPath)) {
    return { success: false, filesGenerated: [], routesCount: 0 }
  }

  const indexHtmlContent = fs.readFileSync(indexPath, 'utf8')

  // 2. 收集项目所有页面路由
  const pageCandidates: string[] = []

  // 如果显式传入了 pages 列表，优先采纳
  if (Array.isArray(opts.pages) && opts.pages.length > 0) {
    for (const p of opts.pages) {
      if (p && typeof p === 'string' && p.trim()) {
        pageCandidates.push(p.trim())
      }
    }
  } else {
    // 否则从 pages.json 读取 (支持 process.env.UNI_INPUT_DIR)
    const pagesJsonPaths = [
      ...(process.env.UNI_INPUT_DIR ? [path.join(process.env.UNI_INPUT_DIR, 'pages.json')] : []),
      path.join(root, 'src/pages.json'),
      path.join(root, 'pages.json'),
    ]

    for (const p of pagesJsonPaths) {
      if (fs.existsSync(p)) {
        try {
          const content = fs.readFileSync(p, 'utf8')
          pageCandidates.push(...extractPagesFromConfig(content))
          break
        } catch {}
      }
    }
  }

  // 3. 计算每个页面经过 uni-pretty-url 映射后的最终展示路径
  const targetPrettyPaths = new Set<string>()

  for (const pagePath of pageCandidates) {
    const rawPath = pagePath.startsWith('/') ? pagePath : `/${pagePath}`
    try {
      const pretty = toPretty(rawPath, config)
      if (pretty && pretty !== '/') {
        targetPrettyPaths.add(pretty)
      }
    } catch {}

    // 原始路径也保留一份兜底 (例如 /pages/material/index)
    targetPrettyPaths.add(rawPath)
  }

  // 收集配置中已有的静态 alias 路径 (排除含有动态参数 :name 的)
  for (const alias of config.aliases || []) {
    if (alias.pretty && !alias.pretty.includes(':') && alias.pretty !== '/') {
      targetPrettyPaths.add(alias.pretty)
    }
  }

  // 自定义补充路径 (extraRoutes 或 pages)
  const extras = [
    ...(Array.isArray(opts.extraRoutes) ? opts.extraRoutes : []),
    ...(Array.isArray(opts.pages) ? opts.pages : []),
  ]
  for (const r of extras) {
    if (r && typeof r === 'string' && r !== '/') {
      targetPrettyPaths.add(r)
    }
  }

  // 4. 为每个路由安全生成物理文件
  const filesGenerated: string[] = []

  // 辅助安全写文件，带有防目录冲突与异常保护
  const safeWriteFile = (targetFile: string) => {
    try {
      // 若同名文件路径已是目录，则不可写入为文件
      if (fs.existsSync(targetFile) && fs.statSync(targetFile).isDirectory()) {
        return
      }
      fs.mkdirSync(path.dirname(targetFile), { recursive: true })
      fs.writeFileSync(targetFile, indexHtmlContent)
      filesGenerated.push(targetFile)
    } catch {}
  }

  for (const prettyPath of targetPrettyPaths) {
    if (!prettyPath || typeof prettyPath !== 'string') continue

    // 排除包含动态参数 (:name) 或通配符 (*) 的路径
    if (prettyPath.includes(':') || prettyPath.includes('*')) continue

    // 清洗路径：剥离 query 与 hash，剥离首尾斜杠
    const clean = prettyPath.split('?')[0].split('#')[0].replace(/^\/+/, '').replace(/\/+$/, '')
    if (!clean || clean === 'index.html' || clean === '.html') continue

    // 路径遍历防御
    const normalizedClean = path.normalize(clean)
    if (normalizedClean.startsWith('..') || path.isAbsolute(normalizedClean)) {
      continue
    }

    // Windows 平台非法文件名字符跳过 (<>:"|?*)
    if (/[<>:"|?*]/.test(normalizedClean)) {
      continue
    }

    if (clean.endsWith('.html')) {
      // 目标本身带 .html (如 material.html)
      const filePath = path.join(outDir, clean)
      safeWriteFile(filePath)

      // 同时补齐目录 index.html (如 material/index.html)，满足 /material/ 目录请求
      if (dirIndexFiles) {
        const stem = clean.slice(0, -5)
        if (stem && stem !== 'index') {
          const subIndex = path.join(outDir, stem, 'index.html')
          safeWriteFile(subIndex)
        }
      }
    } else if (clean.endsWith('/index')) {
      // 目标以 /index 结尾 (如 material/index 或 pages/material/index)
      // 在 Web 语义中，它的物理归宿正是父级目录下的 index.html (如 material/index.html)
      const parentDir = clean.slice(0, -6)

      // 无论 htmlFiles 还是 dirIndexFiles，只要开启了任一，parentDir/index.html 都是最关键的目录文件占位
      if (htmlFiles || dirIndexFiles) {
        const targetIndexHtml = path.join(outDir, parentDir, 'index.html')
        safeWriteFile(targetIndexHtml)
      }

      // 生成同名无后缀文件 (如 material/index)
      if (noExtFiles) {
        const noExtFile = path.join(outDir, clean)
        safeWriteFile(noExtFile)
      }

      // 额外为 /index/ 目录补齐子目录占位 (如 material/index/index.html)
      if (dirIndexFiles) {
        const subDirIndex = path.join(outDir, clean, 'index.html')
        safeWriteFile(subDirIndex)
      }
    } else {
      // 普通不带扩展名路径 (如 material 或 user/profile)
      // a) 生成 material.html (供文件直接访问)
      if (htmlFiles) {
        const htmlFile = path.join(outDir, `${clean}.html`)
        safeWriteFile(htmlFile)
      }

      // b) 生成 material/index.html (供 /material/ 目录形式访问)
      if (dirIndexFiles) {
        const dirIndex = path.join(outDir, clean, 'index.html')
        safeWriteFile(dirIndex)
      }

      // c) 生成同名无后缀文件 (如 material)
      if (noExtFiles) {
        const noExtFile = path.join(outDir, clean)
        safeWriteFile(noExtFile)
      }
    }
  }

  return {
    success: true,
    filesGenerated: Array.from(new Set(filesGenerated)),
    routesCount: targetPrettyPaths.size,
  }
}
