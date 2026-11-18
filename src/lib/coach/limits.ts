import type { SocialPlatform } from "@prisma/client";

/**
 * Limites de caractères utilisées par le coach pour générer et vérifier les textes.
 *
 * Vérifiées le 18 novembre 2026. Ce qui vient d'une page d'aide officielle est marqué `official: true` ;
 * le reste est la limite affichée par l'application et largement rapportée, mais absente des pages d'aide
 * que nous avons pu consulter. Quand l'application affiche une autre limite, c'est elle qui a raison.
 */
export interface Limit {
  max: number;
  min?: number;
  official: boolean;
  note?: string;
}

export interface PlatformLimits {
  label: string;
  bio: Limit;
  displayName: Limit;
  username: Limit;
  title: Limit;
  caption: Limit;
}

export const LIMITS: Record<SocialPlatform, PlatformLimits> = {
  TIKTOK: {
    label: "TikTok",
    bio: { max: 80, official: false, note: "compteur affiché dans l'app (Modifier le profil → Bio)" },
    displayName: { max: 30, official: false },
    username: { min: 2, max: 24, official: false, note: "lettres, chiffres, _ et . (pas de point à la fin) ; modifiable une fois tous les 30 jours" },
    // Le titre d'un clip sert de première ligne de légende sur TikTok.
    title: { max: 100, official: false, note: "première ligne de la légende" },
    caption: { max: 2200, official: false, note: "TikTok accepte davantage, mais seules les premières lignes sont visibles sans « plus »" },
  },
  YOUTUBE: {
    label: "YouTube",
    bio: { max: 1000, official: false, note: "description de la chaîne (onglet « À propos »)" },
    displayName: { max: 50, official: false, note: "nom de la chaîne ; reste court pour qu'il ne soit pas coupé" },
    username: { min: 3, max: 30, official: true, note: "@handle : lettres, chiffres, _ - et ." },
    title: { max: 100, official: true },
    caption: { max: 5000, official: true, note: "description de la vidéo" },
  },
};

/** Nombre de caractères tel que l'affichent les applications (un emoji = 1, pas 2 unités UTF-16). */
export function charCount(text: string): number {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    let n = 0;
    for (const _ of new Intl.Segmenter("fr", { granularity: "grapheme" }).segment(text)) n++;
    return n;
  }
  return [...text].length;
}

export function fits(text: string, limit: Limit): boolean {
  const n = charCount(text);
  return n <= limit.max && n >= (limit.min ?? 1);
}

/** Nom d'utilisateur TikTok valide : 2-24 caractères, a-z 0-9 _ ., pas de point final. */
export function sanitizeUsername(raw: string, platform: SocialPlatform): string | null {
  const lim = LIMITS[platform].username;
  let u = raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(platform === "TIKTOK" ? /[^a-z0-9_.]/g : /[^a-z0-9_.-]/g, "")
    .slice(0, lim.max);
  u = u.replace(/\.+$/, "");
  return u.length >= (lim.min ?? 1) ? u : null;
}
