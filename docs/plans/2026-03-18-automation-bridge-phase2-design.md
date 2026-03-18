# Automation Bridge Phase 2 Design

## Overview

第二阶段目标不是继续给当前 macOS bridge 打补丁，而是把协议和跨端架构一次定完整，然后再推进实现。范围覆盖：

- `packages/client` 内部的 automation bridge 重构
- macOS desktop adapter 的完整实现
- iOS simulator adapter 的统一接入模型
- WebView request/response bridge
- 面向长期维护的开发说明

## Goals

- 在 `packages/client` 内建立清晰的 `core/runtime` 分层。
- 一次性定稿完整 automation protocol，避免后续端点语义漂移。
- 让 macOS 与 iOS simulator 共享同一套协议和 capability 抽象。
- 为 AI 和自动化脚本提供稳定的 `native + webview + test-control` 接口。
- 补齐使用文档，使 bridge 成为可持续使用的开发能力。

## Non-Goals

- 不抽成独立 workspace package。
- 不让 Linux server 或纯 web 模式复用这套 runtime。
- 不实现 CDP 兼容层。
- 不在第二阶段覆盖真机 iPhone 调试。

## Repository Placement

Bridge 继续保留在 `packages/client`，但目录拆成两层：

- `packages/client/src-tauri/src/automation/core/`
- `packages/client/src-tauri/src/automation/runtime/`

这样既避免过早包化，也能把协议抽象和 Tauri 平台接线解耦。由于未来消费者只有：

- macOS client
- iOS simulator client

独立 package 的收益不足以覆盖额外的构建和维护成本。

## Architecture

### Core Layer

`core` 只定义协议和能力模型，不依赖具体 Tauri 对象。

它负责：

- request/response models
- error codes
- capability traits
- wait condition model
- reset scope model
- route dispatch contracts

建议包含：

- `protocol.rs`
- `errors.rs`
- `capabilities.rs`
- `models.rs`

### Runtime Layer

`runtime` 负责真正的平台行为和 HTTP 桥接。

它负责：

- loopback HTTP server
- bearer auth
- discovery metadata
- desktop adapter
- ios-sim adapter
- webview bridge runtime
- startup wiring

建议包含：

- `router.rs`
- `discovery.rs`
- `state.rs`
- `webview.rs`
- `runtime/desktop.rs`
- `runtime/ios_sim.rs`

## Protocol

第二阶段完整协议一次定稿为：

- `GET /health`
- `GET /state`
- `POST /webview/eval`
- `POST /webview/event`
- `POST /native/invoke`
- `POST /test/reset`
- `POST /wait`

其中：

- `GET /health`
- `GET /state`

返回专门的结构化对象。

其余端点统一使用 envelope：

```json
{
  "ok": true,
  "result": {},
  "error": null
}
```

### Error Codes

统一错误语义：

- `unauthorized`
- `invalid_json`
- `missing_field`
- `unsupported_action`
- `unsupported_condition`
- `timeout`
- `webview_unavailable`
- `native_unavailable`
- `reset_failed`
- `internal_error`

## Capability Model

### StateCapability

负责：

- `health()`
- `state()`

### WebviewCapability

负责：

- `eval(script)`
- `dispatch_event(name, payload)`
- `snapshot()`

### NativeCapability

负责：

- `invoke(action, args)`

并维护白名单动作。

### TestControlCapability

负责：

- `reset(scopes)`

### WaitCapability

负责：

- `wait_for(condition, timeout_ms, interval_ms)`

## Platform Adapters

### DesktopAdapter

`DesktopAdapter` 是第二阶段的主实现目标。

它应负责：

- main webview window 访问
- desktop window actions
- sidecar status/restart
- webview eval/event
- desktop state 汇总
- test reset 执行

### IosSimulatorAdapter

`IosSimulatorAdapter` 复用同一 protocol 和 capability traits，但能力支持矩阵不同。

它应负责：

- app state 和 webview state 汇总
- iOS 下可用的 native actions
- webview eval/event
- test reset

不支持的 desktop-only actions 返回：

- `unsupported_action`

## WebView Bridge Strategy

不采用“宿主直接裸 eval 并强行同步拿回结果”的方式。第二阶段改为实现一个 request/response bridge。

数据流：

1. HTTP 请求进入 `/webview/eval` 或 `/webview/event`
2. Rust runtime 把请求交给 `WebviewCapability`
3. Webview capability 通过前端 bridge 发起 request
4. 前端在 `window.__MATRIX_AUTOMATION__` 中执行受控逻辑
5. 前端返回结构化 JSON 结果
6. Rust runtime 再把结果写回 HTTP 响应

前端 bridge 需要增强为：

- `getSnapshot()`
- `resetTestState(scope?)`
- `dispatchEvent(name, payload?)`
- `runScript(script)`

其中 `runScript` 必须：

- 捕获异常
- 返回 JSON-safe 值
- 与当前 snapshot/reset/event 语义一致

## Wait Model

第二阶段只支持两种 condition：

- `webview.eval`
- `state.match`

这样足以覆盖大多数 feature 验证，同时避免在 Rust 里设计过重的 DSL。

## Reset Model

`POST /test/reset` 支持 scope 化执行，建议包含：

- `web-storage`
- `indexed-db`
- `automation-state`
- `session-cache`
- `sidecar`

desktop 和 iOS adapter 按平台能力分别实现。

## iOS Simulator Strategy

第二阶段只设计并实现 simulator 路径，不覆盖真机。

目标是：

- 协议完全一致
- capability 接口完全一致
- adapter 内部屏蔽窗口、sidecar 等平台差异

如果某能力在 iOS simulator 不存在，协议层不分叉，只返回结构化 `unsupported_action` 或 `native_unavailable`。

## Warning Cleanup

当前 Rust `dead_code` warning 主要来自：

- 已定义但未接入路由的 native action models
- 运行期尚未消费的 server management helpers

第二阶段在完整接线后应自然收掉大部分 warning。若仍有残留，再做最小清理，不为了消 warning 引入无意义代码。

## Documentation

第二阶段补一份面向开发者的操作说明，位置建议为：

- `packages/client/AUTOMATION.md`

范围包括：

- bridge 启动条件
- discovery 文件位置
- macOS 开发态使用方式
- iOS simulator 接入方式
- 支持的 endpoints / actions / conditions / reset scopes
- 常见故障与排查

设计文档继续保留在 `docs/plans/`，操作文档放在 `packages/client/`，避免把“为什么这么设计”和“怎么用”混在一起。

## Recommended Delivery Order

1. 重构为 `core/runtime` 分层并冻结协议面。
2. 在 macOS desktop adapter 上完整实现全部第二阶段 endpoints。
3. 用同一 capability 接口接入 iOS simulator adapter。
4. 补 `AUTOMATION.md` 并做端到端 smoke 验证。
