import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Redireciona pedidos de /api e /view-pdf para o backend automaticamente
      '/api': 'http://localhost:8000',
      '/view-pdf': 'http://localhost:8000'
    }
  }
})