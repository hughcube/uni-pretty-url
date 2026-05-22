import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { uniPrettyUrl } from '../index'
import { createRequire } from 'node:module'

const originalPlatform = process.env.UNI_PLATFORM

beforeEach(() => {
  delete process.env.UNI_PLATFORM
})

afterEach(() => {
  if (originalPlatform) {
    process.env.UNI_PLATFORM = originalPlatform
  } else {
    delete process.env.UNI_PLATFORM
  }
})

describe('uniPrettyUrl plugin', () => {
  it('返回有效的 Vite Plugin 对象', () => {
    const plugin = uniPrettyUrl()
    expect(plugin.name).toBe('uni-pretty-url')
    expect(typeof plugin.config).toBe('function')
    expect(typeof plugin.configResolved).toBe('function')
    expect(typeof plugin.resolveId).toBe('function')
    expect(typeof plugin.load).toBe('function')
  })

  describe('config hook', () => {
    it('H5 平台返回 alias 配置', () => {
      process.env.UNI_PLATFORM = 'h5'
      const plugin = uniPrettyUrl()
      const result = (plugin as any).config({}, {} as any)
      expect(result).toBeDefined()
      expect(result!.resolve!.alias).toBeDefined()
      const aliasOpt = result!.resolve!.alias![0] as { find: RegExp; replacement: string }
      expect(aliasOpt.find).toBeInstanceOf(RegExp)
      expect(aliasOpt.find.toString()).toContain('vue-router')
      expect(aliasOpt.replacement).toBe('virtual:uni-pretty-url/vue-router-wrapper')
    })

    it('非 H5 平台不返回 alias', () => {
      process.env.UNI_PLATFORM = 'mp-weixin'
      const plugin = uniPrettyUrl()
      const result = (plugin as any).config({}, {} as any)
      expect(result).toBeUndefined()
    })
  })

  describe('resolveId hook', () => {
    it('解析 wrapper virtual module', () => {
      const plugin = uniPrettyUrl()
      expect((plugin as any).resolveId('virtual:uni-pretty-url/vue-router-wrapper', '')).toBe(
        '\0virtual:uni-pretty-url/vue-router-wrapper',
      )
    })

    it('解析 real vue-router virtual module', () => {
      const plugin = uniPrettyUrl()
      expect((plugin as any).resolveId('virtual:uni-pretty-url/vue-router-real', '')).toBe(
        '\0virtual:uni-pretty-url/vue-router-real',
      )
    })

    it('不匹配的 ID 返回 null', () => {
      const plugin = uniPrettyUrl()
      expect((plugin as any).resolveId('vue-router', '')).toBeNull()
    })
  })

  describe('load hook', () => {
    it('非 H5 平台返回 null', () => {
      const plugin = uniPrettyUrl()
      const result = (plugin as any).load('\0virtual:uni-pretty-url/vue-router-wrapper')
      expect(result).toBeNull()
    })

    it('H5 平台 wrapper 模块包含 createWebHistory', () => {
      process.env.UNI_PLATFORM = 'h5'
      const plugin = uniPrettyUrl()

      // Manually set up configResolved to set realVueRouterPath
      // We need to do this because load checks for it (indirectly via generateWrapperModule)
      // Actually, load calls generateWrapperModule which doesn't need realVueRouterPath
      // realVueRouterPath is only used for VIRTUAL_REAL loading
      const result = (plugin as any).load('\0virtual:uni-pretty-url/vue-router-wrapper')
      expect(result).toBeDefined()
      expect(typeof result).toBe('string')
      expect(result).toContain('createWebHistory')
      expect(result).toContain('createPrettyHistory')
    })

    it('H5 平台 wrapper 模块包含 createWebHashHistory 抛错', () => {
      process.env.UNI_PLATFORM = 'h5'
      const plugin = uniPrettyUrl()
      const result = (plugin as any).load('\0virtual:uni-pretty-url/vue-router-wrapper')
      expect(result).toContain('createWebHashHistory')
      expect(result).toContain('does not support hash mode')
    })

    it('H5 平台 real 模块 re-export vue-router', async () => {
      process.env.UNI_PLATFORM = 'h5'
      const plugin: any = uniPrettyUrl()

      // configResolved sets realVueRouterPath
      plugin.configResolved({ root: process.cwd() } as any)

      const result = (plugin as any).load('\0virtual:uni-pretty-url/vue-router-real')
      expect(result).toBeDefined()
      expect(result).toContain('export * from')
      expect(result).toContain('file://')
    })

    it('wrapper 模块嵌入配置 JSON', () => {
      process.env.UNI_PLATFORM = 'h5'
      const plugin = uniPrettyUrl({
        pagesPrefix: 'custom',
        aliases: [
          { real: '/pages/test', pretty: '/test/:id', params: { id: 'query.id' } },
        ],
      })

      const result = (plugin as any).load('\0virtual:uni-pretty-url/vue-router-wrapper')
      expect(result).toContain('"pagesPrefix":"custom"')
      expect(result).toContain('"real":"/pages/test"')
    })

    it('alias 省略 params 时插件正常工作', () => {
      process.env.UNI_PLATFORM = 'h5'
      // 无路径参数的 alias 不应要求 params 字段(类型与运行时都要支持)
      const plugin = uniPrettyUrl({
        aliases: [{ real: '/pages/index/index', pretty: '/' }],
      })
      const result = (plugin as any).load('\0virtual:uni-pretty-url/vue-router-wrapper')
      expect(result).toContain('"real":"/pages/index/index"')
      expect(result).toContain('"pretty":"/"')
    })

    it('wrapper 模块从 uni-pretty-url/runtime 导入', () => {
      process.env.UNI_PLATFORM = 'h5'
      const plugin = uniPrettyUrl()
      const result = (plugin as any).load('\0virtual:uni-pretty-url/vue-router-wrapper')
      expect(result).toContain("from 'uni-pretty-url/runtime'")
    })

    it('不相关的 virtual ID 返回 null', () => {
      process.env.UNI_PLATFORM = 'h5'
      const plugin = uniPrettyUrl()
      expect((plugin as any).load('\0other-module')).toBeNull()
    })
  })

  describe('configResolved hook', () => {
    it('非 H5 平台不设置 realVueRouterPath', () => {
      const plugin: any = uniPrettyUrl()
      // configResolved on non-H5 should return early
      const result = plugin.configResolved({ root: process.cwd() } as any)
      expect(result).toBeUndefined()
    })

    it('H5 平台调用 resolveRealVueRouter 成功', () => {
      process.env.UNI_PLATFORM = 'h5'
      const plugin: any = uniPrettyUrl()
      // should not throw
      plugin.configResolved({ root: process.cwd() } as any)
    })

    it('H5 平台 resolveRealVueRouter 失败时 configResolved 抛错', () => {
      process.env.UNI_PLATFORM = 'h5'
      const plugin: any = uniPrettyUrl()
      // Pass a non-existent root so resolveRealVueRouter throws
      expect(() => {
        plugin.configResolved({ root: '/non/existent/path' } as any)
      }).toThrow()
    })
  })

  describe('load hook 错误路径', () => {
    it('H5 平台 VIRTUAL_REAL 未前置 configResolved 时抛错', () => {
      process.env.UNI_PLATFORM = 'h5'
      const plugin: any = uniPrettyUrl()
      // mock this.error since we don't have full PluginContext
      let errorMsg = ''
      const ctx = { error(msg: string) { errorMsg = msg } }
      const result = plugin.load.call(ctx, '\0virtual:uni-pretty-url/vue-router-real')
      expect(result).toBe('')
      expect(errorMsg).toContain('real vue-router path not resolved')
    })
  })

  describe('选项默认值', () => {
    it('pagesPrefix 默认为 pages', () => {
      process.env.UNI_PLATFORM = 'h5'
      const plugin = uniPrettyUrl()
      const result = (plugin as any).load('\0virtual:uni-pretty-url/vue-router-wrapper')
      // Config JSON is embedded in the wrapper, pagesPrefix should be "pages"
      expect(result).toContain('"pagesPrefix":"pages"')
    })

    it('aliases 默认空数组', () => {
      process.env.UNI_PLATFORM = 'h5'
      const plugin = uniPrettyUrl()
      const result = (plugin as any).load('\0virtual:uni-pretty-url/vue-router-wrapper')
      expect(result).toContain('"aliases":[]')
    })
  })
})
