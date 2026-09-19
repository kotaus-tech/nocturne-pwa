import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // База Dexie в персонных тестах поднимается поверх fake-indexeddb.
    setupFiles: [],
    restoreMocks: true,
  },
});
