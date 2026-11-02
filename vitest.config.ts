import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  resolve: {
    // Order matters: vite matches these as prefixes, longest first.
    alias: [
      { find: '#server-utils', replacement: `${root}layers/base/server/utils` },
      { find: '#server-api', replacement: `${root}layers/base/server/api` },
      { find: '#shared-utils', replacement: `${root}layers/base/shared/utils` },
      { find: '#database', replacement: `${root}server/database` },
      { find: '#server', replacement: `${root}server` },
      {
        find: /^(nuxt\/server|nitro|nitro\/kv|nitro\/task)$/,
        replacement: `${root}test/stubs/server.ts`,
      },
    ],
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
  },
})
