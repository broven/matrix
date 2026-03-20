# Test Infrastructure P0 + P1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add CI test gate, coverage tooling, and front-end component tests for PromptInput and Sidebar.

**Architecture:** Three parallel CI jobs (server/sdk/client) on PR + push to main. Vitest v8 coverage for sdk/client, Bun native coverage for server. Two new test files for core front-end components.

**Tech Stack:** GitHub Actions, Vitest 3.0 (coverage v8), Bun test, @testing-library/react, jsdom

---

### Task 1: Create CI test workflow

**Files:**
- Create: `.github/workflows/test.yml`

**Step 1: Write the workflow file**

```yaml
name: Test

on:
  pull_request:
  push:
    branches: [main]

jobs:
  test-server:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: cd packages/server && bun install
      - run: cd packages/server && bun test --coverage

  test-sdk:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - uses: pnpm/action-setup@v4
      - run: pnpm install
      - run: pnpm -r build
      - run: cd packages/sdk && pnpm vitest run --coverage

  test-client:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - uses: pnpm/action-setup@v4
      - run: pnpm install
      - run: pnpm -r build
      - run: cd packages/client && pnpm vitest run --coverage
```

**Step 2: Verify YAML is valid**

Run: `cat .github/workflows/test.yml | python3 -c "import yaml,sys; yaml.safe_load(sys.stdin); print('OK')"`
Expected: `OK`

**Step 3: Commit**

```bash
git add .github/workflows/test.yml
git commit -m "ci: add test workflow for PR and push to main"
```

---

### Task 2: Add Vitest coverage config for SDK

**Files:**
- Modify: `packages/sdk/vitest.config.ts` (create — currently does not exist)

**Step 1: Create the vitest config with coverage**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "./coverage",
    },
  },
});
```

**Step 2: Run tests with coverage to verify it works**

Run: `cd packages/sdk && pnpm vitest run --coverage`
Expected: Tests pass, text coverage summary printed to stdout

**Step 3: Add `coverage/` to .gitignore if not already there**

Check if `coverage/` is in the root `.gitignore`. If not, add it.

**Step 4: Commit**

```bash
git add packages/sdk/vitest.config.ts .gitignore
git commit -m "ci: add vitest v8 coverage config for SDK"
```

---

### Task 3: Add Vitest coverage config for Client

**Files:**
- Modify: `packages/client/vitest.config.ts`

**Step 1: Add coverage config to existing vitest config**

The file currently is:
```typescript
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
      setupFiles: ["./test/setup.ts"],
    },
  }),
);
```

Add coverage block inside the `test` object:
```typescript
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
      setupFiles: ["./test/setup.ts"],
      coverage: {
        provider: "v8",
        reporter: ["text", "lcov"],
        reportsDirectory: "./coverage",
      },
    },
  }),
);
```

**Step 2: Run tests with coverage to verify**

Run: `cd packages/client && pnpm vitest run --coverage`
Expected: Tests pass, text coverage summary printed

**Step 3: Commit**

```bash
git add packages/client/vitest.config.ts
git commit -m "ci: add vitest v8 coverage config for client"
```

---

### Task 4: Write PromptInput tests

**Files:**
- Create: `packages/client/src/components/PromptInput.test.tsx`

**Step 1: Write the test file**

```tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AvailableCommand } from "@matrix/protocol";
import { PromptInput } from "@/components/PromptInput";

const defaultProps = {
  onSend: vi.fn(),
  selectedAgentId: "assistant",
  selectedProfileId: null,
  agents: [
    { id: "assistant", name: "Assistant", command: "assistant", available: true, source: "builtin" as const, profiles: [] },
  ],
};

describe("PromptInput", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders the textarea with default placeholder", () => {
    render(<PromptInput {...defaultProps} />);
    expect(screen.getByTestId("chat-input")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Ask to make changes/)).toBeInTheDocument();
  });

  it("renders custom placeholder", () => {
    render(<PromptInput {...defaultProps} placeholder="Type here" />);
    expect(screen.getByPlaceholderText("Type here")).toBeInTheDocument();
  });

  it("sends message on Enter and clears input", () => {
    const onSend = vi.fn();
    render(<PromptInput {...defaultProps} onSend={onSend} />);

    const input = screen.getByTestId("chat-input");
    fireEvent.change(input, { target: { value: "hello", selectionStart: 5 } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSend).toHaveBeenCalledWith("hello");
    expect((input as HTMLTextAreaElement).value).toBe("");
  });

  it("does not send on Shift+Enter", () => {
    const onSend = vi.fn();
    render(<PromptInput {...defaultProps} onSend={onSend} />);

    const input = screen.getByTestId("chat-input");
    fireEvent.change(input, { target: { value: "hello", selectionStart: 5 } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("does not send when input is empty", () => {
    const onSend = vi.fn();
    render(<PromptInput {...defaultProps} onSend={onSend} />);

    const input = screen.getByTestId("chat-input");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("disables textarea when disabled prop is true", () => {
    render(<PromptInput {...defaultProps} disabled />);
    expect(screen.getByTestId("chat-input")).toBeDisabled();
  });

  it("shows slash command dropdown when typing /", () => {
    const commands: AvailableCommand[] = [
      { name: "compact", description: "Compact mode" },
      { name: "review", description: "Review code" },
    ];
    render(<PromptInput {...defaultProps} availableCommands={commands} />);

    const input = screen.getByTestId("chat-input");
    fireEvent.change(input, { target: { value: "/", selectionStart: 1 } });

    expect(screen.getByTestId("slash-command-dropdown")).toBeInTheDocument();
    expect(screen.getByTestId("slash-command-item-compact")).toBeInTheDocument();
    expect(screen.getByTestId("slash-command-item-review")).toBeInTheDocument();
  });

  it("filters slash commands by query", () => {
    const commands: AvailableCommand[] = [
      { name: "compact", description: "Compact mode" },
      { name: "review", description: "Review code" },
    ];
    render(<PromptInput {...defaultProps} availableCommands={commands} />);

    const input = screen.getByTestId("chat-input");
    fireEvent.change(input, { target: { value: "/rev", selectionStart: 4 } });

    expect(screen.getByTestId("slash-command-item-review")).toBeInTheDocument();
    expect(screen.queryByTestId("slash-command-item-compact")).not.toBeInTheDocument();
  });

  it("selects slash command on Enter and fills input without sending", () => {
    const onSend = vi.fn();
    const commands: AvailableCommand[] = [
      { name: "compact", description: "Compact mode" },
    ];
    render(<PromptInput {...defaultProps} onSend={onSend} availableCommands={commands} />);

    const input = screen.getByTestId("chat-input");
    fireEvent.change(input, { target: { value: "/", selectionStart: 1 } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSend).not.toHaveBeenCalled();
    // The slash command should be filled in the input
    expect((input as HTMLTextAreaElement).value).toContain("/compact");
  });
});
```

**Step 2: Run the test to verify it passes**

Run: `cd packages/client && pnpm vitest run src/components/PromptInput.test.tsx`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add packages/client/src/components/PromptInput.test.tsx
git commit -m "test: add PromptInput component tests"
```

---

### Task 5: Write Sidebar tests

**Files:**
- Create: `packages/client/src/components/layout/Sidebar.test.tsx`

**Step 1: Write the test file**

```tsx
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo, RepositoryInfo, WorktreeInfo } from "@matrix/protocol";
import { Sidebar } from "@/components/layout/Sidebar";

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

const testAgents = [
  { id: "assistant", name: "Assistant", command: "assistant", available: true, source: "builtin" as const, profiles: [] },
];

const makeRepo = (overrides?: Partial<RepositoryInfo>): RepositoryInfo => ({
  id: "repo-1",
  name: "my-project",
  path: "/tmp/my-project",
  remoteUrl: "https://github.com/user/my-project",
  serverId: "server-1",
  defaultBranch: "main",
  ...overrides,
});

const makeWorktree = (overrides?: Partial<WorktreeInfo>): WorktreeInfo => ({
  id: "wt-1",
  repositoryId: "repo-1",
  branch: "feat-login",
  baseBranch: "main",
  path: "/tmp/worktrees/feat-login",
  ...overrides,
});

const makeSession = (overrides?: Partial<SessionInfo>): SessionInfo => ({
  sessionId: "sess-1",
  agentId: "assistant",
  profileId: null,
  cwd: "/tmp/workspace",
  createdAt: "2026-03-20T10:00:00.000Z",
  status: "active",
  recoverable: true,
  agentSessionId: "agent_sess_1",
  lastActiveAt: "2026-03-20T10:00:00.000Z",
  suspendedAt: null,
  closeReason: null,
  worktreeId: "wt-1",
  repositoryId: "repo-1",
  branch: "feat-login",
  ...overrides,
});

const defaultProps = {
  agents: testAgents,
  sessions: [] as SessionInfo[],
  repositories: [] as RepositoryInfo[],
  worktrees: new Map<string, WorktreeInfo[]>(),
  cloningRepos: new Map<string, string>(),
  connectionStatus: "connected" as const,
  selectedSessionId: null,
  onSelectSession: vi.fn(),
  onCreateSession: vi.fn(async () => null),
  onDeleteSession: vi.fn(),
  onOpenProject: vi.fn(),
  onCloneFromUrl: vi.fn(),
  onCreateWorktree: vi.fn(),
  onDeleteWorktree: vi.fn(),
};

describe("Sidebar", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows empty state when no repositories or sessions", () => {
    render(<Sidebar {...defaultProps} />);
    expect(screen.getByText("No repositories")).toBeInTheDocument();
  });

  it("renders repository with name", () => {
    const repo = makeRepo();
    render(
      <Sidebar
        {...defaultProps}
        repositories={[repo]}
        worktrees={new Map([["repo-1", []]])}
      />,
    );
    expect(screen.getByTestId("repo-item-my-project")).toBeInTheDocument();
    expect(screen.getByText("my-project")).toBeInTheDocument();
  });

  it("renders worktree under repository", () => {
    const repo = makeRepo();
    const wt = makeWorktree();
    const session = makeSession();

    render(
      <Sidebar
        {...defaultProps}
        repositories={[repo]}
        worktrees={new Map([["repo-1", [wt]]])}
        sessions={[session]}
      />,
    );

    expect(screen.getByTestId("worktree-item-feat-login")).toBeInTheDocument();
    expect(screen.getByText("feat-login")).toBeInTheDocument();
  });

  it("selects session when clicking worktree with active session", () => {
    const onSelectSession = vi.fn();
    const repo = makeRepo();
    const wt = makeWorktree();
    const session = makeSession();

    render(
      <Sidebar
        {...defaultProps}
        repositories={[repo]}
        worktrees={new Map([["repo-1", [wt]]])}
        sessions={[session]}
        onSelectSession={onSelectSession}
      />,
    );

    fireEvent.click(screen.getByTestId("worktree-item-feat-login"));
    expect(onSelectSession).toHaveBeenCalledWith("sess-1");
  });

  it("shows connected status indicator", () => {
    render(<Sidebar {...defaultProps} connectionStatus="connected" />);
    expect(screen.getByTestId("connection-status-connected")).toBeInTheDocument();
  });

  it("shows no connected indicator when offline", () => {
    render(<Sidebar {...defaultProps} connectionStatus="offline" />);
    expect(screen.queryByTestId("connection-status-connected")).not.toBeInTheDocument();
  });

  it("renders legacy sessions without worktreeId", () => {
    const session = makeSession({ worktreeId: null, sessionId: "legacy-1" });
    render(<Sidebar {...defaultProps} sessions={[session]} />);
    // Legacy session should be rendered via SessionItem
    expect(screen.getByTestId("session-item-legacy-1")).toBeInTheDocument();
  });
});
```

**Step 2: Run the test to verify it passes**

Run: `cd packages/client && pnpm vitest run src/components/layout/Sidebar.test.tsx`
Expected: All tests PASS

Note: The last test (`renders legacy sessions without worktreeId`) depends on `SessionItem` having `data-testid="session-item-{sessionId}"`. Check `packages/client/src/components/layout/SessionItem.tsx` — if it doesn't have this testid, add it.

**Step 3: Commit**

```bash
git add packages/client/src/components/layout/Sidebar.test.tsx
git commit -m "test: add Sidebar component tests"
```

---

### Task 6: Run full test suite and verify

**Step 1: Run all tests from root**

Run: `pnpm test`
Expected: All packages pass

**Step 2: Verify coverage outputs**

Run: `cd packages/sdk && pnpm vitest run --coverage 2>&1 | tail -20`
Expected: Coverage summary table visible

Run: `cd packages/client && pnpm vitest run --coverage 2>&1 | tail -20`
Expected: Coverage summary table visible

**Step 3: Final commit if any fixups needed**

```bash
git add -A
git commit -m "test: verify full test suite passes with coverage"
```
