import { defineConfig } from 'vite';

// Vite-Konfiguration (Phase 0).
// Der /api-Proxy ist schon vorbereitet, damit das Frontend später das
// FastAPI-Backend unter gleicher Origin erreichen kann (CORS-frei in dev).
export default defineConfig({
  server: {
    port: 5173,
    // host: true -> Vite lauscht auf allen Interfaces (für Tunnel/LAN-Tests).
    host: true,
    // allowedHosts: true -> Vite akzeptiert fremde Host-Header (z.B. die zufällige
    // *.trycloudflare.com / *.ngrok-free.app Tunnel-Domain). NUR Dev-Server, nicht Prod.
    allowedHosts: true,
    proxy: {
      // /api und /auth ans FastAPI-Backend (same-origin -> Session-Cookies fliessen).
      // Ziel 127.0.0.1 (IPv4) statt localhost: unter Windows löst localhost für Node
      // oft auf ::1 auf, uvicorn lauscht aber auf 127.0.0.1 -> sonst Proxy-Fehler.
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/auth': { target: 'http://127.0.0.1:8000', changeOrigin: true },
    },
  },
});
