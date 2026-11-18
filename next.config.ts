import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Les clips sont servis par nos propres routes (auth + Range) : pas d'optimisation d'image externe.
  images: { unoptimized: true },
  serverExternalPackages: ["@prisma/client"],
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default nextConfig;
