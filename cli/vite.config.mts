import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// Bundles the mc CLI (cli/src + the shared helpers it imports) into one Node script: cli/dist/mc.mjs.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  build: {
    ssr: 'src/main.ts',
    outDir: 'dist',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    rollupOptions: {
      output: { format: 'es', entryFileNames: 'mc.mjs', banner: '#!/usr/bin/env node' }
    }
  }
})
