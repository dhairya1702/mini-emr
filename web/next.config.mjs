import path from "path";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8001";
let connectSources = ["'self'"];
try {
  connectSources.push(new URL(apiBaseUrl).origin);
} catch {
  connectSources.push("http://127.0.0.1:8001", "http://localhost:8001");
}

/** @type {import("next").NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:; connect-src ${connectSources.join(" ")}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
        ],
      },
    ];
  },
  webpack: (config, { dev }) => {
    if (dev) {
      config.resolve.alias = {
        ...(config.resolve.alias || {}),
        "next/dist/next-devtools/userspace/app/segment-explorer-node": path.resolve(
          "./lib/next-segment-explorer-stub.js",
        ),
      };
    }
    return config;
  },
};

export default nextConfig;
