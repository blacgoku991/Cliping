import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  buildChapters,
  buildTimeline,
  channelUrl,
  chapterTime,
  chaptersText,
  chaptersValid,
  cleanLabel,
  defaultMeta,
  fullDescription,
  MIN_CHAPTER_SEC,
  momentLabels,
  momentNumber,
  montageSignature,
  moveItem,
  orderMoments,
  pickBest,
  sameMoment,
  type MomentCandidate,
} from "@/lib/compilation";
import type { PublishInput } from "@/lib/platforms/types";
import { setThumbnail, tagsWithin, youtube } from "@/lib/platforms/youtube";
import { buildCompilationAss, buildThumbAss, compilationArgs, compilationFilterGraph, MARKER_SEC } from "@/worker/render/compilation";

function cand(id: string, score: number, over: Partial<MomentCandidate> = {}): MomentCandidate {
  const at = over.at ?? 100;
  return { clipId: id, title: `Clip ${id}`, score, at, from: at - 10, to: at + 10, recordingId: "r1", streamerId: "s1", createdAt: 1000, duration: 20, ...over };
}

describe("choix et ordre des moments", () => {
  it("garde les meilleurs scores, sans deux clips du même moment", () => {
    const list = [
      cand("a", 90, { at: 100 }),
      cand("b", 85, { at: 104 }), // même moment que a (fenêtres presque identiques)
      cand("c", 80, { at: 130 }), // 30 s plus tard : autre moment
      cand("d", 70, { at: 100, recordingId: "r2" }), // autre live
      cand("e", 60, { at: 300 }),
    ];
    expect(pickBest(list, 3).map((c) => c.clipId)).toEqual(["a", "c", "d"]);
    expect(pickBest(list, 10).map((c) => c.clipId)).toEqual(["a", "c", "d", "e"]);
  });

  it("deux clips proches mais distincts (21 s d'écart) ne sont pas des doublons", () => {
    expect(sameMoment(cand("a", 1, { at: 100, from: 90, to: 110 }), cand("b", 1, { at: 121, from: 111, to: 131 }))).toBe(false);
    expect(sameMoment(cand("a", 1, { at: 100, from: 90, to: 110 }), cand("b", 1, { at: 105, from: 92, to: 112 }))).toBe(true);
  });

  it("compte à rebours : le meilleur en dernier ; chrono : dans l'ordre du live", () => {
    const list = [cand("a", 90, { at: 50 }), cand("b", 60, { at: 300 }), cand("c", 75, { at: 10 })];
    expect(orderMoments(list, "countdown").map((c) => c.clipId)).toEqual(["b", "c", "a"]);
    expect(orderMoments(list, "chrono").map((c) => c.clipId)).toEqual(["c", "a", "b"]);
  });

  it("numérote #N → #1 en compte à rebours, 1 → N sinon", () => {
    expect([0, 1, 2].map((i) => momentNumber(i, 3, true))).toEqual([3, 2, 1]);
    expect([0, 1, 2].map((i) => momentNumber(i, 3, false))).toEqual([1, 2, 3]);
  });

  it("déplace un moment (glisser-déposer et flèches), bornes comprises", () => {
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveItem(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
    expect(moveItem(["a", "b", "c"], 2, 9)).toEqual(["a", "b", "c"]);
  });

  it("distingue les titres génériques en double par l'instant du live", () => {
    expect(momentLabels([
      { title: "Inox sur GTA 6 🔥", at: 101 },
      { title: "Inox sur GTA 6 😱", at: 3725 },
      { title: "Le braquage #gta6", at: 40 },
    ])).toEqual(["Inox sur GTA 6, à 1:41 du live", "Inox sur GTA 6, à 1:02:05 du live", "Le braquage"]);
  });
});

describe("chronologie et chapitres YouTube", () => {
  it("place les moments bout à bout, à l'image près", () => {
    const t = buildTimeline([20.01, 15, 30], { intro: true, fps: 30, introSec: 3.5, outroSec: 4 });
    expect(t.intro).toBe(3.5);
    expect(t.moments).toEqual([
      { at: 3.5, duration: 20 },
      { at: 23.5, duration: 15 },
      { at: 38.5, duration: 30 },
    ]);
    expect(t.outroAt).toBe(68.5);
    expect(t.total).toBe(72.5);
    expect(buildTimeline([10], { intro: false }).moments[0]!.at).toBe(0);
  });

  it("premier chapitre à 00:00, les suivants pile au début de chaque moment", () => {
    const t = buildTimeline([20, 15, 30], { intro: true, introSec: 3.5 });
    const ch = buildChapters(t, ["#3 Le saut", "#2 La poursuite", "#1 Le braquage"]);
    expect(ch).toEqual([
      { at: 0, title: "#3 Le saut" },
      { at: 23.5, title: "#2 La poursuite" },
      { at: 38.5, title: "#1 Le braquage" },
    ]);
    expect(chaptersValid(ch, t.total)).toBe(true);
    expect(chaptersText(ch, t.total)).toBe("00:00 #3 Le saut\n00:23 #2 La poursuite\n00:38 #1 Le braquage");
  });

  it("rattache un moment de moins de 10 s au chapitre précédent", () => {
    const t = buildTimeline([20, 6, 15, 20], { intro: false });
    const ch = buildChapters(t, ["A", "B", "C", "D"]);
    expect(ch.map((c) => c.title)).toEqual(["A", "B / C", "D"]);
    expect(ch.map((c) => c.at)).toEqual([0, 20, 41]);
    expect(chaptersValid(ch, t.total)).toBe(true);
    for (let i = 0; i < ch.length; i++) expect((ch[i + 1]?.at ?? t.total) - ch[i]!.at).toBeGreaterThanOrEqual(MIN_CHAPTER_SEC);
  });

  it("pas de chapitres plutôt que des chapitres que YouTube ignorerait (moins de 3)", () => {
    const t = buildTimeline([30, 30], { intro: true });
    expect(buildChapters(t, ["A", "B"])).toEqual([]);
    expect(chaptersValid([{ at: 1, title: "x" }, { at: 20, title: "y" }, { at: 40, title: "z" }], 60)).toBe(false);
  });

  it("formate les horodatages, heures comprises", () => {
    expect(chapterTime(0)).toBe("00:00");
    expect(chapterTime(75.9)).toBe("01:15");
    expect(chapterTime(3723)).toBe("1:02:03");
    expect(chapterTime(5, true)).toBe("0:00:05");
  });

  it("nettoie les titres (emoji, hashtags, retours à la ligne) sans toucher au numéro du moment", () => {
    expect(cleanLabel("#3 Il saute du pont 😱 #gta6\nincroyable")).toBe("#3 Il saute du pont incroyable");
    expect(cleanLabel("x".repeat(100), 20)).toHaveLength(20);
  });
});

describe("titre, description, crédits", () => {
  it("titre de recherche honnête et texte de miniature court", () => {
    const m = defaultMeta({ streamers: ["Inox"], game: "GTA 6", count: 10, kind: "recording", moments: [] });
    expect(m.title).toBe("Inox sur GTA 6 : les 10 meilleurs moments du live");
    expect(m.thumbText).toBe("TOP 10 Inox");
    expect(m.tags).toContain("gta 6");
    const multi = defaultMeta({ streamers: ["A", "B", "C", "D"], game: "GTA 6", count: 8, kind: "day", moments: [] });
    expect(multi.title).toBe("GTA 6 : les 8 meilleurs moments des streamers (A, B et 2 autres)");
    expect(multi.title.length).toBeLessThanOrEqual(100);
  });

  it("description complète : texte, chapitres, crédits avec liens, 3 hashtags", () => {
    const t = buildTimeline([20, 15, 30], { intro: true });
    const d = fullDescription({
      text: "Les meilleurs moments <b>du live</b>.",
      chapters: buildChapters(t, ["#3 A", "#2 B", "#1 C"]),
      total: t.total,
      credits: [{ name: "Inox", url: channelUrl("TWITCH", "inox") }, { name: "Import", url: null }],
      tags: ["GTA 6", "inox", "best of", "clips"],
    });
    expect(d).toContain("Chapitres :\n00:00 #3 A\n00:23 #2 B\n00:38 #1 C");
    expect(d).toContain("• Inox : https://www.twitch.tv/inox");
    expect(d).toContain("• Import\n");
    expect(d.endsWith("#gta6 #inox #bestof")).toBe(true);
    expect(d).not.toMatch(/[<>]/);
  });

  it("l'empreinte du montage change avec l'ordre, un titre de moment ou une option", () => {
    const base = { items: [{ clipId: "a", label: "A", start: 1, end: 20 }, { clipId: "b", label: "B", start: 2, end: 30 }], countdown: true, captions: true, intro: true, title: "T" };
    const sig = montageSignature(base);
    expect(montageSignature({ ...base })).toBe(sig);
    expect(montageSignature({ ...base, items: [...base.items].reverse() })).not.toBe(sig);
    expect(montageSignature({ ...base, captions: false })).not.toBe(sig);
    expect(montageSignature({ ...base, intro: false, title: "autre" })).toBe(montageSignature({ ...base, intro: false }));
  });
});

describe("montage horizontal", () => {
  const segs = [
    { source: "/a.mp4", from: 10, duration: 3.5, width: 1920, height: 1080, hasAudio: true, kind: "intro" as const },
    { source: "/a.mp4", from: 2, duration: 20, width: 1280, height: 720, hasAudio: true, kind: "moment" as const },
    { source: "/b.mp4", from: 4, duration: 15, width: 1080, height: 1920, hasAudio: false, kind: "moment" as const },
  ];
  const input = { segments: segs, outroSec: 4, out: "/o.mp4", cwd: "/tmp", assFile: "captions.ass", fps: 30 };

  it("chaque morceau dure exactement ce que prévoit la chronologie (chapitres justes)", () => {
    const g = compilationFilterGraph(input);
    expect(g).toContain("trim=duration=3.500");
    expect(g).toContain("trim=duration=20.000");
    expect(g).toContain("apad=whole_dur=15.000,atrim=duration=15.000");
    expect(g).toContain("concat=n=3:v=1:a=1[cv][ca]");
    expect(g).toContain("tpad=stop_mode=clone:stop_duration=4.000");
  });

  it("son ramené à -14 LUFS moment par moment ; silence généré pour une source muette", () => {
    const g = compilationFilterGraph(input);
    expect(g.match(/loudnorm=I=-14/g)).toHaveLength(2);
    expect(g).toContain("[3:a]aresample"); // entrée anullsrc ajoutée après les 3 sources
    const args = compilationArgs(input);
    expect(args.filter((a) => a.startsWith("anullsrc"))).toHaveLength(1);
    expect(args.slice(args.indexOf("-progress"), args.indexOf("-progress") + 2)).toEqual(["-progress", "pipe:1"]);
  });

  it("fond flouté seulement pour une source qui n'est pas en 16:9", () => {
    const g = compilationFilterGraph(input);
    expect(g).not.toContain("[b0]");
    expect(g).not.toContain("[b1]");
    expect(g).toContain("[b2]scale=384:216");
  });

  it("textes : titre d'ouverture, repère numéroté, crédit, sous-titres recalés, carton de fin", () => {
    const t = buildTimeline([20, 15, 30], { intro: true });
    const ass = buildCompilationAss({
      timeline: t,
      moments: [
        { number: 3, label: "Le saut", credit: "twitch.tv/inox", words: [{ w: "non!", s: 5, e: 5.5 }], emphasis: ["non"] },
        { number: 2, label: "La poursuite", credit: "", words: [], emphasis: [] },
        { number: 1, label: "Le braquage", credit: "kick.com/x", words: [{ w: "go", s: 40, e: 40.3 }], emphasis: [] },
      ],
      introTitle: "Inox : les 3 meilleurs moments",
      introKicker: "Top 3",
      outroCredits: ["twitch.tv/inox", "kick.com/x"],
      highlight: "#FF4D8D",
      captions: true,
    });
    expect(ass).toContain("PlayResX: 1920");
    expect(ass).toMatch(/Dialogue: 2,0:00:00\.15,0:00:03\.50,Title,.*INOX : LES 3 MEILLEURS MOMENTS/);
    expect(ass).toMatch(new RegExp(`Dialogue: 4,0:00:03\\.65,0:00:0${(3.5 + MARKER_SEC).toFixed(2).replace(".", "\\.")},Number,.*#3`));
    expect(ass).toMatch(/Dialogue: 4,0:00:23\.65,.*Number,.*#2/);
    expect(ass).toContain("twitch.tv/inox");
    expect(ass).toMatch(/Dialogue: 2,0:00:05\.00,[^,]+,Sub,,0,0,0,,\{\\c&H8D4DFF&\}non!/);
    expect(ass).toMatch(/Dialogue: 8,0:01:08\.65,0:01:12\.50,Title,.*MERCI/);
  });

  it("sans sous-titres : aucun évènement Sub", () => {
    const t = buildTimeline([20, 15, 30], { intro: false });
    const ass = buildCompilationAss({ timeline: t, moments: [0, 1, 2].map((i) => ({ number: i + 1, label: `M${i}`, credit: "", words: [{ w: "x", s: t.moments[i]!.at + 1, e: t.moments[i]!.at + 2 }], emphasis: [] })), introTitle: "", introKicker: "", outroCredits: [], highlight: "#ffffff", captions: false });
    expect(ass).not.toMatch(/,Sub,/);
  });

  it("miniature : texte court en gros, sur-titre dans un cadre", () => {
    const ass = buildThumbAss("Inox sur GTA 6", "TOP 10", "#FF4D8D");
    expect(ass).toContain("PlayResX: 1280");
    expect(ass).toContain("TOP 10");
    expect(ass).toMatch(/INOX SUR\\N\{\\c&H8D4DFF&\}GTA 6/);
  });
});

// ───────────────────────── Envoi YouTube (réseau simulé : vérifie NOTRE enchaînement d'appels, pas YouTube) ─────────────────────────

let dir: string;
let video: string;
let thumb: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "cliping-comp-"));
  video = path.join(dir, "final.mp4");
  thumb = path.join(dir, "thumb.jpg");
  await writeFile(video, Buffer.alloc(1024, 1));
  await writeFile(thumb, Buffer.alloc(2048, 2));
});
afterAll(() => rm(dir, { recursive: true, force: true }));
afterEach(() => vi.unstubAllGlobals());

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  json: unknown;
  size: number;
}
function mockFetch(handler: (c: Call) => Response): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: string | URL, init: RequestInit = {}) => {
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    let json: unknown = null;
    if (typeof init.body === "string") json = JSON.parse(init.body);
    const c = { url: String(url), method: init.method ?? "GET", headers, json, size: init.body instanceof Uint8Array ? init.body.byteLength : 0 };
    calls.push(c);
    return handler(c);
  });
  return calls;
}
const res = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });

function input(over: Partial<PublishInput> = {}): PublishInput & { saved: Array<Record<string, unknown>> } {
  const saved: Array<Record<string, unknown>> = [];
  return {
    filePath: video,
    fileSize: 1024,
    title: "Inox sur GTA 6 : les 10 meilleurs moments du live",
    description: "Texte\n\nChapitres :\n00:00 #10 A",
    hashtags: ["inox", "gta 6", "best of"],
    privacy: "public",
    durationSec: 300,
    format: "video",
    thumbnailPath: thumb,
    state: {},
    saveState: async (s) => void saved.push(s),
    saved,
    ...over,
  };
}

describe("YouTube : compilation en vidéo classique", () => {
  it("envoie une vidéo (lien watch, pas Short), description intacte, mots-clés, puis la miniature", async () => {
    const calls = mockFetch((c) => {
      if (c.url.includes("/upload/youtube/v3/videos")) return res({}, 200, { location: "https://upload.example/s1" });
      if (c.url.includes("/thumbnails/set")) return res({ items: [{}] });
      return res({ id: "VIDEO1", status: { privacyStatus: "public" } }, 201);
    });
    const inp = input();
    const r = await youtube.publish("tok", inp);
    expect(r).toMatchObject({ status: "PUBLISHED", externalId: "VIDEO1", url: "https://www.youtube.com/watch?v=VIDEO1" });
    expect(r.note).toBeUndefined();
    const init = calls[0]!.json as { snippet: { description: string; tags: string[]; categoryId: string } };
    expect(init.snippet.description).toBe("Texte\n\nChapitres :\n00:00 #10 A"); // pas de hashtags ajoutés en plus
    expect(init.snippet.tags).toEqual(["inox", "gta 6", "best of"]);
    expect(init.snippet.categoryId).toBe("20");
    const t = calls.find((c) => c.url.includes("/thumbnails/set"))!;
    expect(t.url).toBe("https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=VIDEO1&uploadType=media");
    expect(t.method).toBe("POST");
    expect(t.headers["content-type"]).toBe("image/jpeg");
    expect(t.size).toBe(2048);
    expect(inp.saved.at(-1)).toEqual({ sessionUri: "https://upload.example/s1", thumbnailSet: true });
  });

  it("une miniature refusée (chaîne non vérifiée) n'empêche pas la publication : elle devient une note", async () => {
    mockFetch((c) => {
      if (c.url.includes("/upload/youtube/v3/videos")) return res({}, 200, { location: "https://upload.example/s2" });
      if (c.url.includes("/thumbnails/set")) return res({ error: { message: "forbidden", errors: [{ reason: "forbidden" }] } }, 403);
      return res({ id: "V2", status: { privacyStatus: "public" } }, 201);
    });
    const r = await youtube.publish("tok", input());
    expect(r.status).toBe("PUBLISHED");
    expect(r.note).toMatch(/vérifiée/);
  });

  it("reprise après coupure : ne renvoie ni la vidéo ni une miniature déjà posée", async () => {
    const calls = mockFetch(() => res({ id: "V3", status: { privacyStatus: "public" } }, 200));
    const r = await youtube.publish("tok", input({ state: { sessionUri: "https://upload.example/old", thumbnailSet: true } }));
    expect(r.externalId).toBe("V3");
    expect(calls).toHaveLength(1);
  });

  it("un clip vertical reste un Short sans miniature", async () => {
    const calls = mockFetch((c) => (c.method === "POST" ? res({}, 200, { location: "https://u/s" }) : res({ id: "S1", status: { privacyStatus: "public" } }, 201)));
    const r = await youtube.publish("tok", input({ format: undefined, thumbnailPath: null }));
    expect(r.url).toBe("https://www.youtube.com/shorts/S1");
    expect(calls.some((c) => c.url.includes("thumbnails"))).toBe(false);
  });

  it("miniature trop lourde : refusée avant envoi", async () => {
    const big = path.join(dir, "big.jpg");
    await writeFile(big, Buffer.alloc(2 * 1024 * 1024 + 1));
    const calls = mockFetch(() => res({}));
    expect(await setThumbnail("tok", "V", big)).toMatch(/2 Mo/);
    expect(calls).toHaveLength(0);
  });

  it("mots-clés tenus dans la limite de 500 caractères de YouTube", () => {
    const tags = Array.from({ length: 60 }, (_, i) => `mot cle ${i}`);
    const kept = tagsWithin(tags, 450);
    const cost = kept.reduce((n, t, i) => n + t.length + 2 + (i ? 1 : 0), 0);
    expect(cost).toBeLessThanOrEqual(450);
    expect(kept.length).toBeGreaterThan(10);
  });
});
