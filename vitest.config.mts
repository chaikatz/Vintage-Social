import { defineConfig } from "vitest/config";
import path from "node:path";

// Unit tests cover the pure logic (filter math, validation, time formatting).
// Component/native behavior is exercised in the running app, not here.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
