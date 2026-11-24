/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "www.lidl.*" },
      { protocol: "https", hostname: "www.lidl.com.mt" },
    ],
  },
};

export default nextConfig;
