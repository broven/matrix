import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useFileMention } from "@/hooks/useFileMention";

const files = [
  "src/main.ts",
  "src/app.tsx",
  "src/components/Button.tsx",
  "package.json",
  "README.md",
];

describe("useFileMention", () => {
  it("is not open when text has no @", () => {
    const { result } = renderHook(() =>
      useFileMention({ files, text: "hello", cursorPos: 5 }),
    );
    expect(result.current.isOpen).toBe(false);
  });

  it("opens when @ is typed at start", () => {
    const { result } = renderHook(() =>
      useFileMention({ files, text: "@", cursorPos: 1 }),
    );
    expect(result.current.isOpen).toBe(true);
    expect(result.current.filtered.length).toBeGreaterThan(0);
  });

  it("opens when @ is preceded by whitespace", () => {
    const { result } = renderHook(() =>
      useFileMention({ files, text: "look at @", cursorPos: 9 }),
    );
    expect(result.current.isOpen).toBe(true);
  });

  it("does not open when @ is inside a word", () => {
    const { result } = renderHook(() =>
      useFileMention({ files, text: "email@", cursorPos: 6 }),
    );
    expect(result.current.isOpen).toBe(false);
  });

  it("filters files by query", () => {
    const { result } = renderHook(() =>
      useFileMention({ files, text: "@main", cursorPos: 5 }),
    );
    expect(result.current.isOpen).toBe(true);
    expect(result.current.filtered).toEqual(["src/main.ts"]);
  });

  it("closes when space is typed after query", () => {
    const { result } = renderHook(() =>
      useFileMention({ files, text: "@main ", cursorPos: 6 }),
    );
    expect(result.current.isOpen).toBe(false);
  });

  it("returns empty when no files match", () => {
    const { result } = renderHook(() =>
      useFileMention({ files, text: "@zzzzz", cursorPos: 6 }),
    );
    expect(result.current.isOpen).toBe(false);
    expect(result.current.filtered).toEqual([]);
  });
});
