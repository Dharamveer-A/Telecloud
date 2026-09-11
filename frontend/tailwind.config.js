/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#14171C",
        surface: "#1C2029",
        surface2: "#242935",
        line: "#2E3542",
        paper: "#E8E6DF",
        dim: "#8B93A3",
        brass: "#C9A24B",
        teal: "#4FA3A0",
        danger: "#C4634F",
      },
      fontFamily: {
        display: ["Newsreader", "serif"],
        body: ["Inter", "sans-serif"],
      },
    },
  },
  plugins: [],
};
