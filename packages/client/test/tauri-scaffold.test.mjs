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
  "src-tauri/src/automation/core/mod.rs",
  "src-tauri/src/automation/runtime/mod.rs",
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

  assert.equal(config.build?.beforeBuildCommand, "pnpm build");
  assert.match(config.build?.devUrl, /^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
  assert.equal(config.build?.frontendDist, "../dist");
  assert.equal(config.app?.windows?.[0]?.label, "main");
});

test("client dev scripts load root worktree env before starting vite or tauri", () => {
  const packageJsonPath = path.join(clientDir, "package.json");
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));

  // dev is now managed by wireit; env loading is in wireit config
  assert.equal(pkg.scripts?.dev, "wireit");
  assert.match(pkg.scripts?.["tauri:dev"] ?? "", /\.\.\/\.\.\/\.env\.local/);
});

test("tauri lib wires automation startup hooks in debug builds", () => {
  const libPath = path.join(clientDir, "src-tauri/src/lib.rs");
  const automationModPath = path.join(clientDir, "src-tauri/src/automation/mod.rs");
  const source = readFileSync(libPath, "utf8");
  const automationMod = readFileSync(automationModPath, "utf8");

  assert.match(source, /start_loopback_server\(/);
  assert.match(source, /write_discovery_file\(None\)/);
  assert.match(source, /DesktopWebviewBridge::new/);
  assert.match(source, /TauriEventBridgeTransport::new/);
  assert.doesNotMatch(source, /NoopWebviewEvalBackend/);
  assert.match(automationMod, /^pub mod core;$/m);
  assert.match(automationMod, /^pub mod runtime;$/m);
  assert.doesNotMatch(source, /layout_hint\(/);
});
