import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Lidlr — Lidl EU price tracker",
    short_name: "Lidlr",
    description:
      "Track Lidl own-brand prices across EU shops in EUR: Parkside, Esmara, Crivit, Cien, SilverCrest, Livarno, Dentalux. Price history, weekly in-store deals, restock alerts.",
    start_url: "/products",
    display: "standalone",
    background_color: "#f0f4f9",
    theme_color: "#0b57d0",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
