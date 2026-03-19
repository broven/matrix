import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ["flows/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 30_000,
    setupFiles: ["./setup.ts"],
    sequence: {
      sequencer: class {
        async shard(files: string[]) {
          return files;
        }
        async sort(files: string[]) {
          // Run tests in filename order (01-, 02-, etc.)
          return files.sort();
        }
      },
    },
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
