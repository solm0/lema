import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const frontendPackageJson = JSON.parse(
  readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'),
) as { version?: string }
const electronPackageJson = JSON.parse(
  readFileSync(path.resolve(__dirname, '../electron/package.json'), 'utf-8'),
) as { version?: string }

export default defineConfig(({ command }) => {
  const defaultAppVersion = command === 'serve'
    ? electronPackageJson.version
    : frontendPackageJson.version
  const appVersion = process.env.APP_VERSION_OVERRIDE ?? defaultAppVersion ?? '0.0.0'

  return {
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
    },
    plugins: [
      react(),
      tailwindcss(),
    ],
    server: {
      port: 5173,
      host: true, // 0.0.0.0 바인딩
      proxy: {
        '/api': {
          target: process.env.VITE_LANDING_PROXY_TARGET ?? 'http://localhost:8000',
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: "../frontend/dist",
      emptyOutDir: true,
    },
  }
})
