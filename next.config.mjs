/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allow self-hosted uploaded images served from /api/uploads and remote covers.
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
  output: "standalone",
  experimental: {
    // Keep server-only packages (ioredis, nodemailer, prisma) out of the client bundle.
    serverComponentsExternalPackages: ["ioredis", "nodemailer", "@prisma/client", "bcryptjs"],
  },
};

export default nextConfig;
