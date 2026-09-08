/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/app/**/*.{js,jsx,ts,tsx}", "./src/components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      // ─── Material 3 Expressive token upgrade, 2026-09-08 ────────────────
      // [decision, docs/MOBILE_MIGRATION_PLAN.md -> M3 Expressive restyle]
      // Keeps every existing key name (felt.bg/surface/surface-2/border,
      // gold.DEFAULT/light/dark) so every ported `bg-felt-surface`,
      // `text-gold-light`, etc. className across all 8 screens resolves
      // unchanged — this is deliberately a palette swap, not a class-name
      // rename, so the highest-leverage, lowest-risk way to make the whole
      // app bolder is to redefine the VALUES here rather than touch every
      // screen's JSX. New keys (felt.surface-3/4, felt.outline, gold.vivid,
      // mint.*, bloom.*) are additive — nothing existing had to change to
      // make room for them.
      //
      // Real M3 color-role thinking, not just "make it brighter": primary
      // (gold) got genuinely bolder/more saturated; secondary (mint, new)
      // and tertiary (bloom, new) are real M3 roles this app never had
      // before — a felt/gold-only palette isn't actually M3, M3 is built
      // around three distinct accent hues plus a neutral surface family
      // with multiple elevation tiers, which felt.surface-3/4 add here.
      // Tones are hand-generated at roughly M3's 0/10/20/30/40/50/60/70/80
      // tone-scale positions (HSL, not true HCT — close enough for a bold
      // dark-theme app, not lab-verified color science).
      colors: {
        felt: {
          bg: "#0a0f0c",
          surface: "#121b16",
          "surface-2": "#182620",
          "surface-3": "#2e3833", // NEW — surfaceContainerHigh: dialogs, sheets, elevated cards
          "surface-4": "#39463f", // NEW — surfaceContainerHighest: the most-elevated bits (FAB-style CTAs)
          border: "#24352c",
          outline: "#4d6658", // NEW — bolder outline for emphasis borders/active states (felt.border stays the quiet default)
        },
        gold: {
          // Primary. Bolder/richer than the old #caa043 (M3 tone ~40 vs the
          // old muted ~50-ish custom value) — still safe with white text on
          // a filled button at bold weight, unlike the more vivid tones
          // below which need a dark foreground and are used deliberately
          // (avatars, badges, highlights) rather than swept into every
          // existing `bg-gold` + `text-white` button pairing.
          DEFAULT: "#b68616",
          light: "#f4dca4", // accent text/icons on dark surfaces — brighter than before
          dark: "#71540e", // subtle overlay (the locked-buy-in bar under BuyinSlider)
          vivid: "#e3a71c", // NEW — the genuinely bold/saturated tone, for accents paired with dark text
        },
        // NEW — secondary role (M3's second accent hue). A felt/gold-only
        // palette isn't really Material 3; this is the actual second color
        // the design system calls for, not just a green that happens to
        // already exist as the background tint.
        mint: {
          DEFAULT: "#3b9169",
          light: "#b7e1cd",
          container: "#1e4834",
        },
        // NEW — tertiary role (M3's third, most "expressive" accent hue).
        // A deliberate pop of color distinct from both gold and mint —
        // used sparingly (active-tab indicators, medals/highlights, the
        // odd badge) so it reads as an accent, not a third primary.
        bloom: {
          DEFAULT: "#a52777",
          light: "#ecacd4",
          container: "#53133b",
        },
      },
    },
  },
  plugins: [],
}
