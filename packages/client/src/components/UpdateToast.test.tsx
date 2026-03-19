import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UpdateToast } from "@/components/UpdateToast";
import type { UpdateState, UpdateInfo, DownloadProgress } from "@/hooks/useAutoUpdate";

const defaultProgress: DownloadProgress = { downloaded: 0, total: 0 };

function renderToast(overrides: {
  state?: UpdateState;
  updateInfo?: UpdateInfo | null;
  progress?: DownloadProgress;
  error?: string | null;
  onDownload?: () => void;
  onInstall?: () => void;
  onDismiss?: () => void;
} = {}) {
  const props = {
    state: overrides.state ?? "idle" as UpdateState,
    updateInfo: overrides.updateInfo ?? null,
    progress: overrides.progress ?? defaultProgress,
    error: overrides.error ?? null,
    onDownload: overrides.onDownload ?? vi.fn(),
    onInstall: overrides.onInstall ?? vi.fn(),
    onDismiss: overrides.onDismiss ?? vi.fn(),
  };
  return render(<UpdateToast {...props} />);
}

const mockUpdateInfo: UpdateInfo = {
  version: "0.2.0",
  downloadUrl: "https://example.com/update.dmg",
  releaseNotes: "Bug fixes and improvements",
};

describe("UpdateToast", () => {
  afterEach(() => {
    cleanup();
  });

  it("returns null for idle state", () => {
    const { container } = renderToast({ state: "idle" });
    expect(container.innerHTML).toBe("");
  });

  it("returns null for checking state", () => {
    const { container } = renderToast({ state: "checking" });
    expect(container.innerHTML).toBe("");
  });

  it("shows version and Update/Later buttons for available state", () => {
    renderToast({ state: "available", updateInfo: mockUpdateInfo });
    expect(screen.getByText(/v0\.2\.0 available/)).toBeInTheDocument();
    expect(screen.getByText("Update")).toBeInTheDocument();
    expect(screen.getByText("Later")).toBeInTheDocument();
  });

  it("shows progress bar during downloading", () => {
    renderToast({
      state: "downloading",
      progress: { downloaded: 50, total: 100 },
    });
    expect(screen.getByText("Downloading update...")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  it("shows Install Now/Later buttons for ready state", () => {
    renderToast({ state: "ready" });
    expect(screen.getByText("Update ready to install")).toBeInTheDocument();
    expect(screen.getByText("Install Now")).toBeInTheDocument();
    expect(screen.getByText("Later")).toBeInTheDocument();
  });

  it("shows installing message for installing state", () => {
    renderToast({ state: "installing" });
    expect(screen.getByText("Installing update...")).toBeInTheDocument();
  });

  it("calls onDownload when Update button clicked", async () => {
    const onDownload = vi.fn();
    renderToast({ state: "available", updateInfo: mockUpdateInfo, onDownload });
    await userEvent.click(screen.getByText("Update"));
    expect(onDownload).toHaveBeenCalledOnce();
  });

  it("calls onInstall when Install Now button clicked", async () => {
    const onInstall = vi.fn();
    renderToast({ state: "ready", onInstall });
    await userEvent.click(screen.getByText("Install Now"));
    expect(onInstall).toHaveBeenCalledOnce();
  });

  it("calls onDismiss when Later button clicked (available state)", async () => {
    const onDismiss = vi.fn();
    renderToast({ state: "available", updateInfo: mockUpdateInfo, onDismiss });
    await userEvent.click(screen.getByText("Later"));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("calls onDismiss when X button clicked", async () => {
    const onDismiss = vi.fn();
    renderToast({ state: "available", updateInfo: mockUpdateInfo, onDismiss });
    // The X button is the one with the X icon, not the "Later" button
    const buttons = screen.getAllByRole("button");
    // The X close button is the last button (not Later or Update)
    const closeButton = buttons.find(
      (btn) => !btn.textContent?.includes("Later") && !btn.textContent?.includes("Update") && !btn.textContent?.includes("Release")
    );
    expect(closeButton).toBeTruthy();
    await userEvent.click(closeButton!);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("shows error message when error prop is set", () => {
    renderToast({
      state: "available",
      updateInfo: mockUpdateInfo,
      error: "Download failed",
    });
    expect(screen.getByText("Download failed")).toBeInTheDocument();
  });

  it("shows Release Notes button for available state", () => {
    renderToast({ state: "available", updateInfo: mockUpdateInfo });
    expect(screen.getByText("Release Notes")).toBeInTheDocument();
  });
});
