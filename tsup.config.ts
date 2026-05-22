import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    vite: 'src/vite/index.ts',
    core: 'src/core/index.ts',
    runtime: 'src/runtime/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  external: ['vue-router', 'vite'],
  splitting: false,
})
