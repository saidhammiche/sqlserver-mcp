import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Build → ../public (wird von web-server.js ausgeliefert)
// Entwicklung → "npm run dev", die API läuft weiter auf Port 3000
export default defineConfig({
  plugins: [react()],
  build: { outDir: "../public", emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: { port: 5173, proxy: { "/api": "http://localhost:3000" } }
});
