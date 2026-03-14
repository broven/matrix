import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PermissionCard } from "@/components/PermissionCard";

describe("PermissionCard", () => {
  it("renders each server option and collapses after selection", () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();

    render(
      <PermissionCard
        request={{
          toolCallId: "tool-1",
          toolCall: {
            title: "Write file",
            kind: "edit",
            status: "pending",
            content: [{ type: "text", text: "Update src/app.ts" }],
          },
          options: [
            { optionId: "allow-once", name: "Allow Once", kind: "allow_once" },
            { optionId: "deny", name: "Deny", kind: "reject_once" },
          ],
        }}
        onApprove={onApprove}
        onReject={onReject}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Allow Once" }));

    expect(onApprove).toHaveBeenCalledWith("tool-1", "allow-once");
    expect(onReject).not.toHaveBeenCalled();
    expect(screen.getByText("Allowed: Allow Once")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Allow Once" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Deny" })).toBeNull();
  });
});
