import userEvent from "@testing-library/user-event";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RepositoryInfo, ServerConfig } from "@matrix/protocol";
import { SettingsPage } from "@/pages/SettingsPage";

const mockConnect = vi.fn();
const mockAddServer = vi.fn();
const mockRemoveServer = vi.fn();
const mockDeleteRepository = vi.fn();

const mockClient = {
  getServerConfig: vi.fn<() => Promise<ServerConfig>>().mockResolvedValue({
    reposPath: "~/repos",
    worktreesPath: "~/worktrees",
  }),
  updateServerConfig: vi.fn(),
};

vi.mock("@/hooks/useMatrixClient", () => ({
  useMatrixClient: () => ({
    client: mockClient,
    connect: mockConnect,
    connectionInfo: {
      serverUrl: "http://localhost:19880",
      token: "token",
    },
    status: "connected",
  }),
}));

vi.mock("@/hooks/useServerStore", () => ({
  useServerStore: () => ({
    servers: [],
    addServer: mockAddServer,
    removeServer: mockRemoveServer,
  }),
}));

vi.mock("@/hooks/useAutoUpdate", () => ({
  useAutoUpdate: () => ({
    state: "idle",
    updateInfo: null,
    checkForUpdate: vi.fn(),
    error: null,
    hasChecked: false,
    channel: "stable",
    setChannel: vi.fn(),
  }),
}));

vi.mock("@/lib/platform", () => ({
  hasLocalServer: () => true,
  isTauri: () => false,
  isMacOS: () => false,
  isMobilePlatform: () => false,
}));

vi.mock("@/components/ShareServerModal", () => ({
  ShareServerModal: () => null,
}));

vi.mock("@/components/repository/FileExplorerDialog", () => ({
  FileExplorerDialog: () => null,
}));

const repositories: RepositoryInfo[] = [
  {
    id: "repo-1",
    name: "claude",
    path: "/repos/claude",
    remoteUrl: "git@github.com:openai/claude.git",
    serverId: "server-1",
    defaultBranch: "main",
    createdAt: "2026-03-19T08:00:00.000Z",
  },
  {
    id: "repo-2",
    name: "fundi",
    path: "/repos/fundi",
    remoteUrl: null,
    serverId: "server-1",
    defaultBranch: "trunk",
    createdAt: "2026-03-19T08:00:00.000Z",
  },
];

describe("SettingsPage", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    mockDeleteRepository.mockReset();
  });

  it("renders a full-screen settings shell with sidebar navigation", () => {
    const onBack = vi.fn();
    const { container } = render(
      <SettingsPage onBack={onBack} repositories={repositories} onDeleteRepository={mockDeleteRepository} />,
    );

    expect(container.firstElementChild).toHaveClass("fixed", "inset-0", "z-50");
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /close settings/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "General" })).toBeInTheDocument();
    expect(screen.getByText("Repositories")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /claude/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /fundi/i })).toBeInTheDocument();
    expect(screen.getByText("Current Connection")).toBeInTheDocument();
  });

  it("shows repository details and deletes a repository after confirmation", async () => {
    const user = userEvent.setup();

    render(
      <SettingsPage onBack={vi.fn()} repositories={repositories} onDeleteRepository={mockDeleteRepository} />,
    );

    await user.click(screen.getByRole("button", { name: /fundi/i }));

    expect(screen.getByRole("heading", { name: "fundi" })).toBeInTheDocument();
    expect(screen.getByText("/repos/fundi")).toBeInTheDocument();
    expect(screen.getByText("trunk")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Repository" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete Repository" }));
    expect(screen.getByText("Are you sure you want to delete fundi?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(mockDeleteRepository).toHaveBeenCalledWith("repo-2", false);
    });
    expect(screen.getByText("Current Connection")).toBeInTheDocument();
  });
});
