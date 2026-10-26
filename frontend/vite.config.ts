import { readFileSync } from 'node:fs'
import http from 'node:http'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// The dev server forwards API calls and uploaded photos to FastAPI, so the app
// can use plain relative URLs like /api/pets.
//
// Where the backend is: TENDED_API if set (e.g. http://127.0.0.1:8001), else the
// port the backend wrote to data/backend.port when it started (it moves on to
// 8001, 8002… if 8000 is taken), else 8000. The file is read on every request,
// so a backend that restarts on another port is found without restarting this.
const PORT_FILE = new URL('../data/backend.port', import.meta.url)

function backend(): { host: string; port: number } {
  if (process.env.TENDED_API) {
    const u = new URL(process.env.TENDED_API)
    return { host: u.hostname, port: Number(u.port) || 80 }
  }
  try {
    return { host: '127.0.0.1', port: Number(readFileSync(PORT_FILE, 'utf8').trim()) || 8000 }
  } catch {
    return { host: '127.0.0.1', port: 8000 }
  }
}

function forwardToBackend(): Plugin {
  return {
    name: 'tended-backend',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !/^\/(api|photos)(\/|\?|$)/.test(req.url)) return next()
        const { host, port } = backend()
        const upstream = http.request({ host, port, path: req.url, method: req.method, headers: req.headers }, (r) => {
          res.writeHead(r.statusCode ?? 502, r.headers)
          r.pipe(res)
        })
        upstream.on('error', () => {
          res.statusCode = 502
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ detail: `No backend on port ${port}. Start it with: python -m backend` }))
        })
        req.pipe(upstream)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), forwardToBackend()],
  server: {
    port: 5173, // if it's taken, Vite uses the next free port and prints it
  },
})
