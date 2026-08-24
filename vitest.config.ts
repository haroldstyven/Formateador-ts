import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@dominio": fileURLToPath(new URL("./src/dominio", import.meta.url)),
      "@aplicacion": fileURLToPath(new URL("./src/aplicacion", import.meta.url)),
      "@adaptadores": fileURLToPath(new URL("./src/adaptadores", import.meta.url)),
    },
  },
});
