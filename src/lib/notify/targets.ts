/**
 * Adresses vers lesquelles le serveur envoie des notifications. Toutes sont fournies par l'utilisateur
 * (ou par son navigateur pour le Web Push) : sans liste d'hôtes, on pourrait faire envoyer au serveur
 * des requêtes vers le réseau interne (SSRF), comme pour les imports de vidéos (src/lib/hosts.ts).
 * Seuls des noms de domaine publics connus sont acceptés, en HTTPS, sans port ni identifiants.
 * Module pur.
 */

/** Services de push des navigateurs (Apple, Google/Chrome/Edge Android, Mozilla, Microsoft). */
const PUSH_HOSTS = ["push.apple.com", "fcm.googleapis.com", "push.services.mozilla.com", "notify.windows.com"];
const NTFY_HOSTS = ["ntfy.sh"];
const DISCORD_HOSTS = ["discord.com", "discordapp.com", "ptb.discord.com", "canary.discord.com"];

/** Serveurs ntfy auto-hébergés ajoutés par l'administrateur (NOTIFY_EXTRA_HOSTS, séparés par des virgules). */
function extraHosts(): string[] {
  return (process.env.NOTIFY_EXTRA_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

function parseHttps(input: string, { allowExtra }: { allowExtra: boolean }): URL | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.username || u.password) return null;
  // Hôtes de l'administrateur : seul cas où http:// et un port sont admis (serveur ntfy local, banc d'essai).
  if (allowExtra) {
    const extras = extraHosts();
    if (extras.includes(u.host.toLowerCase()) || extras.includes(u.hostname.toLowerCase())) {
      return u.protocol === "https:" || u.protocol === "http:" ? u : null;
    }
  }
  if (u.protocol !== "https:" || u.port) return null;
  return u;
}

function hostMatches(host: string, list: string[]): boolean {
  const h = host.toLowerCase();
  return list.some((d) => h === d || h.endsWith(`.${d}`));
}

/** Adresse d'abonnement Web Push donnée par le navigateur (endpoint). */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  if (endpoint.length > 1024) return false;
  const u = parseHttps(endpoint, { allowExtra: true });
  if (!u) return false;
  if (u.protocol === "http:") return true; // hôte de l'administrateur (banc d'essai)
  return hostMatches(u.hostname, PUSH_HOSTS);
}

/**
 * ntfy : accepte un nom de sujet (« cliping-a8f3k2… ») ou un lien complet (« https://ntfy.sh/cliping-a8f3k2 »).
 * Renvoie le serveur et le sujet, ou une erreur lisible.
 */
export function parseNtfyTarget(input: string): { server: string; topic: string } | { error: string } {
  const raw = input.trim();
  const TOPIC = /^[A-Za-z0-9_-]{1,64}$/;
  if (TOPIC.test(raw)) {
    if (raw.length < 12) return { error: "Sujet trop court : sur ntfy.sh, n'importe qui peut lire un sujet qu'il devine. Prends au moins 12 caractères au hasard." };
    return { server: "https://ntfy.sh", topic: raw };
  }
  const u = parseHttps(raw, { allowExtra: true });
  if (!u) return { error: "Adresse ntfy invalide : colle un nom de sujet ou un lien https://ntfy.sh/ton-sujet." };
  const isExtra = extraHosts().includes(u.host.toLowerCase()) || extraHosts().includes(u.hostname.toLowerCase());
  if (!isExtra && !NTFY_HOSTS.includes(u.hostname.toLowerCase())) {
    return { error: "Seul ntfy.sh est accepté. Pour ton propre serveur ntfy, l'administrateur doit l'ajouter à NOTIFY_EXTRA_HOSTS." };
  }
  const topic = u.pathname.replace(/^\/+|\/+$/g, "");
  if (!TOPIC.test(topic)) return { error: "Sujet ntfy invalide : lettres, chiffres, - et _ uniquement (64 max)." };
  if (!isExtra && topic.length < 12) return { error: "Sujet trop court : sur ntfy.sh, n'importe qui peut lire un sujet qu'il devine. Prends au moins 12 caractères au hasard." };
  return { server: `${u.protocol}//${u.host}`, topic };
}

/** Webhook Discord : https://discord.com/api/webhooks/<id>/<jeton>. */
export function parseDiscordWebhook(input: string): { url: string } | { error: string } {
  const u = parseHttps(input, { allowExtra: false });
  if (!u || !DISCORD_HOSTS.includes(u.hostname.toLowerCase())) {
    return { error: "Lien de webhook Discord invalide : il commence par https://discord.com/api/webhooks/." };
  }
  const m = /^\/api\/(?:v\d+\/)?webhooks\/(\d{5,25})\/([A-Za-z0-9_-]{20,120})\/?$/.exec(u.pathname);
  if (!m) return { error: "Lien de webhook Discord incomplet : copie-le en entier depuis Discord (Paramètres du salon → Intégrations → Webhooks)." };
  return { url: `https://discord.com/api/webhooks/${m[1]}/${m[2]}` };
}

export function pushServiceLabel(endpoint: string): string {
  try {
    const h = new URL(endpoint).hostname;
    if (h.endsWith("push.apple.com")) return "iPhone / Safari";
    if (h.endsWith("fcm.googleapis.com")) return "Chrome / Android";
    if (h.endsWith("mozilla.com")) return "Firefox";
    if (h.endsWith("notify.windows.com")) return "Edge / Windows";
    return h;
  } catch {
    return "Navigateur";
  }
}
