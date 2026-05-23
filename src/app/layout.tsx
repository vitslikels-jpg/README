import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Умный заказ",
  description: "Умный заказ для работы с поставщиками, товарами и закупкой.",
  applicationName: "Умный заказ",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/icon.png", type: "image/png", sizes: "512x512" }],
    apple: [{ url: "/apple-icon.png", type: "image/png", sizes: "180x180" }],
    shortcut: ["/icon.png"],
  },
  appleWebApp: {
    capable: true,
    title: "Умный заказ",
    statusBarStyle: "black-translucent",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
