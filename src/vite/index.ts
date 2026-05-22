import type { Plugin } from 'vite'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'
import type { PrettyUrlConfig } from '../core/types'

const VIRTUAL_WRAPPER = '\0virtual:uni-pretty-url/vue-router-wrapper'
const VIRTUAL_REAL = '\0virtual:uni-pretty-url/vue-router-real'

const RESOLVED_WRAPPER = 'virtual:uni-pretty-url/vue-router-wrapper'
const RESOLVED_REAL = 'virtual:uni-pretty-url/vue-router-real'

export interface UniPrettyUrlOptions {
  pagesPrefix?: string
  aliases?: {
    real: string
    pretty: string
    params?: Record<string, string>
  }[]
  strip?: {
    excludePrefixes?: string[]
  }
}

function resolveRealVueRouter(root: string): string {
  // Always use pathToFileURL to avoid import.meta CJS build warning
  const base = pathToFileURL(root + '/package.json').href
  const req = createRequire(base)
  try {
    const pkgJsonPath = req.resolve('vue-router/package.json', { paths: [root] })
    // Read the package's own ESM entry instead of hardcoding the dist layout.
    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'))
    const esmEntry =
      typeof pkgJson.module === 'string'
        ? pkgJson.module.replace(/^\.\//, '')
        : 'dist/vue-router.mjs'
    const distEsm = pkgJsonPath.replace(/package\.json$/, esmEntry)
    return pathToFileURL(distEsm).href
  } catch {
    throw new Error(
      'uni-pretty-url: unable to resolve vue-router. Please ensure vue-router is installed in your project.',
    )
  }
}

function generateWrapperModule(config: PrettyUrlConfig): string {
  const serializedConfig = JSON.stringify(config)

  // The RouterHistory adapter lives in @hughcube/uni-pretty-url/runtime
  // (createPrettyHistory) — keep this wrapper a thin shell, single source of truth.
  return `
import * as __RealVueRouter from '${RESOLVED_REAL}'
import { createPrettyHistory } from '@hughcube/uni-pretty-url/runtime'

const __config = ${serializedConfig}

export * from '${RESOLVED_REAL}'

export function createWebHistory(base) {
  return createPrettyHistory(__RealVueRouter.createWebHistory(base), __config)
}

export function createWebHashHistory(base) {
  throw new Error(
    'uni-pretty-url does not support hash mode. Please set h5.router.mode to "history" in manifest.json.'
  )
}
`
}

export function uniPrettyUrl(options: UniPrettyUrlOptions = {}): Plugin {
  let realVueRouterPath: string | null = null

  const config: PrettyUrlConfig = {
    pagesPrefix: options.pagesPrefix || 'pages',
    aliases: (options.aliases || []).map((a) => ({
      real: a.real,
      pretty: a.pretty,
      params: a.params,
    })),
    strip: options.strip,
  }

  return {
    name: 'uni-pretty-url',

    config(userConfig, env) {
      const isH5 = process.env.UNI_PLATFORM === 'h5'
      if (!isH5) return

      return {
        resolve: {
          alias: [
            {
              find: /^vue-router$/,
              replacement: RESOLVED_WRAPPER,
            },
          ],
        },
      }
    },

    configResolved(config) {
      const isH5 = process.env.UNI_PLATFORM === 'h5'
      if (!isH5) return

      realVueRouterPath = resolveRealVueRouter(config.root)
    },

    resolveId(id) {
      if (id === RESOLVED_WRAPPER || id === VIRTUAL_WRAPPER) return VIRTUAL_WRAPPER
      if (id === RESOLVED_REAL || id === VIRTUAL_REAL) return VIRTUAL_REAL
      return null
    },

    load(id) {
      const isH5 = process.env.UNI_PLATFORM === 'h5'
      if (!isH5) return null

      if (id === VIRTUAL_REAL) {
        if (!realVueRouterPath) {
          this.error('uni-pretty-url: real vue-router path not resolved')
          return ''
        }
        return `export * from ${JSON.stringify(realVueRouterPath)}`
      }

      if (id === VIRTUAL_WRAPPER) {
        return generateWrapperModule(config)
      }

      return null
    },
  }
}

export default uniPrettyUrl
