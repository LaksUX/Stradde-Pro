/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/app/**/*.{js,jsx,ts,tsx}", "./src/components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      // Mirrors the web app's "casino felt" theme tokens (src/index.css's
      // @theme block: --color-felt-surface-2, etc.) so classNames ported
      // from App.jsx resolve unchanged. Key names match the web tokens
      // exactly (e.g. "surface-2", not "surface2") for that reason — don't
      // rename these without checking every ported `bg-felt-surface-2` etc.
      // className still resolves.
      colors: {
        felt: {
          bg: "#0a0f0c",
          surface: "#121b16",
          "surface-2": "#182620",
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
