// Faux services pour les tests de bout en bout, sur un seul port :
//   - WebSocket : imite le chat IRC de Twitch (messages de fond + rafales « hype » aux moments forts)
//   - POST /audio/transcriptions : imite une API de transcription compatible OpenAI
//   - PUT/POST /youtube/... et /tiktok/... ne sont PAS simulés : la publication se teste avec de vrais comptes.
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.MOCK_PORT ?? 8765);
const DIR = process.env.E2E_DIR;
// Moments forts du flux de test (secondes) : le chat réagit ~5 s après.
const EVENTS = (process.env.E2E_EVENTS ?? "70:8,160:9").split(",").map((e) => e.split(":").map(Number));
const CHAT_DELAY = 5;

const server = createServer((req, res) => {
  if (req.method === "POST" && req.url?.endsWith("/audio/transcriptions")) {
    req.resume();
    req.on("end", () => {
      // Phrases ponctuées, séparées par des pauses de longueur variable (dont de vrais blancs de 2 à 3 s),
      // pour exercer le calage des bornes et la coupe des temps morts.
      const sentences = [
        "attends attends c'est quoi ce truc ?",
        "non non non !",
        "mais il est fou lui.",
        "regarde ça frérot, j'y crois pas.",
        "c'est incroyable !",
        "bon on continue la mission.",
        "il reste combien de temps là ?",
      ];
      const pauses = [0.4, 2.6, 0.9, 1.6, 3.1, 0.5, 2.2];
      const words = [];
      let t = 1.2;
      for (let i = 0; t < 130; i++) {
        for (const w of sentences[i % sentences.length].split(" ")) {
          const d = 0.16 + w.length * 0.035;
          words.push({ word: w, start: +t.toFixed(2), end: +(t + d).toFixed(2) });
          t += d + 0.07;
        }
        t += pauses[i % pauses.length];
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ text: words.map((w) => w.word).join(" "), words }));
    });
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ server });
const BG = ["salut", "ça va le chat ?", "il est où là", "trop bien ce jeu", "la map est immense", "first", "gg", "on est en quelle mission"];
const HYPE = ["KEKW", "MDRRRR", "CLIP ÇA", "OMEGALUL", "NOOOON", "??????", "PTDR", "LUL LUL LUL", "il est fou", "CLIP", "wtf", "JPP"];

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    for (const line of String(raw).split("\r\n")) {
      if (line.startsWith("JOIN ")) ws.channel = line.slice(5).trim();
    }
  });
  let n = 0;
  const timer = setInterval(() => {
    if (ws.readyState !== ws.OPEN || !ws.channel) return;
    const startedFile = DIR && path.join(DIR, "started");
    const started = startedFile && existsSync(startedFile) ? Number(readFileSync(startedFile, "utf8")) : null;
    const t = started ? Date.now() / 1000 - started : -1;
    const hype = EVENTS.some(([at, len]) => t >= at + CHAT_DELAY && t < at + len + CHAT_DELAY + 3);
    const count = hype ? 9 : n++ % 2; // ~18 msg/s pendant un moment fort, ~1 msg/s sinon
    for (let i = 0; i < count; i++) {
      const pool = hype ? HYPE : BG;
      const text = pool[Math.floor(Math.random() * pool.length)];
      ws.send(`:viewer${Math.floor(Math.random() * 999)}!v@v.tmi.twitch.tv PRIVMSG ${ws.channel} :${text}\r\n`);
    }
  }, 500);
  const ping = setInterval(() => ws.readyState === ws.OPEN && ws.send("PING :tmi.twitch.tv\r\n"), 20_000);
  ws.on("close", () => {
    clearInterval(timer);
    clearInterval(ping);
  });
});

server.listen(PORT, "127.0.0.1", () => console.log(`mock services sur http/ws://127.0.0.1:${PORT}`));
