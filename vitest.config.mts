import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Unit tests for pure logic only (no Electron, no network, no Claude usage).
export default defineConfig({
  resolve: { alias: { '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)) } },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node'
  }
})
