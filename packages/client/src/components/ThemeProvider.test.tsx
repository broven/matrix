import { describe, expect, it } from "vitest";
import { applyThemeClass } from "@/components/ThemeProvider";

describe("applyThemeClass", () => {
  it("toggles the dark class on the document element", () => {
    document.documentElement.classList.remove("dark");

    applyThemeClass("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    applyThemeClass("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
