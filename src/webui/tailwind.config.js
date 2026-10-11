/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./App.svelte",
    "./main.ts",
    "./components/**/*.{svelte,ts}",
    "./stores/**/*.ts",
    "./types/**/*.ts",
    "./utils/**/*.ts",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: "#eff6ff",
          100: "#dbeafe",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
        },
        success: {
          light: "#dcfce7",
          DEFAULT: "#22c55e",
          dark: "#15803d",
        },
        error: {
          light: "#fee2e2",
          DEFAULT: "#ef4444",
          dark: "#b91c1c",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
    },
  },
  plugins: [],
  darkMode: false, // Light theme only
};
