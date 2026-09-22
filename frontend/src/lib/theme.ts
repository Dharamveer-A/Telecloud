import { useSyncExternalStore } from "react";

export type Theme = "dark" | "light";

const STORAGE_KEY = "telecloud_theme";

export function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as Theme | null;
    if (saved === "light" || saved === "dark") return saved;
  } catch (e) {}
  return "dark";
}

let currentTheme: Theme = getInitialTheme();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

export function applyThemeToDOM(theme: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  if (theme === "light") {
    root.classList.add("light");
    root.classList.remove("dark");
    root.style.colorScheme = "light";
    if (document.body) {
      document.body.classList.add("light");
      document.body.classList.remove("dark");
    }
  } else {
    root.classList.add("dark");
    root.classList.remove("light");
    root.style.colorScheme = "dark";
    if (document.body) {
      document.body.classList.add("dark");
      document.body.classList.remove("light");
    }
  }
}

export function setTheme(theme: Theme) {
  currentTheme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch (e) {}
  applyThemeToDOM(theme);
  notify();
}

export function toggleTheme(): Theme {
  const next: Theme = currentTheme === "dark" ? "light" : "dark";
  setTheme(next);
  return next;
}

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

function getSnapshot(): Theme {
  return currentTheme;
}

function getServerSnapshot(): Theme {
  return "dark";
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY && (event.newValue === "light" || event.newValue === "dark")) {
      currentTheme = event.newValue as Theme;
      applyThemeToDOM(currentTheme);
      notify();
    }
  });
  // Ensure DOM is styled immediately on module load
  applyThemeToDOM(currentTheme);
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { theme, toggle: toggleTheme, setTheme };
}
