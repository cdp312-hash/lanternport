import { defineConfig } from "vitest/config";

// The game's tests only. The API's tests (worker/) run inside the Workers runtime with their own config.
export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
});
