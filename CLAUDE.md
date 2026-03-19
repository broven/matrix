# Matrix — Claude Code Guidelines

## Testing: data-testid

UI 组件的关键交互节点必须加 `data-testid` 属性，方便 release flow tests 通过 Automation Bridge 定位元素。

规则：
- 按钮、输入框、对话框的确认/取消按钮、sidebar 中的 repo/worktree/session 项都需要 `data-testid`
- 命名格式：`kebab-case`，语义清晰，如 `add-repo-btn`、`repo-item-{name}`、`clone-url-input`
- 新增或修改涉及用户交互的组件时，检查是否需要补 `data-testid`
- 测试用例定义在 `tests/release/README.md`，测试代码在 `tests/release/flows/`
