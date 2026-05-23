import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["bcrypt"],
  experimental: {
    proxyClientMaxBodySize: "25mb",
  },
};

export default nextConfig;
