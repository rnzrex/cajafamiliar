/// <reference path="./src/vite-env.d.ts" />

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "prompt",
      injectRegister: null,
      strategies: "generateSW",
      scope: "/",
      workbox: {
        cleanupOutdatedCaches: true,
        importScripts: ["/push-sw.js", "/pwa-update-migration-sw.js"],
        navigateFallback: "/index.html",
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff,woff2,ttf,eot}"],
        runtimeCaching: [],
      },
      manifest: {
        name: "Caja Familiar",
        short_name: "Caja Familiar",
        description: "Consulta y gestiona las finanzas de tu familia.",
        lang: "es",
        start_url: "/",
        scope: "/",
        display: "standalone",
        theme_color: "#1d4ed8",
        background_color: "#f1f5f9",
        icons: [
          {
            src: "/caja-familiar.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
        ],
      },
    }),
  ],
});
