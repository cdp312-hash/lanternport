import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" so the built site works from any folder, e.g. GitHub Pages project sites.
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { port: 5174 },
  preview: { port: 4174 },
});
