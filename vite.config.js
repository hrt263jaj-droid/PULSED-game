import { defineConfig } from 'vite'

export default defineConfig({
  base: '/PULSED-game/',
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('worker.js')) return 'worker'
        }
      }
    }
  }
})
