import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Умный заказ",
    short_name: "Умный заказ",
    description: "Умный заказ для работы с поставщиками, товарами и закупкой.",
    start_url: "/",
    display: "standalone",
    background_color: "#0f172a",
    theme_color: "#0f172a",
    icons: [
      {
        src: "/icon.png?v=2",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/apple-icon.png?v=2",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
