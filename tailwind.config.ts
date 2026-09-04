import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Chrome. Deep navy, drawn from the Reservation Centric wordmark but
        // taken darker so white nav text clears 16:1. The logo navy #003965
        // sits at 11.8:1 and drops the muted /60 links to about 5:1, which is
        // too close to the floor for a screen read at a front desk.
        chrome: {
          900: "#08203A",
          800: "#0E2C4D",
          700: "#153B63",
          600: "#1F4F80",
},

        // Content
        ink: { DEFAULT: "#0F1B2A", muted: "#546578", faint: "#8A99A9" },
        line: { DEFAULT: "#E2E8F0", strong: "#C9D5E2" },
        shell: "#F4F7FB",

        // Accent on light content only. Revenue line, key figures, links.
        // This is the same blue as chrome-900, so it must never be used as a
        // marker sitting on chrome. Those markers are white now.
        brass: {
          DEFAULT: "#1D6FE0",
          light: "#BBD6F7",
          wash: "#EFF6FF",
        },

        // Brand reference. Marketing surfaces, login screen, printed folios.
        brand: { cyan: "#009FEA", navy: "#003965" },

        // Carries two statuses that never appear on the same object: due-out
        // rooms on the house board, and pending bookings in the bookings list.
        // `deep` is the text shade. DEFAULT on `wash` is only ~3:1, which is
        // unreadable at the 10.5px badge size.
        warn: {
          DEFAULT: "#D97706",
          deep: "#92400E",
          light: "#FBDCA9",
          wash: "#FEF7EC",
        },

        // Legacy tokens kept so existing pages compile unchanged
        nav: { DEFAULT: "#153B63", dark: "#0E2C4D", light: "#1F4F80" },
      },

      fontFamily: {
        sans: ["var(--font-body)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "system-ui", "sans-serif"],
      },
      fontSize: {
        xxs: ["10.5px", "14px"],
        "2xs": ["11.5px", "16px"],
      },
      letterSpacing: { tightest: "-0.03em" },
      boxShadow: {
        card: "0 1px 2px rgba(8,32,58,0.06), 0 1px 1px rgba(8,32,58,0.04)",
        lift: "0 8px 24px -6px rgba(8,32,58,0.18)",
      },
      keyframes: {
        rise: {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "none" },
        },
      },
      animation: { rise: "rise .32s cubic-bezier(.2,.7,.3,1) both" },
    },
  },
  plugins: [],
} satisfies Config;
