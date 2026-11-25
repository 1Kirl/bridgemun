import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev only: lets a second browser context on 127.0.0.1 load dev assets (multi-user testing).
  allowedDevOrigins: ['127.0.0.1'],
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
