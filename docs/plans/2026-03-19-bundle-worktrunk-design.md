# Bundle Worktrunk Binary into Server

## Problem

Server 的 `WorktreeManager` 依赖用户 PATH 中安装了 `wt` (Worktrunk) CLI。没装的话 fallback 到 raw git 命令，缺少 Worktrunk 的智能分支删除等功能。用户不应该需要自己安装 `wt`。

## Solution

在 build/package 阶段下载对应平台的 Worktrunk 预编译 binary，打包进 server 产物。`WorktreeManager` 优先使用 bundled binary，其次 PATH 中的 `wt`，最后 fallback 到 git。

## Worktrunk Release Assets

Worktrunk (https://github.com/max-sixty/worktrunk) 在每个 GitHub Release 提供预编译 binary：

| 平台 | 文件 |
|------|------|
| macOS ARM | `worktrunk-aarch64-apple-darwin.tar.xz` |
| macOS Intel | `worktrunk-x86_64-apple-darwin.tar.xz` |
| Linux x86_64 | `worktrunk-x86_64-unknown-linux-musl.tar.xz` |
| Linux ARM64 | `worktrunk-aarch64-unknown-linux-musl.tar.xz` |
| Windows | `worktrunk-x86_64-pc-windows-msvc.zip` |

URL 格式：
```
https://github.com/max-sixty/worktrunk/releases/download/v{VERSION}/worktrunk-{TARGET}.tar.xz
```

Linux binary 是 musl 静态链接，零运行时依赖。

## Architecture

### Binary 位置

```
packages/server/
├── bin/
│   └── wt              ← 平台对应的 worktrunk binary (gitignored)
├── src/
│   └── worktree-manager/
│       └── index.ts     ← 修改解析逻辑
└── scripts/
    └── download-wt.ts   ← 下载脚本
```

### 解析优先级

```
1. bundled binary:  packages/server/bin/wt
2. PATH binary:    which wt
3. git fallback:   git worktree add / git worktree remove
```

### download-wt.ts 脚本

负责下载并解压对应平台的 Worktrunk binary 到 `bin/wt`。

```typescript
// 平台 → target 映射
const TARGETS = {
  "darwin-arm64":  "aarch64-apple-darwin",
  "darwin-x64":    "x86_64-apple-darwin",
  "linux-x64":     "x86_64-unknown-linux-musl",
  "linux-arm64":   "aarch64-unknown-linux-musl",
  "win32-x64":     "x86_64-pc-windows-msvc",
};
```

执行时机：
- `postinstall` (npm/bun install 后自动运行)
- CI build 阶段
- 手动 `bun run download-wt`

### WorktreeManager 修改

```typescript
// 当前
async isWtAvailable(): Promise<boolean> {
  const result = await $`which wt`.quiet();
  return result.exitCode === 0;
}

// 修改后
private wtPath: string | null = null;

async resolveWt(): Promise<string | null> {
  if (this.wtPath !== null) return this.wtPath;

  // 1. bundled binary
  const bundled = path.join(import.meta.dir, "../bin/wt");
  if (await Bun.file(bundled).exists()) {
    this.wtPath = bundled;
    return this.wtPath;
  }

  // 2. PATH
  try {
    const result = await $`which wt`.quiet();
    if (result.exitCode === 0) {
      this.wtPath = result.stdout.toString().trim();
      return this.wtPath;
    }
  } catch {}

  this.wtPath = "";  // empty = not found, use git fallback
  return null;
}
```

调用处从 `wt` 命令改为 `${wtPath}`：
```typescript
// 当前
await $`wt switch -c ${branch} --base ${baseBranch} --yes`.cwd(repoPath).quiet();

// 修改后
const wt = await this.resolveWt();
await $`${wt} switch -c ${branch} --base ${baseBranch} --yes`.cwd(repoPath).quiet();
```

## 各平台打包集成

### Mac (.dmg) — Sidecar

Server 通过 `bun build --compile` 编译为 sidecar binary。`wt` binary 需要作为额外文件打包进 `.app` bundle。

```
Matrix.app/
├── MacOS/
│   ├── Matrix              ← Tauri binary
│   └── matrix-server       ← bun build --compile sidecar
└── Resources/
    └── bin/
        └── wt              ← bundled worktrunk binary
```

Sidecar 运行时通过 `MATRIX_BIN_DIR` 环境变量或相对路径定位 `wt`。

Tauri `tauri.conf.json` 添加 resources：
```json
{
  "bundle": {
    "resources": ["bin/wt"]
  }
}
```

### Linux (tarball + Docker)

Tarball:
```
matrix-server-v1.0.0-linux-x64/
├── matrix-server
├── web/
└── bin/
    └── wt
```

Dockerfile:
```dockerfile
FROM alpine:3.21
COPY matrix-server /usr/local/bin/
COPY bin/wt /usr/local/bin/wt
COPY web/ /app/web/
```

### CI Workflow 修改

在 `.github/workflows/release.yml` 的每个 build job 中添加 download 步骤：

```yaml
- name: Download Worktrunk binary
  run: bun run packages/server/scripts/download-wt.ts
  env:
    WT_VERSION: "0.29.4"
```

## Version 管理

在 `packages/server/package.json` 中记录 pinned 版本：

```json
{
  "config": {
    "worktrunkVersion": "0.29.4"
  }
}
```

`download-wt.ts` 读取此版本号。升级时只需改这个值。

## .gitignore

```
packages/server/bin/
```

Binary 不进 git，每次 install/build 时下载。

## Code Changes

### 1. 新增 `packages/server/scripts/download-wt.ts`
- 检测平台 → 拼接下载 URL → 下载 tar.xz → 解压到 `bin/wt` → chmod +x

### 2. 修改 `packages/server/src/worktree-manager/index.ts`
- `isWtAvailable()` → `resolveWt(): Promise<string | null>`
- 所有 `wt` 调用改为使用 resolved path
- 添加 bundled binary 路径检测

### 3. 修改 `packages/server/package.json`
- 添加 `config.worktrunkVersion`
- 添加 `scripts.download-wt`
- 可选：添加 `postinstall` hook

### 4. 修改 `.github/workflows/release.yml`
- Mac/Linux build job 添加 download-wt 步骤
- Docker build 中 COPY wt binary

### 5. 新增 `packages/server/bin/.gitkeep` + `.gitignore`
