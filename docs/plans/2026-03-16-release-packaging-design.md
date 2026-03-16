# Release & Packaging Design

## Overview

通过 GitHub Actions 实现多平台构建和分发，由 git tag push (`v*.*.*`) 触发。

**三个平台产物：**
- **Mac** (.dmg) — Tauri app + sidecar server, Apple Silicon
- **Linux** (tarball + Docker) — standalone server binary + Web UI
- **iPhone** (.ipa) — Tauri iOS app, 通过 AltStore 分发

## Architecture

### 现有模块 → 平台产物映射

```
monorepo:
├── packages/client/          # React UI + Tauri shell
├── packages/server/          # Hono Node.js server
├── packages/protocol/        # 共享类型
└── packages/sdk/             # 客户端 SDK
```

### Mac 产物 (.dmg)

```
Matrix.app (Tauri 打包)
├── MacOS/
│   ├── Matrix              ← Tauri Rust binary (壳, 内嵌 WebView + React UI)
│   └── matrix-server       ← bun build --compile sidecar (packages/server/)
```

**组装流程：**
1. `vite build` → React UI 静态文件 (`packages/client/dist/`)
2. `bun build --compile packages/server/src/index.ts` → sidecar binary → `src-tauri/binaries/matrix-server-aarch64-apple-darwin`
3. `tauri build --target aarch64-apple-darwin` → `.dmg`

**Sidecar 行为：**
- App 启动 → spawn sidecar → 等待 ready → 自动连接 `localhost:port`
- App 退出 → kill sidecar
- Settings 页面可添加 remote server 连接

### Linux 产物 (tarball + Docker)

```
matrix-server-v1.0.0-linux-x64/
├── matrix-server            ← bun build --compile (packages/server/)
└── web/                     ← vite build 静态文件 (packages/client/)
```

**Server 运行方式：**
```bash
MATRIX_TOKEN=xxx ./matrix-server --port 3000 --web ./web
```

Server 通过 `serveStatic` 中间件同时提供 API/WebSocket 和 Web UI。

**两个 binary 版本：**
- `--target bun-linux-x64` → glibc 版本，用于 tarball
- `--target bun-linux-x64-musl` → musl 版本，用于 Docker

**Docker image (Alpine)：**
```dockerfile
FROM alpine:3.21
COPY matrix-server /usr/local/bin/
COPY web/ /app/web/
EXPOSE 3000
CMD ["matrix-server", "--port", "3000", "--web", "/app/web"]
```

Push to `ghcr.io/broven/matrix-server:v1.0.0` + `:latest`

### iPhone 产物 (.ipa)

```
Matrix.app (iOS bundle)
└── Matrix                   ← Tauri iOS Rust binary (内嵌 WebView + React UI)
```

**组装流程：**
1. `vite build` → React UI
2. `rustup target add aarch64-apple-ios`
3. `tauri ios init` + `tauri ios build --export-method release-testing`
4. 手动打包 `.app` → `.ipa`

**无 sidecar，仅 Remote 连接。**

**AltStore 分发：** 维护 `altstore-source.json`，CI 自动更新 version/downloadURL/size。用户添加 source URL：
```
https://raw.githubusercontent.com/broven/matrix/main/altstore-source.json
```

## 平台差异处理

三个平台共用 `packages/client/` React 代码，运行时检测适配：

```ts
const isTauri = '__TAURI__' in window
const isMobile = isTauri && (await import('@tauri-apps/api/core')).isMobile()
const hasLocalServer = isTauri && !isMobile
```

| 功能 | Mac | Linux (Web) | iPhone |
|------|-----|-------------|--------|
| Local server | sidecar 自动启动 | 自身就是 server | 无 |
| Remote 连接 | Settings 手动添加 | Settings 手动添加 | 唯一方式 |
| Tauri API | 有 | 无（纯浏览器） | 有 |

## GitHub Actions Workflow

**触发：** `push tags: v*.*.*`

```
git tag v1.0.0 → push
        │
        ├── Job 1: build-mac (macos-15)
        │   ├── bun build --compile server → sidecar
        │   ├── tauri build --target aarch64-apple-darwin
        │   └── artifact: Matrix_v1.0.0_aarch64.dmg
        │
        ├── Job 2: build-linux-server (ubuntu-latest)
        │   ├── bun build --compile server (glibc + musl)
        │   ├── vite build → web UI
        │   ├── tarball: matrix-server-v1.0.0-linux-x64.tar.gz
        │   └── Docker push: ghcr.io/broven/matrix-server
        │
        └── Job 3: build-ios (macos-15)
            ├── tauri ios build
            ├── package .ipa
            └── update altstore-source.json
        │
        └── Job 4: create-release (needs: all above)
            ├── Create GitHub Release
            ├── Attach: .dmg, .tar.gz, .ipa
            └── Commit updated altstore-source.json
```

**Version 管理：** 从 tag 提取版本号，CI 构建时临时写入 `tauri.conf.json` 和 `package.json`，不 commit。

## Code Changes Required

### 1. Server — 静态文件服务 + CLI 参数
- `packages/server/src/index.ts`: 添加 `serveStatic` 中间件, `--port` / `--web` CLI 参数

### 2. Client Rust — Sidecar 管理
- `src-tauri/src/lib.rs`: spawn/kill sidecar 逻辑
- `tauri.conf.json`: `"externalBin": ["binaries/matrix-server"]`

### 3. Client React — Settings 页面
- 新增 Settings 面板，支持添加 remote server URL
- 连接管理：local (auto) + remote (manual)

### 4. Client React — 平台条件逻辑
- 运行时检测 `hasLocalServer`，iPhone 版跳过 local 连接

### 5. 新增文件
- `.github/workflows/release.yml`
- `Dockerfile`
- `altstore-source.json`
