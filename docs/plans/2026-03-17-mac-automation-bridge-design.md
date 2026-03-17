# Mac/iOS Automation Bridge Design

## Overview

目标是在开发环境为 Matrix 的 Tauri 客户端提供一套统一的自动化控制面，供 AI、Playwright 或自定义脚本直接连接运行中的 App，完成 feature 验证，而不再依赖手工发版到目标机器后再验收。

这套能力需要同时覆盖：

- macOS Tauri App
- iOS Simulator 中运行的 Tauri App
- WebView 内的前端状态与交互
- Tauri/Rust 宿主层与 sidecar 的原生行为

## Problem Statement

当前仓库已经具备本地开发与部分自动化基础：

- 根目录 `pnpm dev` 可并行启动 server 和 web UI。
- `packages/client/` 已配置 `tauri dev`、`Playwright`、`Vitest`。
- `packages/server/` 已具备较完整的测试覆盖。
- macOS 客户端会在启动时拉起 sidecar server 并将 webview 重定向到本地地址。

但缺少一条“运行中的原生 App 可被外部自动化系统稳定接入”的验证路径。macOS 上的 Tauri 使用 `WKWebView` / WebKit，而不是 Chromium，因此不适合依赖 CDP 作为统一自动化入口。Safari inspector 适合人工调试，但不适合作为 AI 自动化验证的基础协议。

## Goals

- 为开发态客户端提供统一的自动化入口。
- 允许自动化系统读取运行状态、操纵窗口和 sidecar、执行受控的页面脚本。
- 让 macOS 与 iOS Simulator 尽可能共享同一套协议。
- 与生产包完全隔离，仅在 `DEV/TEST` 构建中启用。

## Non-Goals

- 不把该方案设计成生产可用的远程管理接口。
- 不暴露任意系统命令执行能力。
- 不尝试实现完整 CDP 兼容层。
- 第一阶段不覆盖真机 iPhone 远程调试。

## Recommended Approach

推荐方案是在 Tauri 宿主层内建一个 `Automation Bridge`。

结构如下：

- `AI / Playwright / custom runner`
- `Automation Bridge`
- `Tauri host`
- `WebView`
- `Sidecar server`

Bridge 作为开发态控制面，监听本机回环地址，对外暴露小而受控的 HTTP/JSON 接口。它不替代现有业务 server，而是为自动化验证提供统一的“读状态 + 执行动作 + 等待条件”协议。

### Why This Approach

- Bridge 位于宿主层，可统一协调原生窗口、Tauri command、sidecar 与 webview。
- 它不依赖 macOS 专属的调试协议，因此更容易延伸到 iOS Simulator。
- Web 自动化与壳层自动化可以共用一套入口，避免后续测试脚本分裂。

## Alternatives Considered

### 1. Safari/WebKit Inspector

优点：

- 几乎零新增开发。
- 适合人工排查页面问题。

缺点：

- 不是 CDP。
- 不适合作为 AI 自动化协议。
- 难以稳定覆盖 native 行为和 sidecar 状态。

结论：保留作人工调试辅助手段，但不作为主验证通路。

### 2. Web-only Bridge

优点：

- 实现成本低。
- 对前端页面验证非常直接。

缺点：

- 无法干净地控制窗口、native command、sidecar 生命周期。
- 随着需求增长，会变成前端与 Rust 间的补丁堆。

结论：不足以满足“前端 + native”全覆盖诉求。

### 3. Sidecar-owned Bridge

优点：

- 靠近 Linux server 验证路径。

缺点：

- sidecar 不是 Tauri 宿主，天然不适合控制原生窗口和 iOS App。
- iOS 端没有 sidecar，复用价值有限。

结论：不适合作为统一自动化控制面。

## Architecture

### Core Layers

#### 1. Rust Host Layer

负责：

- 启动与关闭 automation bridge
- 维护鉴权 token 与运行状态
- 执行 native 白名单动作
- 采集 sidecar 与窗口状态
- 将 WebView 操作路由到前端

#### 2. WebView Automation Layer

负责：

- 暴露结构化前端快照
- 响应测试事件
- 支持页面级 reset
- 提供必要的受控页面操作入口

建议在前端开发态注入：

```ts
window.__MATRIX_AUTOMATION__ = {
  getSnapshot,
  resetTestState,
  dispatchEvent,
}
```

#### 3. Sidecar / Server Layer

继续承载业务能力，不作为自动化主入口。必要时仅提供健康检查、状态查询或测试态 reset 钩子，供 Rust bridge 汇总。

## Protocol Design

第一版建议采用 `HTTP + JSON`，避免一开始引入复杂双向协议。后续如需日志流或事件订阅，再补 WebSocket。

### Required Endpoints

#### `GET /health`

返回 app、webview、sidecar 的 readiness 信息。

示例：

```json
{
  "ok": true,
  "platform": "macos",
  "mode": "dev",
  "appReady": true,
  "webviewReady": true,
  "sidecarReady": true,
  "currentUrl": "http://127.0.0.1:19880"
}
```

#### `GET /state`

返回结构化状态快照。

示例：

```json
{
  "window": {
    "label": "main",
    "focused": true,
    "visible": true,
    "size": { "width": 1280, "height": 900 }
  },
  "webview": {
    "url": "http://127.0.0.1:19880",
    "title": "Matrix"
  },
  "sidecar": {
    "running": true,
    "port": 19880
  }
}
```

#### `POST /webview/eval`

在 WebView 中执行受控 JavaScript 并返回 JSON 结果。

#### `POST /webview/event`

向前端注入测试事件，驱动测试钩子。

#### `POST /native/invoke`

执行白名单原生动作，不允许任意命令执行。

初始白名单建议为：

- `window.focus`
- `window.resize`
- `window.reload`
- `window.navigate`
- `sidecar.status`
- `sidecar.restart`
- `app.logs.tail`

#### `POST /test/reset`

重置测试环境，支持：

- local storage
- IndexedDB
- session cache
- sidecar 状态

#### `POST /wait`

等待某个条件成立，减少测试脚本中的脆弱轮询与 sleep。

## Security Model

Bridge 必须严格限定为开发态能力：

- 仅监听 `127.0.0.1`
- 仅在 `debug_assertions` 或显式 `MATRIX_AUTOMATION=1` 时启用
- 启动时生成一次性 bearer token
- 所有请求必须带 `Authorization: Bearer <token>`
- 生产构建禁用全部 automation 入口

另外，Bridge 不提供：

- 任意 shell 执行
- 任意 Rust 方法反射调用
- 未经约束的原生操作

## Discovery

为避免外部脚本猜测端口，App 启动 automation bridge 后，写出本地发现文件：

`~/Library/Application Support/Matrix/dev/automation.json`

内容示例：

```json
{
  "enabled": true,
  "platform": "macos",
  "baseUrl": "http://127.0.0.1:18765",
  "token": "dev-xxxxx",
  "pid": 12345
}
```

自动化系统只需先读取此文件，再根据其中的地址和 token 建立连接。

## Platform Strategy

### macOS

macOS 开发态最简单，App 直接监听本机回环地址。启动过程为：

1. `tauri dev` 启动 App
2. App 启动 sidecar
3. App 启动 bridge
4. App 写出 `automation.json`
5. AI 或测试脚本读取 `automation.json` 并发起调用

### iOS Simulator

iOS Simulator 复用相同协议，但连接模型可能需要与宿主机 coordinator 配合：

- macOS 可直接暴露本地 loopback bridge
- iOS Simulator 可通过 app 主动注册到宿主侧 coordinator

协议保持一致，连接器实现可按平台差异演进。第一阶段先优先打通 macOS，再扩展到 iOS Simulator。

## Repository Mapping

建议的文件落位如下：

- Modify: `packages/client/src-tauri/src/lib.rs`
- Create: `packages/client/src-tauri/src/automation/mod.rs`
- Create: `packages/client/src-tauri/src/automation/server.rs`
- Create: `packages/client/src-tauri/src/automation/state.rs`
- Create: `packages/client/src-tauri/src/automation/actions.rs`
- Create: `packages/client/src/automation/bridge.ts`
- Create: `packages/client/src/automation/test-hooks.ts`

## Delivery Phases

### Phase 1: Mac app can be discovered and queried

实现：

- `GET /health`
- `GET /state`
- `POST /webview/eval`
- `automation.json`
- `window.__MATRIX_AUTOMATION__`

验收标准：

- 启动 `tauri dev` 后能找到 bridge
- 可确认 app/webview/sidecar ready
- 可读取页面结构化状态
- 可执行基础断言

### Phase 2: Native control

实现：

- `POST /native/invoke`
- 窗口动作
- sidecar 状态与重启

验收标准：

- AI 能验证 reload、focus、sidecar restart 等 native 相关 feature

### Phase 3: Repeatable tests

实现：

- `POST /test/reset`
- `POST /wait`

验收标准：

- 同一 feature 可稳定重复跑，不依赖人工清理环境

### Phase 4: iOS Simulator reuse

实现：

- 将统一协议延伸到 simulator
- 补宿主 coordinator 或 simulator 连接器

## Validation Strategy

第一阶段不追求覆盖全部 feature，而是用一个真实 feature 证明链路可行，例如：

- 启动 App
- sidecar ready
- webview 自动连接到本地服务
- UI 出现关键可交互元素

最小闭环如下：

1. 启动 `pnpm --filter @matrix/client tauri:dev`
2. 读取 `automation.json`
3. 调用 `/health`
4. 调用 `/state` 或 `/webview/eval`
5. 完成关键 UI 断言

## Open Questions

- iOS Simulator 最终使用“宿主 coordinator”还是直接 loopback 暴露更稳定，需要实测后定案。
- `webview/eval` 在 Tauri 2 当前 API 下的结果返回机制需要结合实际可用能力确认实现细节。
- 是否需要专门的 `snapshot schema` 来降低自动化脚本对 DOM 结构的依赖，可在第一阶段评估。
