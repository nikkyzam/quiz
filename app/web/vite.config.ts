import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  /* Assets can be served from a CDN (spec 11.4): build with CDN_BASE set to
     the CDN origin and the shell references hashed assets there. */
  base: process.env.CDN_BASE || "/",
  plugins: [react()],
  server: {
    port: 5180,
    proxy: { "/api": { target: "http://localhost:4000", changeOrigin: true } }
  }
});
