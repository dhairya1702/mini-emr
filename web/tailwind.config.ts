import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#f6fbff",
        panel: "#ffffff",
        panelSoft: "#edf7ff",
        line: "#d7e9f7",
        accent: "#67b7ff",
        accentSoft: "#dff0ff",
        text: "#12304a",
        muted: "#6f8ca5",
        done: "#4f9cf7",
        warn: "#f0b44c",
      },
      boxShadow: {
        panel: "0 18px 50px rgba(80, 138, 194, 0.12)",
      },
      backgroundImage: {
        grid: "linear-gradient(rgba(103,183,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(103,183,255,0.08) 1px, transparent 1px)",
      },
    },
  },
  plugins: [],
};

export default config;
