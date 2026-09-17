import type { NextConfig } from "next";

const allowedDevOrigins = [
  "localhost",
  "127.0.0.1",
  "192.168.50.21",
  /** Public dev hostname (reverse proxy / tunnel); remove if unused. */
  "helpdesk.agctek.co",
];
for (const envUrl of [process.env.NEXTAUTH_URL, process.env.APP_BASE_URL]) {
  if (!envUrl) continue;
  try {
    const parsed = new URL(envUrl);
    const host = parsed.host;
    const hostname = parsed.hostname;
    if (host && !allowedDevOrigins.includes(host)) allowedDevOrigins.push(host);
    if (hostname && !allowedDevOrigins.includes(hostname)) allowedDevOrigins.push(hostname);
  } catch {
    // Ignore malformed env URL values.
  }
}

const nextConfig: NextConfig = {
  allowedDevOrigins,
  serverExternalPackages: ["ioredis", "bullmq", "@socket.io/redis-adapter", "@socket.io/redis-emitter"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
    ],
  },
};

export default nextConfig;
