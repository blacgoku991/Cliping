import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

const anton = localFont({ src: "../../assets/fonts/Anton-Regular.ttf", variable: "--font-anton", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Cliping — les meilleurs moments des lives, prêts à poster", template: "%s · Cliping" },
  description:
    "Cliping surveille tes streamers, capte leurs lives, repère les meilleurs moments et les monte en format vertical sous-titré. Tu n'as plus qu'à publier sur TikTok et YouTube Shorts.",
  applicationName: "Cliping",
  // Installée sur l'écran d'accueil de l'iPhone : plein écran, barre d'état transparente sur fond sombre.
  appleWebApp: { capable: true, title: "Cliping", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
  // Next n'émet plus que la balise standard ; les iOS plus anciens attendent encore celle-ci.
  other: { "apple-mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = { themeColor: "#0a0910", width: "device-width", initialScale: 1, viewportFit: "cover", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={anton.variable}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
