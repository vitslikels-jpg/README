import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Цитадель Прайсы",
  description: "Базовый каркас приложения для работы с предприятиями.",
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
