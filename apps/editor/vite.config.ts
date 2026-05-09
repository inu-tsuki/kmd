import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import fs from 'fs'
import path from 'path'

interface KmdFileEntry {
  label: string
  path: string
  dir: string
}

function kmdFileDiscovery(): Plugin {
  const publicDir = path.resolve(__dirname, 'public')

  function scanKmdFiles(): KmdFileEntry[] {
    const results: KmdFileEntry[] = []

    function walk(dir: string, relativeBase: string) {
      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (entry.isDirectory()) {
          walk(path.join(dir, entry.name), relativeBase + entry.name + '/')
        } else if (entry.name.endsWith('.kmd')) {
          results.push({
            label: entry.name,
            path: '/' + relativeBase + entry.name,
            dir: relativeBase || '/',
          })
        }
      }
    }

    walk(publicDir, '')
    results.sort((a, b) => a.dir.localeCompare(b.dir) || a.label.localeCompare(b.label))
    return results
  }

  return {
    name: 'kmd-file-discovery',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/__api/kmd-files') {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(scanKmdFiles()))
        } else {
          next()
        }
      })
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'kmd-manifest.json',
        source: JSON.stringify(scanKmdFiles()),
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), kmdFileDiscovery()],
  server: {
    fs: {
      allow: [
        __dirname,
        path.resolve(__dirname, '../..'),
      ],
    },
  },
  build: {
    outDir: path.resolve(__dirname, '../../dist'),
    emptyOutDir: true,
  },
})
