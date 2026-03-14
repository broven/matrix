import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(__dirname, "..");

const requiredPaths = [
  "src-tauri/Cargo.toml",
  "src-tauri/build.rs",
  "src-tauri/tauri.conf.json",
  "src-tauri/src/main.rs",
  "src-tauri/src/lib.rs",
  "src-tauri/capabilities/default.json",
];

test("client package includes the required Tauri scaffold files", () => {
  for (const relativePath of requiredPaths) {
    assert.equal(
      existsSync(path.join(clientDir, relativePath)),
      true,
      `${relativePath} should exist`,
    );
  }
});

test("tauri config points at the existing Vite frontend", () => {
  const configPath = path.join(clientDir, "src-tauri/tauri.conf.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));

  assert.equal(config.build?.beforeDevCommand, "pnpm dev");
  assert.equal(config.build?.beforeBuildCommand, "pnpm build");
  assert.equal(config.build?.devUrl, "http://localhost:5173");
  assert.equal(config.build?.frontendDist, "../dist");
  assert.equal(config.app?.windows?.[0]?.label, "main");
});
