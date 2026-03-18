# QR Code Server Sharing Design

## Overview

支持手机端扫码添加 server，Desktop 端展示已连接 server 的 QR code，实现跨设备快速配对。同时改造连接管理，支持多 server 持久化存储与自动重连。

## 1. Server 端改造

### 绑定地址

Server 从 `127.0.0.1` 改为绑定 `0.0.0.0`，允许局域网设备连接。

### 持久化 Token

- 在 `~/.matrix/server.json` 中存储固定 token
- 首次启动生成随机 token 并写入配置文件
- 后续重启复用同一 token，确保已保存连接不失效

### 新增 API: `GET /api/local-ip`

- 通过 `os.networkInterfaces()` 获取本机非 loopback 的 IPv4 地址
- 仅用于本地 sidecar 场景，供客户端生成正确的局域网 QR code

## 2. Desktop 客户端 — Server QR Code 展示

### 每个已连接 server 支持分享

- Server 列表中，每个 server 条目增加 "Share" 按钮
- 点击弹出 modal，展示该 server 的 QR code + 连接地址
- 提供 "Copy Link" 按钮，复制 `matrix://connect?serverUrl=...&token=...` URI
- QR code 由客户端本地用 `qrcode` 库生成（已有依赖）

### 本地 sidecar server 地址处理

- 默认通过 `/api/local-ip` 获取局域网 IP
- 支持手动覆盖地址（VPN/自定义网络场景）
- 远程 server 直接复用其已有的 URL

## 3. 多 Server 连接管理与持久化

### 持久化存储

每条 server 记录包含：

- `name` — 用户自定义或自动生成
- `serverUrl`
- `token`
- `lastConnected` — 时间戳

存储方式：使用 Tauri `store` 插件持久化到本地文件（Desktop 和 iOS 通用）。

### 启动行为

- **Desktop:** 先自动连接本地 sidecar，然后尝试连接所有已保存的远程 server
- **iOS:** 尝试自动连接所有已保存的 server
- 连接失败不阻塞，标记为"离线"状态，后台定期重试

### UI 变化

- ConnectPage 演变为 **Server 列表页**
- 每个 server 显示连接状态（在线 / 离线 / 连接中）
- 支持添加（手动输入 / 扫码）、删除、编辑 server
- Desktop 端每个 server 条目有 "Share" 按钮

## 4. 手机端扫码

### 实现方式

- 使用 `tauri-plugin-barcode-scanner` 调用系统原生相机
- 仅在 Tauri 客户端环境下可用（iOS / Android），纯 Web 环境不需要扫码能力

### 扫码流程

1. Server 列表页点击"添加 server"
2. 选择"扫码"或"手动输入"
3. 扫码解析 `matrix://connect?serverUrl=...&token=...`
4. 解析成功后自动添加到 server 列表并尝试连接

## 涉及的文件

| 包 | 文件 | 改动 |
|---|---|---|
| server | `src/index.ts` | 绑定地址改为 `0.0.0.0` |
| server | `src/connect-info.ts` | 局域网 IP 检测逻辑 |
| server | 新增 `src/config.ts` | token 持久化读写 |
| server | API routes | 新增 `GET /api/local-ip` |
| client | `src/pages/ConnectPage.tsx` | 改造为 Server 列表页 |
| client | 新增 server 存储 hook | Tauri store 持久化 |
| client | 新增 QR share modal 组件 | QR code 展示 + copy link |
| client | 新增扫码功能 | `tauri-plugin-barcode-scanner` 集成 |
| client | `src-tauri/Cargo.toml` | 添加 barcode-scanner 插件依赖 |
| client | `src-tauri/capabilities/*.json` | 添加 barcode-scanner 权限 |

## 依赖

- `tauri-plugin-barcode-scanner` — 原生扫码（新增）
- `tauri-plugin-store` — 本地持久化（可能需新增）
- `qrcode` — QR code 生成（已有）
