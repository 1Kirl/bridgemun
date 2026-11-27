import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BridgeMUN",
    short_name: "BridgeMUN",
    description: "Model UN committees with classmates and AI delegations, run by an automatic chair.",
    start_url: "/",
    display: "standalone",
    background_color: "#fbfdff",
    theme_color: "#1580d8",
    icons: [
      { src: "/brand/bridgemun-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/bridgemun-512.png", sizes: "512x512", type: "image/png" },
      { src: "/brand/bridgemun-symbol.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
