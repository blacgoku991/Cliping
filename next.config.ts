import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // En développement, le site est aussi ouvert via 127.0.0.1 (tests Playwright) et pas seulement localhost.
  allowedDevOrigins: ["127.0.0.1"],
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
