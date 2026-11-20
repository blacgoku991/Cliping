import { describe, expect, it } from "vitest";
import { clipHashtags, fallbackMetadata, gameFromTitle, type MetadataContext } from "@/worker/ai";
import { pickQuotes, quoted, quoteEmoji, sentences } from "@/worker/quotes";
import type { Word } from "@/worker/render/captions";

/** Mots tels que les renvoie Whisper : majuscule en début de phrase, ponctuation parfois absente. */
function words(spec: Array<[string, number]>): Word[] {
  return spec.flatMap(([text, at]) => text.split(" ").map((w, i) => ({ w, s: at + i * 0.3, e: at + i * 0.3 + 0.25 })));
}

const live = words([
  ["Oh non", 22.6],
  ["Jason mon amour je te kiffe de malade", 24.9],
  ["Je te kiffe de dingue", 27.3],
  ["Putain c'est fermé connard", 30],
  ["Combien il vaut ?", 32.6],
  ["Sous-titres réalisés par la communauté d'Amara.org", 36],
]);

describe("citations", () => {
  it("découpe en phrases sur la ponctuation, les pauses et les majuscules de début de phrase", () => {
    const texts = sentences(live).map((s) => s.words.map((w) => w.w).join(" "));
    expect(texts).toContain("Jason mon amour je te kiffe de malade");
    expect(texts).toContain("Je te kiffe de dingue");
    expect(texts).toContain("Combien il vaut ?");
  });

  it("garde des phrases courtes et précises près du moment fort, jamais d'insulte ni de générique inventé", () => {
    const q = pickQuotes(live, { start: 20, end: 40, peak: 28 });
    const texts = q.map((x) => x.text);
    expect(texts[0]).toBe("Je te kiffe de dingue");
    expect(texts).toContain("Jason mon amour je te kiffe de malade");
    expect(texts.join(" ")).not.toMatch(/connard|Amara|^Oh non$/);
    // Typographie française : espace insécable avant le point d'interrogation.
    expect(pickQuotes(live, { start: 31, end: 35, peak: 33 })[0]?.text).toBe("Combien il vaut ?");
  });

  it("écarte les grossièretés et les mots masqués par Whisper", () => {
    const rude = words([["Moi j'en ai pas les couilles", 10], ["J'ai besoin d'un b***h", 13], ["On va voler cette voiture", 16]]);
    expect(pickQuotes(rude, { start: 8, end: 20, peak: 12 }).map((q) => q.text)).toEqual(["On va voler cette voiture"]);
  });

  it("ne cite que l'extrait demandé", () => {
    expect(pickQuotes(live, { start: 0, end: 20, peak: 10 })).toEqual([]);
  });

  it("encadre la citation de guillemets insécables et choisit un emoji d'après la phrase", () => {
    expect(quoted("Elle est dingue")).toBe("« Elle est dingue »");
    expect(quoteEmoji("La caisse elle est dingue")).toBe("🤯");
    expect(quoteEmoji("C'est où ma voiture ?")).toBe("🤔");
    expect(quoteEmoji("Il m'a eu")).toBe("👀");
  });
});

describe("jeu et hashtags", () => {
  it("reconnaît le jeu dans le titre du live", () => {
    expect(gameFromTitle("GTA 6 ON CONTINUE LIVE 233H")).toBe("GTA 6");
    expect(gameFromTitle("on découvre GTA VI !!")).toBe("GTA 6");
    expect(gameFromTitle("GTA V RP ce soir")).toBe("GTA 5");
    expect(gameFromTitle("GTA RP — serveur FA")).toBe("GTA RP");
    expect(gameFromTitle("Just chatting")).toBeNull();
    expect(gameFromTitle(null)).toBeNull();
  });

  it("met le jeu et le streamer en premier, puis tes tags, et s'arrête à 8", () => {
    const tags = clipHashtags({ game: "Grand Theft Auto VI", streamer: "Squeezie", platform: "TWITCH", language: "fr", defaults: ["gta6", "gaming", "clips"], extra: ["fail", "police", "course", "poursuite"] });
    expect(tags.slice(0, 5)).toEqual(["gta6", "squeezie", "gtavi", "twitchfr", "gta6gameplay"]);
    expect(tags).toContain("gaming");
    expect(tags.length).toBe(8);
    expect(clipHashtags({ game: "Minecraft", streamer: "Inox", platform: "YOUTUBE", language: "fr", defaults: [] })).toEqual(["minecraft", "inox"]);
  });
});

describe("titres sans IA", () => {
  const ctx: MetadataContext = {
    streamer: "Squeezie",
    platform: "TWITCH",
    game: "GTA 6",
    streamTitle: null,
    language: "fr",
    durationSec: 20,
    transcript: "",
    signals: { audio: 3, chat: 2, scene: null },
    defaultHashtags: ["gaming"],
    words: live,
    moment: { start: 20, end: 40, peak: 28 },
  };

  it("prend une phrase réellement prononcée comme accroche et la reprend dans le titre avec le streamer et le jeu", () => {
    const meta = fallbackMetadata(ctx, "seed");
    expect(meta.hook).toBe("« Je te kiffe de dingue »");
    expect(meta.hookAngles[0]).toBe("citation");
    expect(meta.title).toBe("« Je te kiffe de dingue » 🤯 Squeezie sur GTA 6");
    expect(meta.titles).toContain("Squeezie sur GTA 6 : « Je te kiffe de dingue »");
    expect(meta.hooks).toContain("Squeezie sur GTA 6");
    expect(meta.description).toContain("Squeezie");
    expect(meta.hashtags.slice(0, 2)).toEqual(["gta6", "squeezie"]);
  });

  it("sans parole exploitable, reste sur des titres neutres", () => {
    const meta = fallbackMetadata({ ...ctx, words: words([["Oh non", 27]]) }, "seed");
    expect(meta.title).toContain("Squeezie");
    expect(meta.hook).toBe("Squeezie sur GTA 6");
    expect(meta.hookAngles).toEqual([]);
  });
});
