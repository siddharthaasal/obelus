import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Share the repo-root .env with the backend so the proxy follows APP_HOST/APP_PORT.
  const env = loadEnv(mode, '..', 'APP_')
  const backend = `http://${env.APP_HOST || '127.0.0.1'}:${env.APP_PORT || '8420'}`

  return {
    plugins: [react()],
    envDir: '..',
    server: {
      host: '127.0.0.1',
      proxy: {
        '/api': { target: backend, changeOrigin: true },
      },
    },
  }
})
