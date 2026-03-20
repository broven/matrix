import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ["flows/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    globalSetup: ["./global-setup.ts"],
    setupFiles: ["./setup.ts"],
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
