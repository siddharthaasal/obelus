import { createReadStream, readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, normalize, sep } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Share the repo-root .env with the backend so the proxy follows APP_HOST/APP_PORT.
  const env = loadEnv(mode, '..', 'APP_')
  const backend = `http://${env.APP_HOST || '127.0.0.1'}:${env.APP_PORT || '8420'}`

  return {
    plugins: [react(), pdfjsAssets()],
    envDir: '..',
    server: {
      host: '127.0.0.1',
      proxy: {
        '/api': { target: backend, changeOrigin: true },
      },
    },
  }
})

/**
 * pdf.js loads data files at runtime: CMaps and standard fonts for PDFs that don't embed their
 * fonts, wasm decoders for JPEG 2000 and JBIG2 images (common in scans), and ICC profiles. Serve
 * them at /pdfjs/ from node_modules in dev, and copy them into the build.
 */
function pdfjsAssets(): Plugin {
  const root = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))
  const dirs = ['cmaps', 'standard_fonts', 'wasm', 'iccs']
  // The JavaScript sandbox; scripting stays off.
  const skip = (name: string) => name.startsWith('quickjs')

  return {
    name: 'obelus-pdfjs-assets',
    configureServer(server) {
      server.middlewares.use('/pdfjs/', (req, res, next) => {
        const file = join(root, normalize(decodeURIComponent((req.url ?? '').split('?')[0])))
        const allowed = dirs.some((d) => file.startsWith(join(root, d) + sep))
        if (!allowed || skip(file) || !statSync(file, { throwIfNoEntry: false })?.isFile()) {
          return next()
        }
        if (file.endsWith('.wasm')) res.setHeader('Content-Type', 'application/wasm')
        createReadStream(file).pipe(res)
      })
    },
    generateBundle() {
      for (const dir of dirs) {
        for (const name of readdirSync(join(root, dir)).filter((n) => !skip(n))) {
          const source = readFileSync(join(root, dir, name))
          this.emitFile({ type: 'asset', fileName: `pdfjs/${dir}/${name}`, source })
        }
      }
    },
  }
}
