import { defineConfig } from 'vitest/config'

// Unit tests for pure logic only (no Electron, no network, no Claude usage).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node'
  }
})
