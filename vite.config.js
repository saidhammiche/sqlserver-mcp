import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Construit l'interface dans le dossier « dist » (servi par server.js)
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 3000 },
  server: { port: 5173, proxy: { "/api": "http://localhost:3000" } }
});
