import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiProxy = {
  "/api": { target: "http://backend:8000", changeOrigin: true },
  "/health": { target: "http://backend:8000", changeOrigin: true },
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  preview: {
    port: 5173,
    host: true,
    allowedHosts: true,
    proxy: apiProxy,
  },
});
