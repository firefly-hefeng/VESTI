/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  transpilePackages: ["@vesti/ui"],
  experimental: {
    externalDir: true,
  },
}

export default nextConfig
