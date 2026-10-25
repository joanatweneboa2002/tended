import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The dev server forwards API calls and uploaded photos to FastAPI,
// so the app can use plain relative URLs like /api/pets.
// TENDED_API overrides the backend address (default http://127.0.0.1:8000).
const api = process.env.TENDED_API ?? 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': api,
      '/photos': api,
    },
  },
})
