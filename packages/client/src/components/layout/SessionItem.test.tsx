import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "@matrix/protocol";
import { SessionItem } from "@/components/layout/SessionItem";

const session: SessionInfo = {
  sessionId: "sess-1",
  agentId: "claude",
  cwd: "/tmp/workspace",
  createdAt: "2026-03-19T08:00:00.000Z",
  status: "active",
  recoverable: true,
  agentSessionId: "agent-1",
  lastActiveAt: "2026-03-19T08:00:00.000Z",
  suspendedAt: null,
  closeReason: null,
  worktreeId: null,
  repositoryId: null,
  branch: null,
};

describe("SessionItem", () => {
  it("keeps the delete button always visible", () => {
    render(
      <SessionItem
        session={session}
        selected={false}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const deleteButton = screen.getByLabelText("Delete session");

    expect(deleteButton).not.toHaveClass("opacity-0");
    expect(deleteButton).not.toHaveClass("group-hover:opacity-100");
  });
});
