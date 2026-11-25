import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { localizeIndexHtml } from "./src/server/index-html";

// The UI is built into dist/ and served by the API server on port 3220.
// `npm run dev` runs Vite on 3221 and proxies /api to the server.
// Views are lazy chunks (see web/src/App.tsx); the libraries get their own long-lived chunks.
// The dev server speaks the language of APP_LOCALE like the API server does (the build stays German,
// the server swaps the language when it sends index.html).
const devLocale: Plugin = {
  name: "dev-locale",
  apply: "serve",
  transformIndexHtml: (html) => localizeIndexHtml(html, process.env.APP_LOCALE === "en" ? "en" : "de"),
};

export default defineConfig({
  root: "web",
  plugins: [react(), tailwindcss(), devLocale],
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
