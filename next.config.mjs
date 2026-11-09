/** @type {import('next').NextConfig} */
const nextConfig = {
  // Same-origin fallback for the public Squeekchain read API (used only if a direct browser request fails).
  async rewrites() {
    return [{ source: "/sq/:path*", destination: "https://api.squeekchain.com/:path*" }];
  },
};
export default nextConfig;
