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
  htmlSuffix?: boolean

  /**
   * 是否生成子目录 index.html (如 material/index.html)
   * @default true
   */
  subDirIndex?: boolean

  /**
   * 是否生成同名无扩展名文件 (如 material，部分 CDN/OSS 优先匹配无后缀物理对象)
   * @default true
   */
  cleanUrlNoExt?: boolean

  /**
   * 额外补充的自定义物理占位路径
   */
  extraRoutes?: string[]
}

/**
 * 稳健地剥离 JSON 中的注释与尾随逗号
 */
export function parseJsonSafe(content: string): any {
  try {
    const cleaned = content
      .replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '')
      .replace(/,\s*([\]}])/g, '$1')
    return JSON.parse(cleaned)
  } catch {
    return null
  }
}

/**
 * 从 pages.json 中提取所有页面原始路径
 */
export function extractPagesFromConfig(pagesJsonContent: string): string[] {
  const data = parseJsonSafe(pagesJsonContent)
  if (!data) return []

  const routes: string[] = []

  // 1. 普通 pages
  if (Array.isArray(data.pages)) {
    for (const p of data.pages) {
      if (p && typeof p.path === 'string' && p.path.trim()) {
        routes.push(p.path.trim())
      }
    }
  }

  // 2. 分包 subPackages
  if (Array.isArray(data.subPackages)) {
    for (const sub of data.subPackages) {
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

  const htmlSuffix = opts.htmlSuffix !== false
  const subDirIndex = opts.subDirIndex !== false
  const cleanUrlNoExt = opts.cleanUrlNoExt !== false

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
  const pagesJsonPaths = [
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

  // 自定义补充路径
  if (Array.isArray(opts.extraRoutes)) {
    for (const r of opts.extraRoutes) {
      if (r && r !== '/') targetPrettyPaths.add(r)
    }
  }

  // 4. 为每个路由生成物理文件
  const filesGenerated: string[] = []

  for (const prettyPath of targetPrettyPaths) {
    // 清洗路径：剥离 query 与 hash，剥离首尾斜杠
    const clean = prettyPath.split('?')[0].split('#')[0].replace(/^\/+/, '').replace(/\/+$/, '')
    if (!clean) continue

    if (clean.endsWith('.html')) {
      // 目标本身带 .html (如 material.html)
      const filePath = path.join(outDir, clean)
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      fs.writeFileSync(filePath, indexHtmlContent)
      filesGenerated.push(filePath)

      // 同时补齐目录 index.html (如 material/index.html)
      if (subDirIndex) {
        const stem = clean.slice(0, -5)
        const subIndex = path.join(outDir, stem, 'index.html')
        fs.mkdirSync(path.dirname(subIndex), { recursive: true })
        fs.writeFileSync(subIndex, indexHtmlContent)
        filesGenerated.push(subIndex)
      }
    } else {
      // 目标不带扩展名 (如 material 或 material/index)
      // a) 生成 material.html
      if (htmlSuffix) {
        const htmlFile = path.join(outDir, `${clean}.html`)
        fs.mkdirSync(path.dirname(htmlFile), { recursive: true })
        fs.writeFileSync(htmlFile, indexHtmlContent)
        filesGenerated.push(htmlFile)
      }

      // b) 生成 material/index.html
      if (subDirIndex) {
        const dirIndex = path.join(outDir, clean, 'index.html')
        fs.mkdirSync(path.dirname(dirIndex), { recursive: true })
        fs.writeFileSync(dirIndex, indexHtmlContent)
        filesGenerated.push(dirIndex)
      }

      // c) 生成同名无后缀文件 (如 material)
      if (cleanUrlNoExt) {
        try {
          const noExtFile = path.join(outDir, clean)
          // 若不是目录才写文件
          if (!fs.existsSync(noExtFile) || !fs.statSync(noExtFile).isDirectory()) {
            fs.mkdirSync(path.dirname(noExtFile), { recursive: true })
            fs.writeFileSync(noExtFile, indexHtmlContent)
            filesGenerated.push(noExtFile)
          }
        } catch {}
      }
    }
  }

  return {
    success: true,
    filesGenerated: Array.from(new Set(filesGenerated)),
    routesCount: targetPrettyPaths.size,
  }
}
