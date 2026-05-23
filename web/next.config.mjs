import path from "path";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8001";
const configuredDevOrigins = (process.env.NEXT_ALLOWED_DEV_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const defaultAllowedDevOrigins = ["127.0.0.1", "localhost", "192.168.0.102"];
const isDev = process.env.NODE_ENV === "development";

function unique(values) {
  return [...new Set(values)];
}

function parseDevOriginEntry(entry) {
  try {
    const parsed = new URL(entry);
    return {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port,
      origin: parsed.origin,
    };
  } catch {
    return {
      protocol: null,
      hostname: entry,
      port: "",
      origin: null,
    };
  }
}

function buildDevConnectSources() {
  const sources = ["'self'"];
  let apiOrigin;
  let apiProtocol = "http:";
  let apiPort = "8001";

  try {
    const parsedApiUrl = new URL(apiBaseUrl);
    apiOrigin = parsedApiUrl.origin;
    apiProtocol = parsedApiUrl.protocol;
    apiPort = parsedApiUrl.port || (parsedApiUrl.protocol === "https:" ? "443" : "80");
  } catch {
    apiOrigin = "http://127.0.0.1:8001";
  }

  sources.push(apiOrigin);

  if (!isDev) {
    return unique(sources);
  }

  const devEntries = unique([...defaultAllowedDevOrigins, ...configuredDevOrigins])
    .map(parseDevOriginEntry);

  for (const entry of devEntries) {
    if (entry.origin) {
      sources.push(entry.origin);
      const wsProtocol = entry.protocol === "https:" ? "wss:" : "ws:";
      const devPort = entry.port || "3000";
      sources.push(`${wsProtocol}//${entry.hostname}:${devPort}`);
      continue;
    }

    if (!entry.hostname) {
      continue;
    }

    sources.push(`${apiProtocol}//${entry.hostname}:${apiPort}`);
    sources.push(`http://${entry.hostname}:3000`);
    sources.push(`ws://${entry.hostname}:3000`);
  }

  return unique(sources);
}

const connectSources = buildDevConnectSources();

const scriptSrc = isDev
  ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
  : "script-src 'self'";

/** @type {import("next").NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  distDir: isDev ? ".next-dev" : ".next",
  allowedDevOrigins: [...new Set([...defaultAllowedDevOrigins, ...configuredDevOrigins])],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; ${scriptSrc}; font-src 'self' data:; connect-src ${connectSources.join(" ")}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
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
