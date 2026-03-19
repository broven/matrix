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
import os from "node:os";
import path from "node:path";

const VERSION = process.env.WT_VERSION ?? "0.29.4";

// Windows omitted: wt archive uses .zip (different extraction), and Matrix server
// targets macOS (Tauri sidecar) and Linux (Docker/tarball) only.
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

// Skip if already downloaded with matching version
if (fs.existsSync(binPath)) {
  const result = await $`${binPath} --version`.quiet().nothrow();
  const current = result.stderr.toString().trim() || result.stdout.toString().trim();
  if (current.includes(VERSION)) {
    console.log(`[download-wt] wt ${VERSION} already exists at ${binPath}`);
    process.exit(0);
  }
}

const url = `https://github.com/max-sixty/worktrunk/releases/download/v${VERSION}/worktrunk-${target}.tar.xz`;

console.log(`[download-wt] Downloading wt v${VERSION} for ${target}...`);
console.log(`[download-wt] URL: ${url}`);

fs.mkdirSync(binDir, { recursive: true });

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "download-wt-"));

try {
  const tarball = path.join(tmpDir, "worktrunk.tar.xz");

  // Download with retry for transient failures
  const dl = await $`curl -fsSL --retry 3 --retry-delay 2 -o ${tarball} ${url}`.quiet().nothrow();
  if (dl.exitCode !== 0) {
    console.error(`[download-wt] Download failed (exit ${dl.exitCode}): ${url}`);
    console.error(dl.stderr.toString());
    process.exit(1);
  }

  // Extract — worktrunk tarballs contain a directory with the binary inside
  const extract = await $`tar -xf ${tarball} -C ${tmpDir}`.quiet().nothrow();
  if (extract.exitCode !== 0) {
    console.error(`[download-wt] Extraction failed: ${extract.stderr.toString()}`);
    process.exit(1);
  }

  // Find the wt binary — look for executable files only
  const result = await $`find ${tmpDir} -name wt -type f -perm +111`.quiet();
  const extractedBin = result.stdout.toString().trim().split("\n")[0];

  if (!extractedBin) {
    throw new Error("Could not find 'wt' binary in extracted archive");
  }

  // Move to final location
  fs.copyFileSync(extractedBin, binPath);
  fs.chmodSync(binPath, 0o755);

  // Verify the binary works
  const verify = await $`${binPath} --version`.quiet().nothrow();
  const verStr = verify.stderr.toString().trim() || verify.stdout.toString().trim();
  console.log(`[download-wt] Installed: ${verStr}`);
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
