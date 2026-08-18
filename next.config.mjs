/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // The screener index is a large JSON file loaded server-side only.
    largePageDataBytes: 512 * 1024,
  },
};

export default nextConfig;
