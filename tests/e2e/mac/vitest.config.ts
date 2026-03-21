import path from "node:path";
import dotenv from "dotenv";
import { defineConfig } from "vitest/config";

const projectRoot = path.resolve(import.meta.dirname, "../../..");

// Load .env and .env.local into process.env so global-setup and forked workers can access them
dotenv.config({ path: path.join(projectRoot, ".env") });
dotenv.config({ path: path.join(projectRoot, ".env.test.local"), override: true });

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
