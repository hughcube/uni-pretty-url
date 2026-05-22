import { describe, it, expect, vi } from 'vitest'
import type { RouterHistory } from 'vue-router'
import { createPrettyHistory } from '../index'
import type { PrettyUrlConfig } from '../../core/types'

type HistoryLocation = string

function createMockHistory(baseValue = '/'): RouterHistory {
  let currentLocation = '/pages/home'
  const listeners: Array<(to: string, from: string, info: any) => void> = []

  return {
    base: baseValue,
    get location() {
      return currentLocation
    },
    set location(v) {
      currentLocation = v
    },
    state: { back: null, current: null, forward: null, position: 0, replaced: false, scroll: null },

    push(to: HistoryLocation, data?: any) {
      currentLocation = to
    },

    replace(to: HistoryLocation, data?: any) {
      currentLocation = to
    },

    go(delta: number, triggerListeners?: boolean) {
      // no-op for tests
    },

    listen(callback: (to: string, from: string, info: any) => void) {
      listeners.push(callback)
      return () => {
        const idx = listeners.indexOf(callback)
        if (idx >= 0) listeners.splice(idx, 1)
      }
    },

    createHref(location: HistoryLocation) {
      return location
    },

    destroy() {
      listeners.length = 0
    },
  }
}

const defaultConfig: PrettyUrlConfig = {
  pagesPrefix: 'pages',
  aliases: [],
}

describe('createPrettyHistory', () => {
  it('base 原样透传', () => {
    const raw = createMockHistory('/app')
    const pretty = createPrettyHistory(raw, defaultConfig)
    expect(pretty.base).toBe('/app')
  })

  it('location 翻译 pretty → real', () => {
    const raw = createMockHistory()
    ;(raw as any).location ='/home'
    const pretty = createPrettyHistory(raw, defaultConfig)
    expect(pretty.location).toBe('/pages/home')
  })

  it('location 已是 /pages/ 路径不加前缀', () => {
    const raw = createMockHistory()
    ;(raw as any).location ='/pages/course/detail'
    const pretty = createPrettyHistory(raw, defaultConfig)
    expect(pretty.location).toBe('/pages/course/detail')
  })

  it('state 原样透传', () => {
    const raw = createMockHistory()
    const pretty = createPrettyHistory(raw, defaultConfig)
    expect(pretty.state).toBe(raw.state)
  })

  it('push 翻译 real → pretty', () => {
    const raw = createMockHistory()
    const pretty = createPrettyHistory(raw, defaultConfig)
    pretty.push('/pages/course/detail?id=123')
    expect(raw.location).toBe('/course/detail?id=123')
  })

  it('push with alias', () => {
    const raw = createMockHistory()
    const c: PrettyUrlConfig = {
      pagesPrefix: 'pages',
      aliases: [
        {
          real: '/pages/course/detail',
          pretty: '/topics/:id(\\d+)',
          params: { id: 'query.id' },
        },
      ],
    }
    const pretty = createPrettyHistory(raw, c)
    pretty.push('/pages/course/detail?id=42')
    expect(raw.location).toBe('/topics/42')
  })

  it('replace 翻译 real → pretty', () => {
    const raw = createMockHistory()
    const pretty = createPrettyHistory(raw, defaultConfig)
    pretty.replace('/pages/login')
    expect(raw.location).toBe('/login')
  })

  it('go 原样透传', () => {
    const raw = createMockHistory()
    const goSpy = vi.spyOn(raw, 'go')
    const pretty = createPrettyHistory(raw, defaultConfig)
    pretty.go(-1, true)
    expect(goSpy).toHaveBeenCalledWith(-1, true)
  })

  it('listen 回调中的 to/from 被翻译为 real', () => {
    const raw = createMockHistory()
    // Get access to the stored listeners array
    const listeners: Array<(to: string, from: string, info: any) => void> = []
    const origListen = raw.listen.bind(raw)
    vi.spyOn(raw, 'listen').mockImplementation((cb) => {
      listeners.push(cb)
      return () => {
        const idx = listeners.indexOf(cb)
        if (idx >= 0) listeners.splice(idx, 1)
      }
    })

    const pretty = createPrettyHistory(raw, defaultConfig)

    let capturedTo = ''
    let capturedFrom = ''
    pretty.listen((to, from) => {
      capturedTo = to
      capturedFrom = from
    })

    // The pretty.listen wraps our callback and passes it to raw.listen
    // The raw.listen mock stored the wrapped callback in listeners[0]
    // Trigger the wrapped callback with pretty URLs
    expect(listeners.length).toBe(1)
    listeners[0]('/home', '/old', {})

    // The callback should receive translated (real) URLs
    expect(capturedTo).toBe('/pages/home')
    expect(capturedFrom).toBe('/pages/old')
  })

  it('createHref 翻译为 pretty', () => {
    const raw = createMockHistory()
    const pretty = createPrettyHistory(raw, defaultConfig)
    const href = pretty.createHref('/pages/course/detail')
    expect(href).toBe('/course/detail')
  })

  it('createHref with alias', () => {
    const raw = createMockHistory()
    const c: PrettyUrlConfig = {
      pagesPrefix: 'pages',
      aliases: [
        {
          real: '/pages/course/detail',
          pretty: '/topics/:id',
          params: { id: 'query.id' },
        },
      ],
    }
    const pretty = createPrettyHistory(raw, c)
    const href = pretty.createHref('/pages/course/detail?id=42')
    expect(href).toBe('/topics/42')
  })

  it('destroy 原样透传', () => {
    const raw = createMockHistory()
    const destroySpy = vi.spyOn(raw, 'destroy')
    const pretty = createPrettyHistory(raw, defaultConfig)
    pretty.destroy()
    expect(destroySpy).toHaveBeenCalled()
  })

  it('listen 支持多次调用', () => {
    const raw = createMockHistory()
    const pretty = createPrettyHistory(raw, defaultConfig)

    const cb1 = vi.fn()
    const cb2 = vi.fn()
    const unlisten1 = pretty.listen(cb1)
    const unlisten2 = pretty.listen(cb2)

    expect(unlisten1).toBeInstanceOf(Function)
    expect(unlisten2).toBeInstanceOf(Function)
  })
})
