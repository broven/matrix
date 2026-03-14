import { useEffect, type ReactNode } from "react";

export function applyThemeClass(theme: "dark" | "light") {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

function getSystemTheme() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    applyThemeClass(getSystemTheme());

    const onChange = (event: MediaQueryListEvent) => {
      applyThemeClass(event.matches ? "dark" : "light");
    };

    mediaQuery.addEventListener("change", onChange);

    return () => {
      mediaQuery.removeEventListener("change", onChange);
    };
  }, []);

  return children;
}
