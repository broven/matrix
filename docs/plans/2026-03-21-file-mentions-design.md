# File Mentions Design

## Overview

在聊天输入框中支持 `@` 触发文件选择，将文件引用作为 ACP `ResourceLink` 发送给 agent。

## 交互流程

1. 用户在输入框输入 `@`
2. 光标上方弹出 popover，显示当前 session worktree 的文件列表
3. 继续输入进行模糊搜索过滤
4. 选中文件后，输入框中插入不可编辑的 pill（如 `[@main.ts]`），可通过 backspace 删除
5. 支持插入多个文件，可在消息任意位置
6. 发送时，文本按 pill 位置切割为有序 `ContentBlock[]`

## 消息结构

用户输入 `看看 [@main.ts] 和 [@app.tsx] 的区别` 序列化为：

```json
[
  { "type": "text", "text": "看看 " },
  { "type": "resource_link", "name": "main.ts", "uri": "file:///path/to/worktree/src/main.ts" },
  { "type": "text", "text": " 和 " },
  { "type": "resource_link", "name": "app.tsx", "uri": "file:///path/to/worktree/src/app.tsx" },
  { "type": "text", "text": " 的区别" }
]
```

文本按 pill 位置切割，保持顺序和位置语义，符合 ACP ContentBlock 数组设计。

## Server API

### `GET /sessions/:sessionId/files`

根据 session 找到 worktree 路径，执行 `git ls-files` 获取 tracked 文件列表。

响应：`string[]`（相对路径）

```json
["src/main.ts", "src/app.tsx", "package.json", "README.md"]
```

前端在 popover 打开时请求一次，缓存在内存中，后续模糊搜索纯前端完成。

## ACP Bridge 改造

`sendPrompt` 的 prompt 参数类型从 `Array<{ type: string; text: string }>` 拓宽为 `ContentBlock[]`：

```typescript
type ContentBlock =
  | { type: "text"; text: string }
  | { type: "resource_link"; name: string; uri: string; mimeType?: string };
```

Server 端拼 `uri` 时用 worktree 绝对路径 + 文件相对路径，生成 `file://` URI。

## 前端组件

### 新增

- **`FileMentionPopover`** — 浮动文件列表，接收搜索关键词，渲染匹配文件，支持键盘上下选择 + Enter 确认
- **`FileMentionPill`** — 输入框内不可编辑 pill，显示文件名，backspace 可删除
- **`useFileMention`** — hook，管理 popover 状态、文件列表缓存、模糊搜索

### 修改

- **输入框组件** — 监听 `@` 触发 popover，插入 pill，发送时序列化为 `ContentBlock[]`
- **消息渲染组件** — 识别 `resource_link` block，渲染为内联文件标签（类似 pill 样式，显示文件名，暂不支持点击交互）

## 设计决策

| 决策 | 选择 | 原因 |
|------|------|------|
| 触发字符 | `@` | mention 语义直觉 |
| 文件范围 | 当前 session worktree | 最小作用域 |
| UI 形态 | popover + 模糊搜索 | 轻量快速 |
| 选中展示 | 内联 pill | 可见位置关系 |
| ACP 传输 | `ResourceLink` | 简单，agent 自己读文件 |
| 多文件结构 | 扁平数组按位置拆分 | 保持位置语义，符合 ACP 规范 |
| 文件列表来源 | Server API (`git ls-files`) | tracked 文件，天然排除 ignored |
| 模糊搜索位置 | 前端 | 无额外依赖，响应快 |
