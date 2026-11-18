import { build } from 'vite'
import react from '@vitejs/plugin-react'
await build({ configFile: false, root: 'scripts/grid-check', base: './', plugins: [react()], build: { outDir: '../../out/grid-check', emptyOutDir: true } })
