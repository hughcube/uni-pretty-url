import type { RouterHistory } from 'vue-router'
import type { PrettyUrlConfig } from '../core/types'
import { toPretty, toReal } from '../core/index'

type HistoryLocation = string

export function createPrettyHistory(
  raw: RouterHistory,
  config: PrettyUrlConfig,
): RouterHistory {
  return {
    get base() {
      return raw.base
    },

    get location() {
      return toReal(raw.location, config)
    },

    get state() {
      return raw.state
    },

    push(to: HistoryLocation, data?: any) {
      raw.push(toPretty(String(to), config), data)
    },

    replace(to: HistoryLocation, data?: any) {
      raw.replace(toPretty(String(to), config), data)
    },

    go(delta: number, triggerListeners?: boolean) {
      raw.go(delta, triggerListeners)
    },

    listen(callback: Parameters<RouterHistory['listen']>[0]): () => void {
      return raw.listen((to, from, info) => {
        callback(toReal(to, config), toReal(from, config), info)
      })
    },

    createHref(location: HistoryLocation): string {
      return raw.createHref(toPretty(location, config))
    },

    destroy() {
      raw.destroy()
    },
  }
}
