import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Image Docker : serveur autonome minimal (activé par le Dockerfile).
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  // Les vidéos et les tests n'ont rien à faire dans le serveur autonome.
  outputFileTracingExcludes: { "*": ["data/**", "tests/**"] },
  // Les clips sont servis par nos propres routes (auth + Range) : pas d'optimisation d'image externe.
  images: { unoptimized: true },
  serverExternalPackages: ["@prisma/client"],
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default nextConfig;
