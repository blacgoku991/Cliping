/**
 * Hôtes vers lesquels le serveur accepte d'aller chercher de la vidéo.
 * Sans cette liste, n'importe quel utilisateur pourrait faire interroger au worker
 * une adresse du réseau interne (SSRF) en la collant dans « Importer une vidéo ».
 * Seuls des noms de domaine publics sont listés (sous-domaines compris : clips.twitch.tv,
 * vm.tiktok.com…) ; jamais d'adresse IP ni de port explicite.
 */
const DEFAULT_HOSTS = ["twitch.tv", "youtube.com", "youtu.be", "kick.com", "tiktok.com"];

function extraHosts(): string[] {
  return (process.env.EXTRA_SOURCE_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedSourceUrl(input: string): boolean {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  const extras = extraHosts();
  // Hôtes ajoutés explicitement par l'administrateur (ex. serveur de fichiers local pour les tests).
  if (extras.includes(host) || extras.includes(u.host.toLowerCase())) return true;
  if (u.protocol !== "https:") return false;
  // Un port explicite n'a rien à faire sur ces plateformes.
  if (u.port) return false;
  return DEFAULT_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/**
 * Forme canonique d'un lien avant de le passer à yt-dlp : certains extracteurs
 * n'acceptent que « www.tiktok.com » (pas « tiktok.com » ni « m.tiktok.com »).
 */
export function normalizeSourceUrl(input: string): string {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return input.trim();
  }
  const host = u.hostname.toLowerCase();
  if ((host === "tiktok.com" || host === "m.tiktok.com") && /^\/@[^/]+\/video\/\d+/.test(u.pathname)) {
    u.hostname = "www.tiktok.com";
    u.search = "";
  }
  if (host === "youtube.com" || host === "m.youtube.com") u.hostname = "www.youtube.com";
  return u.toString();
}

export function allowedHostsLabel(): string {
  return ["Twitch", "YouTube", "Kick", "TikTok", ...extraHosts()].join(", ");
}
