/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        ink: "rgb(var(--color-ink) / <alpha-value>)",
        surface: "rgb(var(--color-surface) / <alpha-value>)",
        surface2: "rgb(var(--color-surface2) / <alpha-value>)",
        line: "rgb(var(--color-line) / <alpha-value>)",
        paper: "rgb(var(--color-paper) / <alpha-value>)",
        dim: "rgb(var(--color-dim) / <alpha-value>)",
        brass: "rgb(var(--color-brass) / <alpha-value>)",
        teal: "rgb(var(--color-teal) / <alpha-value>)",
        danger: "rgb(var(--color-danger) / <alpha-value>)",
      },
      fontFamily: {
        display: ["Newsreader", "serif"],
        body: ["Inter", "sans-serif"],
      },
    },
  },
  plugins: [],
};
