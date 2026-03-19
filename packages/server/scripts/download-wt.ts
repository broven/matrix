#!/usr/bin/env bun
/**
 * Downloads the Worktrunk (wt) binary for the current platform.
 * Places it at packages/server/bin/wt.
 *
 * Usage: bun run packages/server/scripts/download-wt.ts
 * Override version: WT_VERSION=0.29.4 bun run ...
 */
import { $ } from "bun";
import fs from "node:fs";
import path from "node:path";

const VERSION = process.env.WT_VERSION ?? "0.29.4";

const TARGETS: Record<string, string> = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "linux-x64": "x86_64-unknown-linux-musl",
  "linux-arm64": "aarch64-unknown-linux-musl",
};

const platform = process.platform;
const arch = process.arch;
const key = `${platform}-${arch}`;
const target = TARGETS[key];

if (!target) {
  console.error(`[download-wt] Unsupported platform: ${key}`);
  console.error(`[download-wt] Supported: ${Object.keys(TARGETS).join(", ")}`);
  process.exit(1);
}

const binDir = path.join(import.meta.dir, "../bin");
const binPath = path.join(binDir, "wt");

// Skip if already downloaded
if (fs.existsSync(binPath)) {
  const result = await $`${binPath} --version`.quiet().nothrow();
  const current = result.stderr.toString().trim() || result.stdout.toString().trim();
  if (current.includes(VERSION)) {
    console.log(`[download-wt] wt ${VERSION} already exists at ${binPath}`);
    process.exit(0);
  }
}

const ext = "tar.xz";
const url = `https://github.com/max-sixty/worktrunk/releases/download/v${VERSION}/worktrunk-${target}.${ext}`;

console.log(`[download-wt] Downloading wt v${VERSION} for ${target}...`);
console.log(`[download-wt] URL: ${url}`);

fs.mkdirSync(binDir, { recursive: true });

const tmpDir = fs.mkdtempSync(path.join(binDir, ".download-"));

try {
  const tarball = path.join(tmpDir, `worktrunk.${ext}`);

  // Download
  await $`curl -fsSL -o ${tarball} ${url}`;

  // Extract — worktrunk tarballs contain a directory with the binary inside
  await $`tar -xf ${tarball} -C ${tmpDir}`;

  // Find the wt binary in extracted contents
  const result = await $`find ${tmpDir} -name wt -type f`.quiet();
  const extractedBin = result.stdout.toString().trim().split("\n")[0];

  if (!extractedBin) {
    throw new Error("Could not find 'wt' binary in extracted archive");
  }

  // Move to final location
  fs.copyFileSync(extractedBin, binPath);
  fs.chmodSync(binPath, 0o755);

  // Verify
  const verify = await $`${binPath} --version`.quiet().nothrow();
  const verStr = verify.stderr.toString().trim() || verify.stdout.toString().trim();
  console.log(`[download-wt] Installed: ${verStr}`);
} finally {
  // Cleanup temp dir
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
