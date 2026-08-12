import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
              // `node-pty` is a native module: it must stay a runtime require,
              // or Rollup inlines the JS and loses the .node binary beside it.
              external: ['electron', 'node-pty'],
            },
          },
        },
      },
      preload: {
        input: 'electron/preload.ts',
        vite: {
          build: {
            rollupOptions: {
              // Preload must be CommonJS: sandboxed preloads cannot use ESM.
              output: { format: 'cjs', entryFileNames: 'preload.cjs' },
              external: ['electron'],
            },
          },
        },
      },
    }),
  ],
  build: {
    chunkSizeWarningLimit: 4096,
  },
  server: {
    port: 5179,
    strictPort: true,
  },
})
