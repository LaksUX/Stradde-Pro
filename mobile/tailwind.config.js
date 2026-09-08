/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/app/**/*.{js,jsx,ts,tsx}", "./src/components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      // Mirrors the web app's "casino felt" theme tokens (src/index.css on
      // the web side) so screens ported from App.jsx keep a consistent look.
      colors: {
        felt: {
          bg: "#0a0f0c",
          surface: "#121b16",
          surface2: "#182620",
          border: "#24352c",
        },
        gold: {
          DEFAULT: "#caa043",
          light: "#e0bb5c",
          dark: "#a9822f",
        },
      },
    },
  },
  plugins: [],
}
