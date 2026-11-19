import { env } from "@/lib/env";
import { run, runOk } from "./proc";

/**
 * Twitch par yt-dlp.
 *
 * En novembre 2026, Twitch a changé le format de ses listes de lecture (variantes sans #EXT-X-MEDIA,
 * attributs STABLE-VARIANT-ID / IVS-NAME) : streamlink 8.6.3, la dernière version publiée, n'y trouve plus
 * aucun flux et répond « No playable streams » même pour une chaîne en live. yt-dlp, lui, lit ce format.
 *
 * On utilise donc yt-dlp pour savoir si une chaîne Twitch est en live et pour obtenir l'adresse de la liste
 * de lecture à la qualité voulue ; streamlink lit ensuite cette liste comme un flux HLS ordinaire.
 * Limite connue : streamlink ne retire plus les coupures publicitaires de Twitch dans ce mode.
 *
 * TWITCH_VIA_YTDLP=false revient au comportement d'origine (banc d'essai, ou streamlink corrigé un jour).
 */
export function twitchViaYtdlp(url: string): boolean {
  if (["0", "false", "no", "off"].includes((process.env.TWITCH_VIA_YTDLP ?? "").toLowerCase())) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "twitch.tv" || host.endsWith(".twitch.tv");
  } catch {
    return false;
  }
}

interface YtdlpLiveInfo {
  is_live?: boolean;
  title?: string | null;
  description?: string | null;
}

export interface TwitchLiveStatus {
  live: boolean;
  title: string | null;
  error: string | null;
}

/** Live ou pas, d'après yt-dlp. Une chaîne hors ligne n'est pas une erreur. */
export async function twitchLiveStatus(url: string): Promise<TwitchLiveStatus> {
  let res;
  try {
    res = await run(env.bin.ytdlp, [...env.worker.ytdlpArgs, "--no-warnings", "--dump-single-json", "--no-playlist", url], { timeoutMs: 60_000 });
  } catch (err) {
    return { live: false, title: null, error: err instanceof Error ? err.message : String(err) };
  }
  if (res.code !== 0) {
    const msg = res.stderr.trim().split("\n").filter(Boolean).pop() ?? "";
    const offline = /offline|not currently live|is not live|does not exist|no video formats/i.test(msg);
    return { live: false, title: null, error: offline ? null : msg.replace(/^ERROR:\s*/, "").slice(0, 300) || "yt-dlp n'a rien renvoyé" };
  }
  try {
    const info = JSON.parse(res.stdout) as YtdlpLiveInfo;
    // yt-dlp met dans « title » le nom de la chaîne et la date ; le vrai titre du live est dans « description ».
    const title = (info.description || info.title || "").trim() || null;
    return { live: info.is_live !== false, title, error: null };
  } catch {
    return { live: false, title: null, error: "réponse illisible de yt-dlp" };
  }
}

/** « best » → « best » ; « 720p60,best » → « 720p60/best » (syntaxe de choix de format de yt-dlp). */
export function ytdlpFormat(quality: string): string {
  const parts = (quality || "best").split(",").map((q) => q.trim()).filter(Boolean);
  return parts.length ? parts.join("/") : "best";
}

/** Adresse de la liste de lecture HLS du live, à la qualité demandée. */
export async function twitchHlsUrl(url: string, quality: string): Promise<string> {
  const { stdout } = await runOk(
    env.bin.ytdlp,
    [...env.worker.ytdlpArgs, "--no-warnings", "--no-playlist", "-f", ytdlpFormat(quality), "-g", url],
    { timeoutMs: 60_000 },
  );
  const line = stdout.trim().split("\n").filter((l) => /^https:\/\//.test(l)).pop();
  if (!line) throw new Error("yt-dlp n'a pas donné d'adresse de lecture pour ce live");
  return line;
}
