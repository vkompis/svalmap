/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // appDir is enabled by default in Next 14 app router; removing invalid key warning
  },
  transpilePackages: ['@svalmap/types', '@svalmap/ui', '@svalmap/config', 'maplibre-gl'],
  env: {
    MAP_BASE_URL: process.env.MAP_BASE_URL,
    MAP_ATTRIBUTION: process.env.MAP_ATTRIBUTION,
    NEXT_PUBLIC_MAP_STYLE: process.env.NEXT_PUBLIC_MAP_STYLE || '/styles/svalmap-dark.json',
    NEXT_PUBLIC_MAP_ATTRIBUTION: process.env.NEXT_PUBLIC_MAP_ATTRIBUTION || '© OpenStreetMap contributors',
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8787',
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
