import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DFR 区块链 · 供应链系统",
    short_name: "DFR供应链",
    description: "DFR 区块链供应链系统：单据存证与贸易订单管理平台",
    start_url: "/",
    display: "standalone",
    background_color: "#0B0C0A",
    theme_color: "#00E676",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
