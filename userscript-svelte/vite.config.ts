import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte()],
  build: {
    target: "es2022",
    sourcemap: false,
    cssCodeSplit: false,
    outDir: "dist",
    emptyOutDir: true,
    lib: {
      entry: "src/entry-userscript.ts",
      name: "RsdhUserscript",
      formats: ["iife"],
      fileName: () => "bundle.js",
    },
    rollupOptions: {
      // Force single-file output
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});


