/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // MTG mana colors
        mana: {
          w: "#f9faf4",   // White
          u: "#0e68ab",   // Blue
          b: "#150b00",   // Black
          r: "#d3202a",   // Red
          g: "#00733e",   // Green
          c: "#ccc2c0",   // Colorless
          gold: "#c7b23a", // Multicolor/Gold
        },
        // App theme
        surface: {
          DEFAULT: "#1a1a2e",
          card: "#16213e",
          elevated: "#0f3460",
          input: "#1e2a3a",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
