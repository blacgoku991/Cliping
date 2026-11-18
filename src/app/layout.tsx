import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

const anton = localFont({ src: "../../assets/fonts/Anton-Regular.ttf", variable: "--font-anton", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Cliping — les meilleurs moments des lives, prêts à poster", template: "%s · Cliping" },
  description:
    "Cliping surveille tes streamers, capte leurs lives, repère les meilleurs moments et les monte en format vertical sous-titré. Tu n'as plus qu'à publier sur TikTok et YouTube Shorts.",
};

export const viewport: Viewport = { themeColor: "#0a0910", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={anton.variable}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
