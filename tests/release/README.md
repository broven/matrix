# Pre-Release Flow Tests

每次发版前必须跑通的核心流程测试。通过 Automation Bridge 驱动真实 Tauri 应用。

## Test Case Inbox

## Test Cases

| # | 文件 | 验证内容 |
|---|------|----------|
| 01 | connect-server | 验证 app 启动后能连上 sidecar，UI 显示已连接状态 |
| 02 | add-repo-open-local | 通过 Open Project 对话框添加一个本地 git 仓库，验证出现在 sidebar |
| 03 | add-repo-clone-url | 通过 Clone from URL 对话框克隆远程仓库，验证 clone 完成后出现在 sidebar |
| 04 | create-session | 在已有 repo 上创建 worktree + session，验证聊天界面加载出来 |
| 05 | slash-command-suggest | 输入 / 后弹出 slash command 下拉提示，验证有 command 条目 |
| 06 | slash-command-no-auto-send | 选择一个 slash command 后仅填入输入框，不自动发送消息 |
