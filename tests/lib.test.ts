import { beforeAll, describe, expect, it } from "vitest";
import { decrypt, encrypt, hashPassword, verifyPassword } from "@/lib/crypto";
import { isAllowedSourceUrl } from "@/lib/hosts";
import { parseSettings } from "@/lib/settings";
import { fallbackMetadata, mergeHashtags, shortGameName } from "@/worker/ai";
import { buildAss, chunkWords, cleanBurnText, layoutFor, wrapLines } from "@/worker/render/captions";
import { blurBandHeight, buildFilterGraph, escFilterArg, validFacecam } from "@/worker/render/render";
import { wordsFromResponse } from "@/worker/transcribe";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = "test-key-0123456789abcdef0123456789abcdef";
});

describe("crypto", () => {
  it("chiffre et déchiffre les jetons, et détecte une altération", () => {
    const enc = encrypt("ya29.secret-token");
    expect(enc).not.toContain("secret-token");
    expect(decrypt(enc)).toBe("ya29.secret-token");
    expect(encrypt("x")).not.toBe(encrypt("x")); // IV aléatoire
    // On modifie à coup sûr le premier caractère des données chiffrées (un caractère tiré au hasard
    // pouvait être remplacé par lui-même une fois sur 64, et le test échouait alors à tort).
    const parts = enc.split(".");
    const data = parts[3]!;
    const tampered = [...parts.slice(0, 3), (data.startsWith("A") ? "B" : "A") + data.slice(1)].join(".");
    expect(tampered).not.toBe(enc);
    expect(() => decrypt(tampered)).toThrow();
  });
  it("vérifie les mots de passe", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("mauvais", hash)).toBe(false);
    expect(await verifyPassword("x", "n'importe quoi")).toBe(false);
  });
});

describe("liens autorisés (anti-SSRF)", () => {
  it("accepte les plateformes vidéo, refuse le réseau interne", () => {
    expect(isAllowedSourceUrl("https://www.twitch.tv/videos/123")).toBe(true);
    expect(isAllowedSourceUrl("https://youtu.be/abc")).toBe(true);
    expect(isAllowedSourceUrl("https://kick.com/video/x")).toBe(true);
    expect(isAllowedSourceUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isAllowedSourceUrl("http://localhost:5432")).toBe(false);
    expect(isAllowedSourceUrl("https://twitch.tv.evil.com/x")).toBe(false);
    expect(isAllowedSourceUrl("https://user:pass@youtube.com/x")).toBe(false);
    expect(isAllowedSourceUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedSourceUrl("--exec=rm")).toBe(false);
  });
});

describe("réglages", () => {
  it("applique les défauts et garde les valeurs valides quand une clé est cassée", () => {
    expect(parseSettings(null).sensitivity).toBe(3);
    const s = parseSettings({ sensitivity: 5, zoom: 99, captionColor: "#00ff00" });
    expect(s.sensitivity).toBe(5);
    expect(s.captionColor).toBe("#00ff00");
    expect(s.zoom).toBe(1.35);
  });
});

describe("sous-titres", () => {
  const words = [
    { w: "mais", s: 1.0, e: 1.2 },
    { w: "non", s: 1.25, e: 1.6 },
    { w: "frérot", s: 1.65, e: 2.1 },
    { w: "regarde", s: 3.5, e: 3.9 },
    { w: "ça!", s: 3.95, e: 4.3 },
    { w: "incroyable", s: 4.35, e: 5.0 },
  ];
  it("regroupe par petits paquets et coupe sur les pauses et la ponctuation", () => {
    const chunks = chunkWords(words);
    expect(chunks.map((c) => c.words.map((x) => x.w).join(" "))).toEqual(["mais non frérot", "regarde ça!", "incroyable"]);
    for (let i = 1; i < chunks.length; i++) expect(chunks[i]!.start).toBeGreaterThanOrEqual(chunks[i - 1]!.end - 1e-9);
  });
  it("génère un fichier ASS avec accroche, crédit et mot surligné", () => {
    const ass = buildAss({ duration: 10, words, hook: "Il s'attendait {pas} à ça 😱", credit: "twitch.tv/test", font: "Poppins ExtraBold", highlight: "#FFE600", layout: layoutFor("BLUR", 820) });
    expect(ass).toContain("PlayResX: 1080");
    expect(ass).toMatch(/IL S'ATTENDAIT PAS À(\\N| )ÇA/); // majuscules, accolades et emoji retirés, coupé en lignes
    expect(ass).toContain("twitch.tv/test");
    expect(ass).toMatch(/\{\\c&H00E6FF&[^}]*\}NON \{\\c&HFFFFFF&/); // #FFE600 en ordre BGR, mot suivant en blanc
    expect(ass.match(/^Dialogue: 2,/gm)!.length).toBe(words.length);
    expect(ass).not.toMatch(/😱/u);
  });
  it("ignore les mots hors de la fenêtre du clip", () => {
    const ass = buildAss({ duration: 2, words, font: "Anton", highlight: "#FFFFFF", layout: layoutFor("FULL", 1920) });
    expect(ass).toContain("MAIS");
    expect(ass).not.toContain("REGARDE");
  });
  it("nettoie et coupe les titres", () => {
    expect(cleanBurnText("a {b} \\c 🔥  d")).toBe("a b c d");
    expect(wrapLines("un titre vraiment beaucoup trop long pour tenir", 20, 2)).toHaveLength(2);
    expect(wrapLines("un titre vraiment beaucoup trop long pour tenir sur deux lignes seulement", 20, 2)[1]).toMatch(/…$/);
  });
  it("répartit les mots quand le fournisseur ne donne que des segments", () => {
    const w = wordsFromResponse({ segments: [{ text: " salut tout le monde ", start: 2, end: 4 }] });
    expect(w.map((x) => x.w)).toEqual(["salut", "tout", "le", "monde"]);
    expect(w[0]!.s).toBe(2);
    expect(w[3]!.e).toBeCloseTo(4);
  });
});

describe("montage", () => {
  const base = { source: "s.mp4", out: "o.mp4", cwd: "/tmp", start: 0, duration: 20, zoom: 1.35, srcWidth: 1920, srcHeight: 1080, hasAudio: true, assFile: "captions.ass" as string | null };
  it("calcule la bande de gameplay et plafonne le zoom", () => {
    expect(blurBandHeight(1920, 1080, 1)).toBe(608);
    expect(blurBandHeight(1920, 1080, 1.35)).toBe(820);
    expect(blurBandHeight(1920, 1080, 10)).toBe(1920);
  });
  it("produit un filtergraph par mise en page", () => {
    expect(buildFilterGraph({ ...base, template: "BLUR" })).toMatch(/gblur.*overlay.*setsar=1,ass=filename=captions\.ass/);
    expect(buildFilterGraph({ ...base, template: "FULL", assFile: null })).toMatch(/crop=1080:1920\[base0\];\[base0\]null\[base\];\[base\]setsar=1\[v\]/);
    const fc = buildFilterGraph({ ...base, template: "FACECAM", facecam: { x: 0.75, y: 0.02, w: 0.23, h: 0.3 } });
    expect(fc).toMatch(/crop=w=iw\*0\.2300.*vstack/);
    // Facecam demandée sans zone définie : on retombe sur le fond flouté.
    expect(buildFilterGraph({ ...base, template: "FACECAM", facecam: null })).toContain("gblur");
  });
  it("valide la zone facecam et échappe les chemins", () => {
    expect(validFacecam({ x: 0.7, y: 0, w: 0.3, h: 0.3 })).not.toBeNull();
    expect(validFacecam({ x: 0.9, y: 0, w: 0.3, h: 0.3 })).toBeNull();
    expect(validFacecam("nope")).toBeNull();
    expect(escFilterArg("/data/a:b,c[1]")).toBe("/data/a\\:b\\,c\\[1\\]");
  });
});

describe("titres par défaut", () => {
  it("abrège les noms de jeux et fusionne les hashtags sans doublon", () => {
    expect(shortGameName("Grand Theft Auto VI")).toBe("GTA 6");
    expect(shortGameName("Grand Theft Auto V")).toBe("GTA 5");
    expect(mergeHashtags(["GTA6", "#Clips"], ["gta6", "Été Fou"])).toEqual(["gta6", "clips", "etefou"]);
    const meta = fallbackMetadata(
      { streamer: "Inox", platform: "TWITCH", game: "Grand Theft Auto VI", streamTitle: null, language: "fr", durationSec: 30, transcript: "", signals: { audio: 3, chat: null, scene: null }, defaultHashtags: ["gta6"] },
      "seed",
    );
    expect(meta.title).toContain("Inox");
    expect(meta.title).toContain("GTA 6");
    expect(meta.viralScore).toBeNull();
    // Jeu, streamer, variante du jeu, communauté Twitch FR, puis les tags réglés.
    expect(meta.hashtags).toEqual(["gta6", "inox", "gtavi", "twitchfr", "gta6gameplay"]);
  });
});
