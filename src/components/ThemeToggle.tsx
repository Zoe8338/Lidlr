"use client";

import { useEffect, useState } from "react";

export function setThemeCookie(theme: "light" | "dark") {
  document.documentElement.dataset.theme = theme;
  document.cookie = `lidlr_theme=${theme}; path=/; max-age=31536000; samesite=lax`;
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    setTheme(current);
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    setThemeCookie(next);
  };

  return (
    <button type="button" className="button ghost theme-toggle" onClick={toggle} title="Toggle light/dark theme">
      {theme === "dark" ? "☀ Light" : "🌙 Dark"}
    </button>
  );
}
