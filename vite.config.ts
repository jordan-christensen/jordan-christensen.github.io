import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 5173, open: true },
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        landing: new URL("index.html", import.meta.url).pathname,
        protoA: new URL("prototypes/a/index.html", import.meta.url).pathname,
        protoB: new URL("prototypes/b/index.html", import.meta.url).pathname,
        protoC: new URL("prototypes/c/index.html", import.meta.url).pathname
      }
    }
  },
  base: "/"
});
