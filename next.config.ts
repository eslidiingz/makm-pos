import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Lets this specific iPad access dev-only Next.js assets over the local network.
  allowedDevOrigins: ['192.168.1.41'],
  reactStrictMode: true,
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      ],
    }]
  },
}

export default nextConfig
