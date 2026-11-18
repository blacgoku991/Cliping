export type SourcePlatformName = "TWITCH" | "KICK" | "YOUTUBE" | "OTHER";

export interface ParsedSource {
  platform: SourcePlatformName;
  /** Identifiant normalisé de la chaîne */
  login: string;
  /** URL passée à streamlink pour capter le live */
  url: string;
  displayName: string;
}

const RESERVED_TWITCH = new Set(["videos", "directory", "settings", "p", "downloads", "jobs", "turbo", "search"]);

function toUrl(input: string): URL | null {
  const raw = input.trim();
  if (!raw) return null;
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
}

/**
 * Transforme ce que l'utilisateur colle (URL de chaîne, ou simple pseudo + plateforme)
 * en source surveillable. Renvoie null si l'entrée n'est pas exploitable.
 */
export function parseChannel(input: string, fallbackPlatform: SourcePlatformName = "TWITCH"): ParsedSource | null {
  const raw = input.trim();
  if (!raw) return null;

  // Simple pseudo sans domaine : on s'appuie sur la plateforme choisie.
  if (/^@?[a-zA-Z0-9_.-]{2,40}$/.test(raw) && !raw.includes(".")) {
    const name = raw.replace(/^@/, "");
    if (fallbackPlatform === "TWITCH") return twitch(name);
    if (fallbackPlatform === "KICK") return kick(name);
    if (fallbackPlatform === "YOUTUBE") return youtube(`@${name}`);
    return null;
  }

  const u = toUrl(raw);
  if (!u || !/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.replace(/^(www|m|go)\./, "").toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean);

  if (host === "twitch.tv") {
    const name = parts[0];
    if (!name || RESERVED_TWITCH.has(name.toLowerCase()) || !/^[a-zA-Z0-9_]{2,25}$/.test(name)) return null;
    return twitch(name);
  }
  if (host === "kick.com") {
    const name = parts[0];
    if (!name || !/^[a-zA-Z0-9_-]{2,40}$/.test(name) || ["video", "categories"].includes(name.toLowerCase())) return null;
    return kick(name);
  }
  if (host === "youtube.com") {
    const first = parts[0];
    if (!first) return null;
    if (first.startsWith("@")) return youtube(first);
    if ((first === "channel" || first === "c" || first === "user") && parts[1]) return youtube(`${first}/${parts[1]}`);
    return null;
  }
  // Tout autre flux lisible par streamlink (HLS direct, etc.)
  return {
    platform: "OTHER",
    login: `${host}${u.pathname}`.replace(/[^a-zA-Z0-9._/-]/g, "").slice(0, 120),
    url: u.toString(),
    displayName: host,
  };
}

function twitch(name: string): ParsedSource {
  const login = name.toLowerCase();
  return { platform: "TWITCH", login, url: `https://www.twitch.tv/${login}`, displayName: name };
}

function kick(name: string): ParsedSource {
  const login = name.toLowerCase();
  return { platform: "KICK", login, url: `https://kick.com/${login}`, displayName: name };
}

function youtube(pathPart: string): ParsedSource {
  const display = pathPart.startsWith("@") ? pathPart.slice(1) : (pathPart.split("/")[1] ?? pathPart);
  return {
    platform: "YOUTUBE",
    login: pathPart.toLowerCase(),
    url: `https://www.youtube.com/${pathPart}/live`,
    displayName: display,
  };
}

/** Lien affiché en crédit sur le clip (« twitch.tv/pseudo »). */
export function creditLabel(platform: SourcePlatformName, login: string, displayName: string): string {
  if (platform === "TWITCH") return `twitch.tv/${login}`;
  if (platform === "KICK") return `kick.com/${login}`;
  if (platform === "YOUTUBE") return login.startsWith("@") ? `youtube.com/${login}` : `YouTube · ${displayName}`;
  return displayName;
}

/** Vrai si la catégorie du live correspond au filtre (liste séparée par des virgules, insensible à la casse). */
export function matchesGameFilter(filter: string, category: string | null | undefined, title?: string | null): boolean {
  const wanted = filter
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (wanted.length === 0) return true;
  const cat = (category ?? "").trim().toLowerCase();
  // Correspondance exacte sur la catégorie : « Grand Theft Auto VI » ne doit pas matcher « Grand Theft Auto V ».
  if (cat) return wanted.some((w) => cat === w);
  // Plateformes sans catégorie (YouTube) : on se rabat sur le titre du live.
  const t = (title ?? "").toLowerCase();
  return wanted.some((w) => t.includes(w));
}

export function isHttpUrl(input: string): boolean {
  const u = toUrl(input);
  return !!u && /^https?:$/.test(u.protocol) && u.hostname.includes(".");
}
