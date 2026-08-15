import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  server: {
    port: 3001
  },
  build: {
    manifest: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes('/node_modules/react-dom/') ||
            id.includes('/node_modules/react/') ||
            id.includes('/node_modules/scheduler/')
          )
            return 'react-vendor'
          if (
            id.includes('/node_modules/react-router-dom/') ||
            id.includes('/node_modules/react-router/') ||
            id.includes('/node_modules/@remix-run/')
          )
            return 'router'
        }
      }
    },
    sourcemap: false,
    target: 'es2020'
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/test/**',
        'src/**/*.d.ts',
        'src/app/main.tsx',
        'src/**/components/**',
        'src/**/pages/**',
        'src/**/hooks/**',
        'src/**/layer/**',
        'src/**/renderers/**',
        'src/app/**'
      ],
      thresholds: {
        statements: 20,
        branches: 20,
        functions: 20,
        lines: 20
      }
    }
  }
})
