import path from "node:path";

function str(name: string, def = ""): string {
  const v = process.env[name];
  return v === undefined || v === "" ? def : v;
}

function num(name: string, def: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name] !== undefined && process.env[name] !== "" ? v : def;
}

function bool(name: string, def: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return def;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

/**
 * Configuration lue à la demande (getters) : rien n'est figé au moment du build Next.
 * Toutes les variables sont documentées dans .env.example.
 */
export const env = {
  get appUrl() {
    return str("APP_URL", "http://localhost:3000").replace(/\/+$/, "");
  },
  get dataDir() {
    return path.resolve(str("DATA_DIR", "./data"));
  },
  get encryptionKey() {
    return str("ENCRYPTION_KEY");
  },
  get allowSignup() {
    return bool("ALLOW_SIGNUP", true);
  },

  google: {
    get clientId() {
      return str("GOOGLE_CLIENT_ID");
    },
    get clientSecret() {
      return str("GOOGLE_CLIENT_SECRET");
    },
  },
  tiktok: {
    get clientKey() {
      return str("TIKTOK_CLIENT_KEY");
    },
    get clientSecret() {
      return str("TIKTOK_CLIENT_SECRET");
    },
    /**
     * Demande aussi l'autorisation « video.list », nécessaire pour relever les vues des vidéos TikTok.
     * Désactivé par défaut : si ce droit n'est pas activé dans ton application TikTok, toute connexion
     * de compte serait refusée. Active-le une fois le droit ajouté côté TikTok, puis reconnecte tes comptes.
     */
    get statsScope() {
      return bool("TIKTOK_STATS_SCOPE", false);
    },
  },

  ai: {
    get apiKey() {
      return str("ANTHROPIC_API_KEY");
    },
    get model() {
      return str("AI_MODEL", "claude-haiku-5-5");
    },
  },

  transcribe: {
    /** Point d'accès compatible OpenAI (OpenAI, Groq…). Vide = pas de sous-titres automatiques. */
    get apiUrl() {
      return str("TRANSCRIBE_API_URL").replace(/\/+$/, "");
    },
    get apiKey() {
      return str("TRANSCRIBE_API_KEY");
    },
    get model() {
      return str("TRANSCRIBE_MODEL", "whisper-1");
    },
  },

  bin: {
    get ffmpeg() {
      return str("FFMPEG_BIN", "ffmpeg");
    },
    get ffprobe() {
      return str("FFPROBE_BIN", "ffprobe");
    },
    get streamlink() {
      return str("STREAMLINK_BIN", "streamlink");
    },
    get ytdlp() {
      return str("YTDLP_BIN", "yt-dlp");
    },
  },

  worker: {
    /** Intervalle entre deux vérifications « en live ? » pour chaque chaîne */
    get monitorIntervalSec() {
      return num("MONITOR_INTERVAL_SEC", 60);
    },
    /** Durée d'un segment d'enregistrement */
    get segmentSec() {
      return num("SEGMENT_SEC", 20);
    },
    /** Tampon glissant conservé sur disque par live (au-delà, les segments sont supprimés) */
    get bufferSec() {
      return num("BUFFER_SEC", 300);
    },
    get maxRecordings() {
      return num("MAX_CONCURRENT_RECORDINGS", 6);
    },
    /** Nombre de montages / publications traités en parallèle */
    get jobConcurrency() {
      return num("JOB_CONCURRENCY", 2);
    },
    /** Retard moyen du chat par rapport à l'image (latence du flux + temps de frappe) */
    get chatLagSec() {
      return num("CHAT_LAG_SEC", 5);
    },
    /** keyframes (léger) | full (précis, coûteux en CPU) | off */
    get videoAnalysis() {
      return str("VIDEO_ANALYSIS", "keyframes") as "keyframes" | "full" | "off";
    },
    get renderFps() {
      return num("RENDER_FPS", 30);
    },
    get x264Preset() {
      return str("X264_PRESET", "veryfast");
    },
    get twitchIrcUrl() {
      return str("TWITCH_IRC_URL", "wss://irc-ws.chat.twitch.tv:443");
    },
    /** Arguments supplémentaires passés à streamlink (ex. --twitch-api-header=…) */
    get streamlinkArgs() {
      return str("STREAMLINK_ARGS").split(/\s+/).filter(Boolean);
    },
    get ytdlpArgs() {
      return str("YTDLP_ARGS").split(/\s+/).filter(Boolean);
    },
  },
};

export const FONTS_DIR = path.resolve(str("FONTS_DIR", "./assets/fonts"));
