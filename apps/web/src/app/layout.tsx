import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Faz 7.4 — create-next-app'ten kalan "Create Next App" başlığı
// değiştirildi (tarayıcı sekmesinde görünüyordu).
export const metadata: Metadata = {
  title: "Feedback & Roadmap Platform",
  description:
    "Multi-tenant geri bildirim panosu, roadmap ve gömülebilir widget.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="tr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
