import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: { exclude: ["@electric-sql/pglite"] },
  worker: { format: "es" },
  server: { port: 5430, strictPort: true },
  preview: { port: 4173, strictPort: true },
});
