import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /** Évite de bundler le natif `better-sqlite3` pour les fonctions serverless (Vercel). */
  serverExternalPackages: ["better-sqlite3", "@prisma/adapter-better-sqlite3"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "i.ytimg.com", pathname: "/vi/**" },
      { protocol: "https", hostname: "img.youtube.com", pathname: "/vi/**" },
    ],
  },
};

export default nextConfig;
