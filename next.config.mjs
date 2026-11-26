/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "www.lidl.*" },
      { protocol: "https", hostname: "www.lidl.com.mt" },
    ],
  },
  experimental: {
    // Admin leaflet PDF uploads go through server actions; the default 1 MB
    // limit would reject multi-MB leaflets.
    serverActions: { bodySizeLimit: "80mb" },
  },
};

export default nextConfig;
