import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The UI is built into dist/ and served by the API server on port 3220.
// `npm run dev` runs Vite on 3221 and proxies /api to the server.
// Views are lazy chunks (see web/src/App.tsx); the libraries get their own long-lived chunks.
export default defineConfig({
  root: "web",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    sourcemap: false,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 30 },
            { name: "charts", test: /node_modules[\\/](recharts|d3-[^\\/]+|victory-vendor|@reduxjs|react-redux|reselect|immer|redux|es-toolkit|decimal\.js-light)[\\/]/, priority: 20 },
            { name: "motion", test: /node_modules[\\/](motion|framer-motion|motion-dom|motion-utils)[\\/]/, priority: 20 },
            { name: "ui", test: /node_modules[\\/](@radix-ui|radix-ui|@floating-ui|lucide-react|clsx|tailwind-merge|class-variance-authority)[\\/]/, priority: 10 },
          ],
        },
      },
    },
  },
  server: {
    port: 3221,
    strictPort: true,
    host: "127.0.0.1",
    proxy: { "/api": { target: "http://127.0.0.1:3220", changeOrigin: false } },
  },
});
