import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Chrome — deep, cool, desaturated. Reads as night shift, not "dark mode".
        chrome: { 900: "#0D1319", 800: "#151E27", 700: "#1F2C38", 600: "#2C3D4D" },
        // Content
        ink: { DEFAULT: "#0F1720", muted: "#576672", faint: "#8B98A5" },
        line: { DEFAULT: "#E3E8ED", strong: "#CBD4DD" },
        shell: "#F1F4F7",
        // Single accent: brass. Hotel key tags, bell pulls, door numbers.
        brass: { DEFAULT: "#B4813C", light: "#E8D7B8", wash: "#FBF6EC" },
        // Legacy tokens kept so existing pages compile unchanged
        nav: { DEFAULT: "#1F2C38", dark: "#151E27", light: "#2C3D4D" },
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
        card: "0 1px 2px rgba(15,23,32,0.05), 0 1px 1px rgba(15,23,32,0.03)",
        lift: "0 8px 24px -6px rgba(15,23,32,0.16)",
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
