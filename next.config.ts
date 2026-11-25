import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev only: lets a second browser context on 127.0.0.1 load dev assets (multi-user testing).
  allowedDevOrigins: ['127.0.0.1'],
  // Position material sets are read from disk at runtime; ship them with every server function.
  outputFileTracingIncludes: {
    '/api/**/*': ['./data/positions/**/*.json'],
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'flagcdn.com',
      },
      {
        protocol: 'https',
        hostname: 'upload.wikimedia.org',
      },
    ],
  },
};

export default nextConfig;
