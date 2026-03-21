import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useFileMention } from "@/hooks/useFileMention";

const files = [
  "src/main.ts",
  "src/app.tsx",
  "src/components/Button.tsx",
  "package.json",
  "README.md",
];

function makeFetchFiles(fileList: string[] = files) {
  return vi.fn((query: string) => {
    if (!query) return Promise.resolve(fileList.slice(0, 50));
    return Promise.resolve(fileList.filter((f) => f.toLowerCase().includes(query)));
  });
}

describe("useFileMention", () => {
  it("is not open when text has no @", () => {
    const fetchFiles = makeFetchFiles();
    const { result } = renderHook(() =>
      useFileMention({ fetchFiles, text: "hello", cursorPos: 5 }),
    );
    expect(result.current.isOpen).toBe(false);
  });

  it("opens when @ is typed at start", async () => {
    const fetchFiles = makeFetchFiles();
    const { result } = renderHook(() =>
      useFileMention({ fetchFiles, text: "@", cursorPos: 1 }),
    );
    await waitFor(() => {
      expect(result.current.isOpen).toBe(true);
      expect(result.current.filtered.length).toBeGreaterThan(0);
    });
  });

  it("opens when @ is preceded by whitespace", async () => {
    const fetchFiles = makeFetchFiles();
    const { result } = renderHook(() =>
      useFileMention({ fetchFiles, text: "look at @", cursorPos: 9 }),
    );
    await waitFor(() => {
      expect(result.current.isOpen).toBe(true);
    });
  });

  it("does not open when @ is inside a word", () => {
    const fetchFiles = makeFetchFiles();
    const { result } = renderHook(() =>
      useFileMention({ fetchFiles, text: "email@", cursorPos: 6 }),
    );
    expect(result.current.isOpen).toBe(false);
  });

  it("filters files by query", async () => {
    const fetchFiles = makeFetchFiles();
    const { result } = renderHook(() =>
      useFileMention({ fetchFiles, text: "@main", cursorPos: 5 }),
    );
    await waitFor(() => {
      expect(result.current.isOpen).toBe(true);
      expect(result.current.filtered).toEqual(["src/main.ts"]);
    });
  });

  it("closes when space is typed after query", () => {
    const fetchFiles = makeFetchFiles();
    const { result } = renderHook(() =>
      useFileMention({ fetchFiles, text: "@main ", cursorPos: 6 }),
    );
    expect(result.current.isOpen).toBe(false);
  });

  it("returns empty when no files match", async () => {
    const fetchFiles = makeFetchFiles();
    const { result } = renderHook(() =>
      useFileMention({ fetchFiles, text: "@zzzzz", cursorPos: 6 }),
    );
    await waitFor(() => {
      expect(result.current.isOpen).toBe(false);
      expect(result.current.filtered).toEqual([]);
    });
  });
});
