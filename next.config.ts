import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pages read the SQLite store per request; keep the classic dynamic rendering model.
  cacheComponents: false,
};

export default nextConfig;
