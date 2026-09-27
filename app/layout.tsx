import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenKTV · 今晚开唱",
  description: "适合家庭与聚会场景的 Web 点歌台。",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
