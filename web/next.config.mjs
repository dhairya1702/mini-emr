import path from "path";

/** @type {import("next").NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
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
