import { defineConfig } from 'vite';

// Vite-Konfiguration (Phase 0).
// Der /api-Proxy ist schon vorbereitet, damit das Frontend später das
// FastAPI-Backend unter gleicher Origin erreichen kann (CORS-frei in dev).
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
});
