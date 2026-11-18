import { env } from "@/lib/env";
import { log } from "../proc";

// Emotes : sensibles à la casse (ce sont des noms propres côté Twitch).
const HYPE_EMOTES =
  /(?:^|\s)(?:LUL|LULW|KEKW|KEKL|OMEGALUL|PogChamp|Pog|PogU|POGGERS|POGGIES|Pepega|monkaS|monkaW|WutFace|NotLikeThis|Kreygasm|PepeLaugh|ICANT|GIGACHAD|LETSGO|EZ|Clap|D:|xdd|W)(?=\s|$)/;
// Mots : anglais + français, insensibles à la casse.
const HYPE_WORDS =
  /\b(?:lo+l+|lmf?ao+|wt[fh]+|omg+|mdr+|ptdr+|jpp|xd+|ha(?:ha)+h?|hé(?:hé)+|a(?:ha){2,}|no{3,}n?|non{3,}|gg+|rip|holy|insane|crazy|no way|let'?s go+|énorme|enorme|incroyable|dinguerie|masterclass|oskour|wesh|banger|quoi+)\b|\?{2,}|!{3,}/i;
const CLIP_WORDS = /\bclip(?:s|pe|pez|pé|ped|pable|\s?it|\s?that|\s?ça)?\b/i;

/** Poids d'un message : 1 de base, davantage si c'est une réaction typique d'un moment fort. */
export function messageWeight(text: string): number {
  let w = 1;
  if (HYPE_EMOTES.test(text) || HYPE_WORDS.test(text)) w += 1.5;
  else if (text.length >= 4 && text === text.toUpperCase() && /[A-Z]{4,}/.test(text)) w += 1; // MESSAGE EN MAJUSCULES
  if (CLIP_WORDS.test(text)) w += 2;
  return w;
}

/** Compteur de messages pondérés, rangés par seconde d'horloge. */
export class ChatCounter {
  private readonly buckets = new Map<number, number>();
  total = 0;

  add(wallMs: number, text: string): void {
    const s = Math.floor(wallMs / 1000);
    this.buckets.set(s, (this.buckets.get(s) ?? 0) + messageWeight(text));
    this.total++;
  }

  get(wallSecond: number): number {
    return this.buckets.get(wallSecond) ?? 0;
  }

  prune(beforeWallSecond: number): void {
    for (const k of this.buckets.keys()) if (k < beforeWallSecond) this.buckets.delete(k);
  }
}

/**
 * Lecture anonyme du chat Twitch (IRC sur WebSocket, pseudo « justinfan » : lecture seule, sans compte).
 */
export class TwitchChat {
  readonly counter = new ChatCounter();
  private ws: WebSocket | null = null;
  private stopped = false;
  private retry = 0;
  private timer: NodeJS.Timeout | null = null;
  connected = false;

  constructor(private readonly channel: string) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    try {
      this.ws?.close();
    } catch {
      /* déjà fermé */
    }
    this.ws = null;
  }

  private connect(): void {
    if (this.stopped) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(env.worker.twitchIrcUrl);
    } catch (err) {
      this.scheduleReconnect(String(err));
      return;
    }
    this.ws = ws;
    ws.addEventListener("open", () => {
      const nick = `justinfan${10000 + Math.floor(Math.random() * 80000)}`;
      ws.send("PASS SCHMOOPIIE");
      ws.send(`NICK ${nick}`);
      ws.send(`JOIN #${this.channel.toLowerCase()}`);
      this.connected = true;
      this.retry = 0;
    });
    ws.addEventListener("message", (ev) => {
      const now = Date.now();
      const data = typeof ev.data === "string" ? ev.data : "";
      for (const line of data.split("\r\n")) {
        if (!line) continue;
        if (line.startsWith("PING")) {
          ws.send(line.replace("PING", "PONG"));
        } else if (line.includes(" PRIVMSG #")) {
          const idx = line.indexOf(" :", line.indexOf(" PRIVMSG #"));
          if (idx > 0) this.counter.add(now, line.slice(idx + 2));
        } else if (line.includes(" RECONNECT")) {
          ws.close();
        }
      }
    });
    ws.addEventListener("close", () => {
      this.connected = false;
      if (this.ws === ws) this.scheduleReconnect("connexion fermée");
    });
    ws.addEventListener("error", () => {
      // L'événement « close » suit toujours : la reconnexion est gérée là-bas.
    });
  }

  private scheduleReconnect(reason: string): void {
    if (this.stopped) return;
    const delay = Math.min(30_000, 2000 * 2 ** this.retry++);
    if (this.retry === 1 || this.retry % 5 === 0) log("chat", `#${this.channel} : ${reason}, nouvelle tentative dans ${delay / 1000} s`);
    this.timer = setTimeout(() => this.connect(), delay);
    this.timer.unref();
  }
}
