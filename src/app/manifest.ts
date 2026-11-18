import type { MetadataRoute } from "next";

/** Rend Cliping installable sur l'écran d'accueil (iPhone, Android, ordinateur). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cliping",
    short_name: "Cliping",
    description: "Les meilleurs moments des lives, montés et prêts à poster.",
    lang: "fr",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0a0910",
    theme_color: "#0a0910",
    categories: ["entertainment", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Mode validation", short_name: "Valider", url: "/app/review", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Clips", url: "/app/clips", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
