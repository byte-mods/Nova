import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'
import { fileURLToPath, URL } from 'node:url'
import { copyFileSync, mkdirSync } from 'node:fs'

/**
 * The plugin host runs as a forked Node process, so it must reach the output as
 * a real file rather than being bundled into `main.js`. Copying it is simpler
 * than adding a third rollup entry, and keeps it readable on disk — which
 * matters, since it is the file plugin authors debug against.
 */
function copyPluginHost(): Plugin {
  const copy = () => {
    const from = fileURLToPath(new URL('./electron/plugin-host/host.mjs', import.meta.url))
    const toDir = fileURLToPath(new URL('./dist-electron/plugin-host', import.meta.url))
    mkdirSync(toDir, { recursive: true })
    copyFileSync(from, `${toDir}/host.mjs`)
  }
  return {
    name: 'nova:copy-plugin-host',
    buildStart: copy,
    configureServer: copy,
  }
}

/**
 * The review MCP server is spawned by the assistant's CLI, so like the plugin
 * host it has to exist as a real file rather than be bundled into `main.js`.
 */
function copyMcpServers(): Plugin {
  const copy = () => {
    const from = fileURLToPath(new URL('./electron/mcp/nova-review.mjs', import.meta.url))
    const toDir = fileURLToPath(new URL('./dist-electron/mcp', import.meta.url))
    mkdirSync(toDir, { recursive: true })
    copyFileSync(from, `${toDir}/nova-review.mjs`)
  }
  return {
    name: 'nova:copy-mcp-servers',
    buildStart: copy,
    configureServer: copy,
  }
}

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  plugins: [
    react(),
    copyPluginHost(),
    copyMcpServers(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
              // `node-pty` is a native module: it must stay a runtime require,
              // or Rollup inlines the JS and loses the .node binary beside it.
              // `@grpc/grpc-js` and `protobufjs` are pure JS but resolve parts
              // of themselves at runtime, which bundling breaks.
              external: ['electron', 'node-pty', '@grpc/grpc-js', 'protobufjs'],
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
