export interface AliasRule {
  real: string
  pretty: string
  params?: Record<string, string>
}

export interface PrettyUrlConfig {
  pagesPrefix: string
  aliases: AliasRule[]
  strip?: {
    excludePrefixes?: string[]
  }
}
