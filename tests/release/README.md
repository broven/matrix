# Pre-Release Flow Tests

每次发版前必须跑通的核心流程测试。通过 Automation Bridge 驱动真实 Tauri 应用。

## Test Case Inbox


## Test Cases

| 文件 | 验证内容 |
|------|----------|
| connect-server | 验证 app 启动后能连上 sidecar，UI 显示已连接状态 |
| add-repo-open-local | 通过 Open Project 对话框添加一个本地 git 仓库，验证出现在 sidebar |
| add-repo-clone-url | 通过 Clone from URL 对话框克隆远程仓库，验证 clone 完成后出现在 sidebar |
| create-session | 在已有 repo 上创建 worktree + session，验证聊天界面加载出来 |
| archive-worktree | 验证能 archive worktree，git worktree 物理文件被删除，运行中的 acp-client 也被关闭 |
| settings-repo-info | 验证 settings 页面全屏打开，仓库信息（名称、路径、remote URL、分支）正确展示 |
| delete-repo-keep-files | 验证删除仓库时默认不勾选删除文件，执行后仓库从列表消失但物理文件保留 |
| delete-repo-with-files | 验证删除仓库时勾选删除文件，执行后物理文件也被删除，不会误删 repo 外的文件 |
