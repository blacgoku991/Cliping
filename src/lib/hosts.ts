/**
 * Hôtes vers lesquels le serveur accepte d'aller chercher de la vidéo.
 * Sans cette liste, n'importe quel utilisateur pourrait faire interroger au worker
 * une adresse du réseau interne (SSRF) en la collant dans « Importer une VOD ».
 */
const DEFAULT_HOSTS = ["twitch.tv", "clips.twitch.tv", "youtube.com", "youtu.be", "kick.com"];

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
  if (extras.includes(host) || extras.includes(u.host.toLowerCase())) return true;
  if (u.protocol !== "https:") return false;
  return DEFAULT_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

export function allowedHostsLabel(): string {
  return ["Twitch", "YouTube", "Kick", ...extraHosts()].join(", ");
}
