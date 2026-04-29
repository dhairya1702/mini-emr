import path from "path";

/** @type {import("next").NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
