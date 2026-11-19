import { describe, expect, it } from "vitest";
import { chatAdjustment, clipAdjustment, keepClip, viralityScore } from "@/lib/virality";
import { ChatCounter, isClipRequest } from "@/worker/chat/twitch";

describe("potentiel d'un clip", () => {
  it("garde le score du détecteur quand le chat n'est pas lu et sans IA", () => {
    expect(viralityScore({ detector: 64, chat: null, clipRequests: null, clipBaseline: null, ai: null }).score).toBe(64);
  });
  it("retire des points quand le chat ne réagit pas, en ajoute quand il explose", () => {
    expect(chatAdjustment(0)).toBe(-8);
    expect(chatAdjustment(2)).toBe(0);
    expect(chatAdjustment(6)).toBe(12);
    const calme = viralityScore({ detector: 60, chat: 0.5, clipRequests: 0, clipBaseline: 0, ai: null }).score;
    const hype = viralityScore({ detector: 60, chat: 5, clipRequests: 0, clipBaseline: 0, ai: null }).score;
    expect(calme).toBeLessThan(60);
    expect(hype).toBeGreaterThan(60);
  });
  it("compte les demandes de clip par rapport à l'habitude du live", () => {
    expect(clipAdjustment(0, 0)).toBe(0);
    expect(clipAdjustment(5, 0)).toBe(15); // personne ne demandait de clip, 5 d'un coup : signal fort
    expect(clipAdjustment(6, 5)).toBe(1); // un gros chat qui spamme « clip » en permanence : presque rien
    expect(clipAdjustment(20, 2)).toBe(15); // plafonné
  });
  it("mélange avec l'avis de l'IA et reste entre 1 et 100", () => {
    expect(viralityScore({ detector: 80, chat: 4, clipRequests: 4, clipBaseline: 0, ai: 40 }).score).toBe(73); // 80+8+15 plafonné à 100, puis 0,55×100 + 0,45×40
    expect(viralityScore({ detector: 100, chat: 6, clipRequests: 50, clipBaseline: 0, ai: null }).score).toBe(100);
    expect(viralityScore({ detector: 1, chat: 0, clipRequests: 0, clipBaseline: 0, ai: null }).score).toBe(1);
  });
  it("trie selon le minimum choisi", () => {
    expect(keepClip(65, 65)).toBe(true);
    expect(keepClip(64, 65)).toBe(false);
  });
});

describe("demandes de clip dans le chat", () => {
  it("reconnaît les demandes, en français et en anglais", () => {
    expect(isClipRequest("CLIP ÇA")).toBe(true);
    expect(isClipRequest("clippez svp")).toBe(true);
    expect(isClipRequest("clip it")).toBe(true);
    expect(isClipRequest("eclipse")).toBe(false);
    expect(isClipRequest("trop bien")).toBe(false);
  });
  it("compte par seconde et calcule l'habitude du live", () => {
    const c = new ChatCounter();
    const t0 = 1_000_000;
    // 10 minutes avec une demande de clip toutes les 2 minutes…
    for (let s = 0; s < 600; s += 120) c.add((t0 + s) * 1000, "clip");
    // …puis 6 demandes en 10 secondes.
    for (let s = 600; s < 606; s++) c.add((t0 + s) * 1000, "CLIP CLIP");
    c.add((t0 + 601) * 1000, "salut");
    expect(c.clipsBetween(t0 + 600, t0 + 609)).toBe(6);
    expect(c.clipBaseline(t0 + 600, 10)).toBeCloseTo((5 * 10) / 600, 5);
    c.prune(t0 + 600);
    expect(c.clipsBetween(t0, t0 + 599)).toBe(0);
  });
});
