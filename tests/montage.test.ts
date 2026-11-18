import { describe, expect, it } from "vitest";
import { effectiveEdit, montageSummary, parseSettings } from "@/lib/settings";
import { buildAss, CAPTION_STYLES, chunkWords, defaultEmphasis, layoutFor, normWord, SAFE_CENTER_X, SAFE_ZONE, type Word } from "@/worker/render/captions";
import { isGoodHook, pickHooks } from "@/worker/ai";
import {
  buildPlan,
  findDeadAir,
  mapTime,
  mapWords,
  refineBounds,
  teaserWindow,
  zoomAt,
  zoomExpr,
  zoomWindows,
} from "@/worker/render/plan";
import { buildFilterGraph, renderArgs } from "@/worker/render/render";

/** Sonie synthétique : `level` partout, `loud` sur les intervalles donnés (100 ms par valeur). */
function loudness(duration: number, level: number, spans: Array<[number, number, number]>): Float32Array {
  const a = new Float32Array(Math.ceil(duration * 10)).fill(level);
  for (const [from, to, v] of spans) for (let i = Math.floor(from * 10); i < Math.ceil(to * 10) && i < a.length; i++) a[i] = v;
  return a;
}

/** Une phrase : mots de 0,4 s espacés de 0,1 s à partir de `at`, ponctuation finale sur le dernier. */
function sentence(at: number, n: number, end = "."): Word[] {
  return Array.from({ length: n }, (_, i) => ({ w: `m${at}_${i}${i === n - 1 ? end : ""}`, s: at + i * 0.5, e: at + i * 0.5 + 0.4 }));
}

// Banc commun : parole (-20 LUFS) sur les phrases, silence (-55) ailleurs, pic bruyant (-8) à 24-27 s.
const WORDS = [...sentence(1, 4), ...sentence(6.5, 3, "!"), ...sentence(8.4, 3), ...sentence(13.5, 3, "?"), ...sentence(19, 3), ...sentence(24, 3), ...sentence(28, 3)];
const LOUD = loudness(40, -55, [
  ...WORDS.map((w) => [w.s, w.e + 0.3, -20] as [number, number, number]),
  [23, 27, -8],
]);

describe("temps morts", () => {
  it("coupe les silences entre phrases, jamais près du pic ni au milieu d'une phrase", () => {
    const zones = findDeadAir({ start: 0.5, end: 31, peak: 24.5, loudness: LOUD, words: WORDS });
    expect(zones.length).toBeGreaterThanOrEqual(3);
    for (const [a, b] of zones) {
      expect(b).toBeLessThanOrEqual(24.5 - 2.5 + 1e-9); // garde avant le pic
      // aucun mot touché, marges comprises
      for (const w of WORDS) expect(b <= w.s - 0.149 || a >= w.e + 0.199).toBe(true);
    }
    // 7,9 → 8,4 : 0,5 s seulement, sous le seuil d'une pause de fin de phrase → pas de coupe
    expect(zones.some(([a, b]) => a < 8.4 && b > 7.9)).toBe(false);
  });

  it("ne coupe pas une pause courte sans ponctuation (milieu de phrase)", () => {
    const words: Word[] = [
      { w: "il", s: 1, e: 1.3 },
      { w: "est", s: 2.2, e: 2.5 }, // 0,9 s de pause, pas de ponctuation
      { w: "fou.", s: 2.6, e: 3 },
    ];
    const l = loudness(20, -55, [[1, 1.6, -20], [2.2, 3.3, -20], [12, 15, -8]]);
    const zones = findDeadAir({ start: 0.5, end: 16, peak: 13, loudness: l, words });
    expect(zones.some(([a, b]) => a < 2.2 && b > 1.3)).toBe(false);
  });

  it("ne coupe pas un silence de parole pendant que le jeu fait du bruit", () => {
    const l = loudness(40, -20, [[23, 27, -8]]); // son de jeu continu
    const zones = findDeadAir({ start: 0.5, end: 31, peak: 24.5, loudness: l, words: WORDS });
    expect(zones).toEqual([]);
  });

  it("sans transcription, coupe seulement les vrais creux sonores", () => {
    const l = loudness(30, -22, [[3, 6, -60], [10, 10.5, -60], [20, 23, -8]]);
    const zones = findDeadAir({ start: 0, end: 25, peak: 21, loudness: l, words: [] });
    expect(zones).toHaveLength(1); // 10–10,5 s trop court
    expect(zones[0]![0]).toBeCloseTo(3.2, 1);
    expect(zones[0]![1]).toBeCloseTo(5.85, 1);
  });

  it("ne retire jamais plus de 40 % de la mise en place", () => {
    const l = loudness(40, -60, [[20, 24, -10]]);
    const zones = findDeadAir({ start: 0, end: 26, peak: 22, loudness: l, words: [] });
    const removed = zones.reduce((n, [a, b]) => n + b - a, 0);
    expect(removed).toBeLessThanOrEqual((22 - 2.5) * 0.4 + 1e-9);
  });
});

describe("plan de montage", () => {
  const plan = buildPlan({ start: 0.5, end: 31, peak: 24.5, loudness: LOUD, words: WORDS, coldOpen: true, trimSilence: true });

  it("ouvre sur le pic puis reprend au début, sans dépasser la durée attendue", () => {
    expect(plan.segments[0]!.kind).toBe("teaser");
    expect(plan.segments[1]!.from).toBeCloseTo(0.5, 2);
    expect(plan.teaserDur).toBeGreaterThanOrEqual(1.1);
    expect(plan.teaserDur).toBeLessThanOrEqual(2.2);
    const sum = plan.segments.reduce((n, s) => n + s.to - s.from, 0);
    expect(plan.duration).toBeCloseTo(sum, 3);
    expect(plan.duration).toBeCloseTo(30.5 - plan.removed + plan.teaserDur, 2);
    // Les coupes tombent sur des images entières (30 i/s, à la milliseconde près).
    for (const s of plan.segments) {
      expect(Math.abs(s.from * 30 - Math.round(s.from * 30))).toBeLessThan(0.05);
      expect(Math.abs(s.to * 30 - Math.round(s.to * 30))).toBeLessThan(0.05);
    }
  });

  it("garde le pic et tout ce qui suit intact", () => {
    const last = plan.segments[plan.segments.length - 1]!;
    expect(last.from).toBeLessThanOrEqual(24.5 - 2.5 + 1e-9);
    expect(last.to).toBeCloseTo(31, 2);
    expect(mapTime(plan.segments, 24.5)).toHaveLength(2); // dans le cold open et dans le corps
    expect(plan.peakOut).toBeCloseTo(mapTime(plan.segments, 24.5)[1]!, 3);
  });

  it("recale les mots sur la vidéo finale, avec une rupture à chaque coupe", () => {
    const { words, breaks } = mapWords(plan.segments, WORDS);
    // chaque mot du corps garde sa durée et tombe là où le plan l'envoie
    for (const w of WORDS) {
      const outs = mapTime(plan.segments, w.s);
      for (const o of outs) expect(words.some((x) => Math.abs(x.s - o) < 1e-6 && Math.abs(x.e - x.s - (w.e - w.s)) < 1e-6)).toBe(true);
    }
    expect(breaks).toHaveLength(plan.segments.length - 1);
    expect(breaks[0]).toBeCloseTo(plan.teaserDur, 3);
    // pas de sous-titre qui chevauche une coupe
    for (const c of chunkWords(words, 3, 16, breaks)) for (const b of breaks) expect(c.start >= b - 1e-6 || c.words.at(-1)!.s < b).toBe(true);
  });

  it("pas de cold open sur un clip court ou un pic trop tôt", () => {
    expect(buildPlan({ start: 0, end: 12, peak: 3, loudness: null, words: [], coldOpen: true, trimSilence: true }).teaserDur).toBe(0);
    expect(buildPlan({ start: 0, end: 30, peak: 4, loudness: null, words: [], coldOpen: true, trimSilence: true }).teaserDur).toBe(0);
    expect(buildPlan({ start: 0, end: 30, peak: 15, loudness: null, words: [], coldOpen: false, trimSilence: true }).teaserDur).toBe(0);
  });

  it("sans option ni audio, reproduit l'ancien montage (un seul morceau)", () => {
    const p = buildPlan({ start: 2, end: 25, peak: 12, loudness: null, words: WORDS, coldOpen: false, trimSilence: true });
    expect(p.segments).toEqual([{ from: 2, to: 25, kind: "body" }]);
    expect(p.removed).toBe(0);
  });

  it("le cold open ne coupe pas un mot en deux", () => {
    const words: Word[] = [{ w: "nooon", s: 9.3, e: 10.2 }, { w: "frérot", s: 11.0, e: 11.4 }];
    const [a, b] = teaserWindow(10, 0, 20, words)!;
    for (const w of words) expect(a <= w.s || a >= w.e).toBe(true), expect(b <= w.s || b >= w.e).toBe(true);
  });
});

describe("bornes intelligentes", () => {
  it("démarre sur un début de phrase et met les premiers mots dans la première seconde", () => {
    const r = refineBounds({ start: 7.2, end: 31, peak: 24.5, sourceDur: 40, words: WORDS, loudness: null });
    expect(r.start).toBeCloseTo(6.3, 2); // phrase de 6,5 s, 0,2 s avant
    const r2 = refineBounds({ start: 3.5, end: 31, peak: 24.5, sourceDur: 40, words: WORDS, loudness: null });
    // aucun début de phrase proche de 3,5 → le premier mot (6,5) arrive trop tard : on avance le début
    const firstWord = WORDS.find((w) => w.s >= r2.start)!;
    expect(firstWord.s - r2.start).toBeLessThanOrEqual(1);
  });

  it("finit la phrase en cours au lieu de couper au milieu", () => {
    const r = refineBounds({ start: 0.8, end: 28.7, peak: 24.5, sourceDur: 40, words: WORDS, loudness: null });
    expect(r.end).toBeCloseTo(29.4 + 0.35, 2);
  });

  it("laisse retomber la réaction (sonie encore haute à la fin)", () => {
    const l = loudness(40, -30, [[20, 29.3, -8]]);
    const r = refineBounds({ start: 10, end: 27, peak: 22, sourceDur: 40, words: [], loudness: l });
    expect(r.end).toBeGreaterThan(29.2);
    expect(r.end).toBeLessThanOrEqual(30.1);
  });

  it("garde toujours le pic dans le clip", () => {
    const r = refineBounds({ start: 23, end: 24, peak: 24, sourceDur: 30, words: WORDS, loudness: null });
    expect(r.start).toBeLessThanOrEqual(21);
    expect(r.end).toBeGreaterThanOrEqual(25.5);
  });
});

describe("zoom d'impact", () => {
  const plan = buildPlan({ start: 0.5, end: 31, peak: 24.5, loudness: LOUD, words: WORDS, coldOpen: true, trimSilence: true });
  const wins = zoomWindows(plan, 24.5);
  it("zoome au pic, progressivement, et revient à 1", () => {
    expect(wins).toHaveLength(2);
    const at = wins[1]!.at;
    expect(zoomAt(wins, at - 1)).toBe(1);
    expect(zoomAt(wins, at)).toBeGreaterThan(1);
    expect(zoomAt(wins, at)).toBeLessThan(zoomAt(wins, at + 0.5));
    expect(zoomAt(wins, at + 1)).toBeCloseTo(1.12, 3);
    expect(zoomAt(wins, at + 4)).toBe(1);
    // Le zoom du cold open s'arrête net au retour au début.
    expect(zoomAt(wins, plan.teaserDur + 0.01)).toBe(1);
  });
  it("produit une expression ffmpeg équivalente", () => {
    const e = zoomExpr(wins, "t");
    expect(e).toMatch(/^1\+0\.12\*max\(/);
    expect(e).toContain(`lt(t,${plan.teaserDur.toFixed(3)})`);
    expect(zoomExpr([], "t")).toBe("1");
  });
});

describe("styles de sous-titres", () => {
  const words: Word[] = [
    { w: "attends", s: 0.2, e: 0.5 },
    { w: "non", s: 0.55, e: 0.8 },
    { w: "regarde", s: 0.85, e: 1.2 },
    { w: "ça", s: 1.25, e: 1.5 },
  ];
  const base = { duration: 5, words, font: "Poppins ExtraBold", highlight: "#FFE600", layout: layoutFor("BLUR", 820), emphasis: ["non"] };

  it("chaque style produit un rendu différent", () => {
    const outs = CAPTION_STYLES.map((style) => buildAss({ ...base, style }));
    expect(new Set(outs).size).toBe(CAPTION_STYLES.length);
    const caption = (a: string) => a.split("\n").find((l) => l.startsWith("Style: Caption"))!;
    expect(new Set(outs.map(caption)).size).toBe(CAPTION_STYLES.length);
  });

  it("Impact : un ou deux mots à la fois, mots forts agrandis", () => {
    const ass = buildAss({ ...base, style: "impact" });
    expect(ass).toMatch(/Style: Caption,Anton,150/);
    expect(ass).toMatch(/\\fscx125\\fscy125[^}]*\}NON/);
  });

  it("Karaoké : la phrase entière remplie au fil des mots", () => {
    const ass = buildAss({ ...base, style: "karaoke" });
    const lines = ass.split("\n").filter((l) => l.startsWith("Dialogue: 2,"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/\\kf\d+/);
  });

  it("Encadré et Discret gardent la casse d'origine", () => {
    expect(buildAss({ ...base, style: "boxed" })).toContain("}attends");
    expect(buildAss({ ...base, style: "minimal" })).toContain("attends");
    expect(buildAss({ ...base, style: "boxed" })).toMatch(/Style: Caption,[^\n]*,3,16,0,5/); // boîte opaque
  });

  it("met en valeur les mots forts par défaut sans tout colorer", () => {
    const e = defaultEmphasis([{ w: "attends", s: 0, e: 1 }, { w: "le", s: 0, e: 1 }, { w: "NON!", s: 0, e: 1 }, { w: "T1.0", s: 0, e: 1 }, { w: "250", s: 0, e: 1 }]);
    expect(e).toEqual(expect.arrayContaining(["attends", "non", "250"]));
    expect(e).not.toContain("le");
    expect(e).not.toContain("t10");
    expect(normWord("Frérot !")).toBe("frerot");
  });

  it("barre de progression, flash et carton de fin", () => {
    const ass = buildAss({ ...base, progressBar: true, flashAt: 1.6, endCard: { title: "Abonne-toi pour la suite", credit: "twitch.tv/inox", duration: 2.5 } });
    expect(ass).toMatch(/\\fscx0\\t\(0,5000,\\fscx100\)\\p1\}m 0 0 l 1080 0 1080 12 0 12/);
    expect(ass).toMatch(/Dialogue: 6,0:00:01\.60,0:00:01\.90,Shape/);
    expect(ass).toMatch(/Dialogue: 8,0:00:05\.10,0:00:07\.50,CardTitle,[^\n]*ABONNE-TOI/);
    expect(ass).toContain("twitch.tv/inox");
  });
});

describe("filtergraph du montage", () => {
  const base = { source: "s.mp4", out: "o.mp4", cwd: "/tmp", start: 0, duration: 20, zoom: 1.35, srcWidth: 1920, srcHeight: 1080, hasAudio: true, assFile: "captions.ass" as string | null, template: "BLUR" as const };
  const segments = [{ from: 22, to: 23.6 }, { from: 0.5, to: 2.9 }, { from: 6.4, to: 31 }];

  it("une entrée par morceau, assemblées par concat avec micro-fondus", () => {
    const args = renderArgs({ ...base, segments });
    expect(args.filter((a) => a === "-i")).toHaveLength(3);
    expect(args.slice(args.indexOf("-ss"), args.indexOf("-ss") + 4)).toEqual(["-ss", "22.000", "-t", "1.600"]);
    const fg = buildFilterGraph({ ...base, segments });
    expect(fg).toContain("[v0][a0][v1][a1][v2][a2]concat=n=3:v=1:a=1[cv][ca]");
    expect(fg).toMatch(/afade=t=out:st=1\.585:d=0\.015\[a0\]/);
    expect(fg).toMatch(/\[cv\]fps=30/);
  });

  it("zoom d'impact et carton de fin", () => {
    const fg = buildFilterGraph({ ...base, punchZoom: [{ at: 10, cutAt: Infinity }], endCardSec: 2.5 });
    expect(fg).toMatch(/scale=1080:820:flags=lanczos,zoompan=z='1\+0\.12\*[^']+':x='iw\/2-iw\/zoom\/2':y='ih\/2-ih\/zoom\/2':d=1:s=1080x820:fps=30\[fg\]/);
    expect(fg).toContain("tpad=stop_mode=clone:stop_duration=2.500");
    expect(fg).toContain("apad=pad_dur=2.500[a]");
  });

  it("sans audio, pas de chaîne son", () => {
    const fg = buildFilterGraph({ ...base, hasAudio: false, segments });
    expect(fg).toContain("concat=n=3:v=1:a=0[cv]");
    expect(fg).not.toContain("loudnorm");
  });
});

describe("options par clip", () => {
  it("reprend le défaut de l'utilisateur pour toute option absente ou invalide", () => {
    const s = parseSettings({ coldOpen: false, captionStyle: "impact" });
    expect(effectiveEdit(s, {})).toMatchObject({ coldOpen: false, captionStyle: "impact", trimSilence: true, endCard: false });
    expect(effectiveEdit(s, { coldOpen: true, captionStyle: "nope", endCard: "oui" })).toMatchObject({ coldOpen: true, captionStyle: "impact", endCard: false });
    expect(effectiveEdit(s, null).punchZoom).toBe(true);
  });
  it("les anciens réglages sans les nouvelles clés restent valides", () => {
    const s = parseSettings({ sensitivity: 4, captionFont: "Anton" });
    expect(s.captionStyle).toBe("classic");
    expect(s.endCardText.length).toBeGreaterThan(0);
  });
  it("lit le résumé du montage avec prudence", () => {
    expect(montageSummary(null)).toBeNull();
    expect(montageSummary({ duration: 22.4, teaserDur: 1.6, removed: "x" })).toEqual({ duration: 22.4, teaserDur: 1.6, removed: 0, cuts: 0, endCard: 0 });
  });
});

describe("ponctuation isolée", () => {
  it("recolle un « ! » transcrit à part au mot précédent", () => {
    const ass = buildAss({
      duration: 5,
      words: [{ w: "incroyable", s: 0.2, e: 0.8 }, { w: "!", s: 0.85, e: 0.9 }],
      font: "Poppins ExtraBold",
      highlight: "#FFE600",
      layout: layoutFor("BLUR", 820),
      style: "impact",
    });
    expect(ass).toContain("INCROYABLE !");
    expect(ass.split("\n").filter((l) => l.startsWith("Dialogue: 2,"))).toHaveLength(1);
  });
});

describe("accroches", () => {
  it("écarte les formules creuses et les accroches trop longues", () => {
    expect(isGoodHook("REGARDEZ ÇA")).toBe(false);
    expect(isGoodHook("Incroyable !")).toBe(false);
    expect(isGoodHook("attendez la fin")).toBe(false);
    expect(isGoodHook("il vole la voiture du chef de la police ce soir")).toBe(false); // 10 mots
    expect(isGoodHook("Il vole la voiture de police")).toBe(true);
    expect(isGoodHook("Pourquoi il saute ? 🔥")).toBe(false);
  });
  it("garde trois accroches d'angles différents, en complétant avec les candidates", () => {
    const picked = pickHooks(
      [
        { angle: "reaction", text: "Il hurle en pleine course" },
        { angle: "reaction", text: "Il n'en revient pas" },
        { angle: "curiosite", text: "INCROYABLE" },
      ],
      [
        { angle: "question", text: "Comment il s'en sort ?" },
        { angle: "citation", text: "« J'y crois pas frérot »" },
        { angle: "reaction", text: "Il hurle en pleine course" },
      ],
    );
    expect(picked.map((h) => h.angle)).toEqual(["reaction", "question", "citation"]);
    expect(picked.map((h) => h.text)).not.toContain("INCROYABLE");
  });
});

describe("zone sûre TikTok / Shorts", () => {
  it("place tous les textes hors des zones masquées par les applis", () => {
    for (const tpl of ["BLUR", "FULL", "FACECAM"] as const) {
      for (const band of [608, 820, 1080]) {
        const l = layoutFor(tpl, band);
        expect(l.captionY + 90).toBeLessThanOrEqual(SAFE_ZONE.bottom);
        expect(l.hookY - 135).toBeGreaterThanOrEqual(SAFE_ZONE.top);
        expect(l.hookY + 135).toBeLessThanOrEqual(SAFE_ZONE.bottom);
        expect(l.credit.y).toBeGreaterThanOrEqual(SAFE_ZONE.top);
        expect(l.credit.x).toBeGreaterThanOrEqual(SAFE_ZONE.left);
      }
    }
    // Largeur utile de 820 px centrée à gauche de la colonne de boutons.
    expect(SAFE_CENTER_X + 410).toBeLessThanOrEqual(SAFE_ZONE.right);
  });
  it("durées par défaut dans la plage des formats courts", () => {
    const s = parseSettings({});
    expect(s.clipMinSec).toBe(15);
    expect(s.clipMaxSec).toBe(45);
  });
});
