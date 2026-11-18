import { describe, expect, it } from "vitest";
import {
  HighlightDetector,
  defaultDetectorOptions,
  detectOffline,
  snapToQuiet,
  type FeatureRow,
} from "@/worker/analysis/detector";
import { messageWeight } from "@/worker/chat/twitch";
import { matchesGameFilter, parseChannel } from "@/lib/sources";

/** Bruit déterministe (pas de Math.random : les tests doivent être reproductibles). */
function noise(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296 - 0.5;
  };
}

function stream(seconds: number, events: Array<{ at: number; len: number; audio?: number; chat?: number }>, withChat = true) {
  const rnd = noise(42);
  const rows: FeatureRow[] = [];
  for (let t = 0; t < seconds; t++) {
    let audio = -22 + rnd() * 5;
    let chat = Math.max(0, Math.round(3 + rnd() * 4));
    for (const e of events) {
      if (t >= e.at && t < e.at + e.len) {
        audio += e.audio ?? 0;
        chat += e.chat ?? 0;
      }
    }
    rows.push({ audio, scene: 0.1 + rnd() * 0.05, chat: withChat ? chat : null });
  }
  return rows;
}

function runAll(rows: FeatureRow[], overrides = {}) {
  const det = new HighlightDetector(defaultDetectorOptions(overrides));
  const out = [];
  for (const r of rows) out.push(...det.push(r));
  out.push(...det.flush());
  return out;
}

describe("HighlightDetector", () => {
  it("ne détecte rien sur un stream calme", () => {
    expect(runAll(stream(900, []))).toHaveLength(0);
  });

  it("détecte un moment où le son ET le chat s'emballent", () => {
    const hs = runAll(stream(600, [{ at: 300, len: 8, audio: 12, chat: 25 }]));
    expect(hs).toHaveLength(1);
    const h = hs[0]!;
    expect(h.peak).toBeGreaterThanOrEqual(300);
    expect(h.peak).toBeLessThanOrEqual(308);
    expect(h.start).toBeLessThan(300); // du contexte avant l'action
    expect(h.end).toBeGreaterThan(308);
    expect(h.end - h.start).toBeGreaterThanOrEqual(18);
    expect(h.end - h.start).toBeLessThanOrEqual(50);
    expect(h.score).toBeGreaterThan(60);
  });

  it("ignore un pic sonore d'une seule seconde (coup de feu) quand le chat ne réagit pas", () => {
    expect(runAll(stream(600, [{ at: 300, len: 1, audio: 15 }]))).toHaveLength(0);
  });

  it("fonctionne sans chat (Kick / YouTube) sur un cri prolongé", () => {
    const hs = runAll(stream(600, [{ at: 200, len: 7, audio: 14 }], false));
    expect(hs).toHaveLength(1);
    expect(hs[0]!.parts.chat).toBeNull();
  });

  it("sépare deux moments distincts et ne les fait pas se chevaucher", () => {
    const hs = runAll(
      stream(900, [
        { at: 200, len: 6, audio: 12, chat: 30 },
        { at: 500, len: 6, audio: 12, chat: 30 },
      ]),
    );
    expect(hs).toHaveLength(2);
    expect(hs[1]!.start).toBeGreaterThanOrEqual(hs[0]!.end);
  });

  it("valide un pic en direct après le délai de lookahead, pas avant", () => {
    const rows = stream(400, [{ at: 300, len: 6, audio: 12, chat: 30 }]);
    const det = new HighlightDetector(defaultDetectorOptions());
    let foundAt = -1;
    rows.forEach((r, i) => {
      if (det.push(r).length && foundAt < 0) foundAt = i;
    });
    expect(foundAt).toBeGreaterThanOrEqual(300 + 12);
    expect(foundAt).toBeLessThan(300 + 30);
  });

  it("respecte le plafond de clips par heure", () => {
    const events = Array.from({ length: 10 }, (_, i) => ({ at: 120 + i * 90, len: 6, audio: 12, chat: 30 }));
    expect(runAll(stream(1100, events), { maxPerHour: 3 })).toHaveLength(3);
  });

  it("detectOffline garde les meilleurs moments, dans l'ordre chronologique", () => {
    const rows = stream(1200, [
      { at: 200, len: 6, audio: 8, chat: 12 },
      { at: 500, len: 8, audio: 14, chat: 40 },
      { at: 900, len: 6, audio: 10, chat: 20 },
    ]);
    const top = detectOffline(rows, defaultDetectorOptions(), 2);
    expect(top).toHaveLength(2);
    expect(top[0]!.peak).toBeLessThan(top[1]!.peak);
    expect(top.some((h) => h.peak >= 500 && h.peak <= 508)).toBe(true);
  });
});

describe("snapToQuiet", () => {
  it("se cale sur un silence proche", () => {
    const l = new Float32Array(200).fill(-20);
    for (let i = 95; i < 99; i++) l[i] = -50;
    const t = snapToQuiet(l, 10);
    expect(t).toBeGreaterThanOrEqual(9.5);
    expect(t).toBeLessThanOrEqual(9.9);
  });
  it("ne bouge pas s'il n'y a pas de creux net", () => {
    expect(snapToQuiet(new Float32Array(200).fill(-20), 10)).toBe(10);
  });
});

describe("chat", () => {
  it("pondère les réactions hype et les demandes de clip", () => {
    expect(messageWeight("salut tout le monde")).toBe(1);
    expect(messageWeight("KEKW")).toBeGreaterThan(1);
    expect(messageWeight("mdrrrr")).toBeGreaterThan(1);
    expect(messageWeight("CLIP ÇA")).toBeGreaterThan(messageWeight("mdr"));
  });
});

describe("sources", () => {
  it("reconnaît les chaînes", () => {
    expect(parseChannel("https://www.twitch.tv/Squeezie")).toMatchObject({ platform: "TWITCH", login: "squeezie" });
    expect(parseChannel("kick.com/xqc")).toMatchObject({ platform: "KICK", login: "xqc" });
    expect(parseChannel("https://youtube.com/@Gotaga")?.url).toBe("https://www.youtube.com/@Gotaga/live");
    expect(parseChannel("inoxtag", "TWITCH")).toMatchObject({ platform: "TWITCH", login: "inoxtag" });
    expect(parseChannel("https://www.twitch.tv/videos/123")).toBeNull();
    expect(parseChannel("")).toBeNull();
  });
  it("filtre par jeu sans confondre GTA V et GTA VI", () => {
    expect(matchesGameFilter("Grand Theft Auto VI", "Grand Theft Auto VI")).toBe(true);
    expect(matchesGameFilter("Grand Theft Auto VI", "Grand Theft Auto V")).toBe(false);
    expect(matchesGameFilter("", "Just Chatting")).toBe(true);
    expect(matchesGameFilter("gta 6, gta vi", null, "ON DÉCOUVRE GTA 6 !!")).toBe(true);
    // Écritures équivalentes du même jeu
    expect(matchesGameFilter("GTA 6", "Grand Theft Auto VI")).toBe(true);
    expect(matchesGameFilter("grand theft auto 6", "Grand Theft Auto VI")).toBe(true);
    expect(matchesGameFilter("GTA 6", "Grand Theft Auto V")).toBe(false);
    expect(matchesGameFilter("GTA 5", "Grand Theft Auto VI")).toBe(false);
    expect(matchesGameFilter("Just Chatting, GTA VI", "Just Chatting")).toBe(true);
    // Sur un titre : mot entier, pas un morceau de mot
    expect(matchesGameFilter("GTA 6", null, "Soirée GTA 60 fps")).toBe(false);
    expect(matchesGameFilter("Grand Theft Auto VI", null, "DÉCOUVERTE GTA VI avec les potes")).toBe(true);
  });
});
