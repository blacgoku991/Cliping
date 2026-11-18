import { afterEach, describe, expect, it, vi } from "vitest";
import {
  compact,
  compareGroups,
  durationBucket,
  hookStyle,
  hourSlot,
  isValidTimeZone,
  localHour,
  median,
  MIN_SAMPLE,
  nextCheckDelayMs,
  ratioLabel,
  valueAt,
  viewsAtAge,
} from "@/lib/stats/math";
import { canReadStats, fetchTiktokStats, fetchYoutubeStats, trackability } from "@/lib/stats/platforms";
import { PlatformRejectedError, ReauthRequiredError } from "@/lib/platforms/types";

const H = 3600_000;

describe("médiane", () => {
  it("prend la valeur du milieu, ou la moyenne des deux du milieu", () => {
    expect(median([])).toBeNull();
    expect(median([5])).toBe(5);
    expect(median([9, 1, 5])).toBe(5);
    expect(median([1, 2, 3, 100])).toBe(2.5);
  });
  it("résiste à une valeur extrême, contrairement à la moyenne", () => {
    expect(median([100, 120, 110, 1_000_000, 90])).toBe(110);
  });
});

describe("rythme des relevés", () => {
  it("relève souvent au début puis de plus en plus rarement, et s'arrête après 90 jours", () => {
    expect(nextCheckDelayMs(0.5 * H)).toBe(15 * 60_000);
    expect(nextCheckDelayMs(3 * H)).toBe(30 * 60_000);
    expect(nextCheckDelayMs(30 * H)).toBe(2 * H);
    expect(nextCheckDelayMs(4 * 24 * H)).toBe(12 * H);
    expect(nextCheckDelayMs(20 * 24 * H)).toBe(24 * H);
    expect(nextCheckDelayMs(60 * 24 * H)).toBe(7 * 24 * H);
    expect(nextCheckDelayMs(91 * 24 * H)).toBeNull();
  });
});

describe("vues à un âge donné", () => {
  const pub = new Date("2026-11-01T12:00:00Z");
  const at = (h: number) => new Date(pub.getTime() + h * H);
  const now = pub.getTime() + 100 * H;

  it("interpole entre deux relevés", () => {
    const snaps = [{ at: at(20), views: 1000 }, { at: at(26), views: 1600 }];
    expect(viewsAtAge(pub, snaps, 24, now)).toBe(1400);
  });
  it("renvoie la valeur exacte d'un relevé tombant pile", () => {
    expect(viewsAtAge(pub, [{ at: at(24), views: 777 }], 24, now)).toBe(777);
  });
  it("part de zéro vue à la mise en ligne", () => {
    expect(viewsAtAge(pub, [{ at: at(2), views: 200 }], 1, now)).toBe(100);
  });
  it("refuse d'estimer si la publication est trop récente", () => {
    expect(viewsAtAge(pub, [{ at: at(2), views: 200 }], 24, pub.getTime() + 10 * H)).toBeNull();
  });
  it("refuse d'estimer si le relevé suivant est trop loin (suivi commencé tard)", () => {
    expect(viewsAtAge(pub, [{ at: at(24 * 8), views: 50_000 }], 24, now + 1000 * H)).toBeNull();
  });
  it("valueAt donne la dernière valeur connue à une date", () => {
    const snaps = [{ at: at(1), views: 10 }, { at: at(5), views: 50 }];
    expect(valueAt(snaps, at(0).getTime())).toBe(0);
    expect(valueAt(snaps, at(3).getTime())).toBe(10);
    expect(valueAt(snaps, at(9).getTime())).toBe(50);
  });
});

describe("regroupements", () => {
  it("lit l'heure dans le fuseau de l'utilisateur, pas celui du serveur", () => {
    const d = new Date("2026-11-18T17:30:00Z");
    expect(localHour(d, "UTC")).toBe(17);
    expect(localHour(d, "Europe/Paris")).toBe(18);
    expect(localHour(d, "America/Montreal")).toBe(12);
    // Heure d'été : Paris = UTC+2
    expect(localHour(new Date("2026-07-01T17:30:00Z"), "Europe/Paris")).toBe(19);
  });
  it("valide les fuseaux reçus du navigateur", () => {
    expect(isValidTimeZone("Europe/Paris")).toBe(true);
    expect(isValidTimeZone("Pas/UnFuseau")).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
  });
  it("range les heures par créneaux de 4 h", () => {
    expect(hourSlot(0).key).toBe("0-4");
    expect(hourSlot(17).key).toBe("16-20");
    expect(hourSlot(23).key).toBe("20-24");
  });
  it("range les durées", () => {
    expect(durationBucket(12).key).toBe("lt20");
    expect(durationBucket(20).key).toBe("20-35");
    expect(durationBucket(49.9).key).toBe("35-50");
    expect(durationBucket(200).key).toBe("gt70");
  });
  it("reconnaît les styles d'accroche", () => {
    expect(hookStyle("")).toBe("none");
    expect(hookStyle("Il a vraiment fait ça ?")).toBe("question");
    expect(hookStyle("Quand le chat te spoile")).toBe("pov");
    expect(hookStyle("POV : tu rates le saut")).toBe("pov");
    expect(hookStyle("3 secondes pour tout perdre")).toBe("number");
    expect(hookStyle("ÇA NE PEUT PAS ÊTRE RÉEL")).toBe("shout");
    expect(hookStyle("Incroyable !")).toBe("shout");
    expect(hookStyle("Le meilleur moment du stream")).toBe("statement");
  });
});

describe("comparaison de groupes", () => {
  const sample = (key: string, value: number, accountMedian = 100) => ({ key, label: key.toUpperCase(), value, accountMedian });

  it("ne conclut pas sous le seuil d'échantillon", () => {
    const r = compareGroups([...Array(4)].map(() => sample("a", 300)).concat([...Array(4)].map(() => sample("b", 50))));
    expect(MIN_SAMPLE).toBe(5);
    expect(r.conclusive).toBe(false);
    expect(r.best).toBeNull();
    expect(r.groups.every((g) => !g.enough)).toBe(true);
    expect(r.groups.map((g) => g.n)).toEqual([4, 4]);
  });

  it("classe par médiane du rapport à la médiane du compte", () => {
    const r = compareGroups([
      ...[200, 210, 190, 205, 5000].map((v) => sample("a", v)), // un viral ne change pas la médiane
      ...[100, 90, 110, 95, 105].map((v) => sample("b", v)),
      ...[1, 2].map((v) => sample("c", v)),
    ]);
    expect(r.conclusive).toBe(true);
    expect(r.best?.key).toBe("a");
    expect(r.best?.medianRatio).toBeCloseTo(2.05);
    expect(r.worst?.key).toBe("b");
    expect(r.groups.find((g) => g.key === "c")?.enough).toBe(false);
  });

  it("compare des comptes de tailles différentes sans favoriser le gros", () => {
    // Le groupe « petit » est sur un compte 10 fois plus petit mais fait 2× sa médiane.
    const r = compareGroups([
      ...[...Array(5)].map(() => sample("gros", 1000, 1000)),
      ...[...Array(5)].map(() => sample("petit", 200, 100)),
    ]);
    expect(r.best?.key).toBe("petit");
  });

  it("respecte l'ordre imposé (créneaux, durées)", () => {
    const r = compareGroups([sample("z", 1), sample("a", 2)], ["z", "a"]);
    expect(r.groups.map((g) => g.key)).toEqual(["z", "a"]);
  });

  it("formate les écarts et les grands nombres", () => {
    expect(ratioLabel(1.4)).toBe("+40 %");
    expect(ratioLabel(0.66)).toBe("−34 %");
    expect(ratioLabel(2.5)).toBe("×2,5");
    expect(compact(950)).toBe("950");
    expect(compact(12_345)).toBe("12,3 k");
    expect(compact(2_400_000)).toBe("2,4 M");
  });
});

describe("publications suivables", () => {
  const tt = { platform: "TIKTOK" as const, scopes: "user.info.basic,video.publish,video.upload,video.list" };
  it("un brouillon TikTok n'est pas suivable", () => {
    expect(trackability({ privacy: "draft", externalId: "v_pub_file~v2-1.123" }, tt)).toBe("DRAFT");
  });
  it("un publish_id TikTok n'est pas un identifiant de vidéo", () => {
    expect(trackability({ privacy: "public", externalId: "v_pub_file~v2-1.123" }, tt)).toBe("NO_ID");
    expect(trackability({ privacy: "public", externalId: "7300000000000000001" }, tt)).toBe("OK");
  });
  it("TikTok sans video.list : pas de relevé", () => {
    expect(trackability({ privacy: "public", externalId: "7300000000000000001" }, { ...tt, scopes: "user.info.basic,video.publish" })).toBe("NO_SCOPE");
  });
  it("YouTube : youtube.readonly suffit, liste vide tolérée", () => {
    expect(canReadStats("YOUTUBE", "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly")).toBe(true);
    expect(canReadStats("YOUTUBE", "")).toBe(true);
    expect(canReadStats("YOUTUBE", "https://www.googleapis.com/auth/youtube.upload")).toBe(false);
  });
});

/**
 * Comme tests/platforms.test.ts : on rejoue les réponses documentées contre un faux réseau.
 * Cela valide notre lecture des réponses, pas le comportement réel des plateformes (non vérifié ici).
 */
describe("lecture des compteurs (réseau simulé)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const stub = (status: number, body: unknown) => {
    calls.length = 0;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    });
  };

  it("YouTube : statistiques en chaînes, compteurs masqués absents", async () => {
    stub(200, {
      items: [
        { id: "abc", statistics: { viewCount: "12345", likeCount: "678", commentCount: "9", favoriteCount: "0" } },
        { id: "def", statistics: { viewCount: "50" } },
      ],
    });
    const res = await fetchYoutubeStats("tok", ["abc", "def", "gone"]);
    expect(calls[0]!.url).toContain("/youtube/v3/videos?part=statistics&id=abc%2Cdef%2Cgone");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(res.get("abc")).toEqual({ views: 12345, likes: 678, comments: 9, shares: null });
    expect(res.get("def")).toEqual({ views: 50, likes: null, comments: null, shares: null });
    expect(res.has("gone")).toBe(false);
  });

  it("YouTube : quota épuisé et jeton refusé", async () => {
    stub(403, { error: { message: "quota", errors: [{ reason: "quotaExceeded" }] } });
    await expect(fetchYoutubeStats("tok", ["a"])).rejects.toBeInstanceOf(PlatformRejectedError);
    stub(401, { error: { message: "invalid" } });
    await expect(fetchYoutubeStats("tok", ["a"])).rejects.toBeInstanceOf(ReauthRequiredError);
  });

  it("TikTok : /v2/video/query/ avec les identifiants en filtre", async () => {
    stub(200, {
      data: { videos: [{ id: "7300000000000000001", view_count: 1000, like_count: 80, comment_count: 4, share_count: 3 }], cursor: 0, has_more: false },
      error: { code: "ok", message: "" },
    });
    const res = await fetchTiktokStats("tok", ["7300000000000000001", "7300000000000000002"]);
    expect(calls[0]!.url).toBe("https://open.tiktokapis.com/v2/video/query/?fields=id,view_count,like_count,comment_count,share_count");
    expect(calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ filters: { video_ids: ["7300000000000000001", "7300000000000000002"] } });
    expect(res.get("7300000000000000001")).toEqual({ views: 1000, likes: 80, comments: 4, shares: 3 });
    expect(res.has("7300000000000000002")).toBe(false);
  });

  it("TikTok : autorisation manquante et jeton invalide", async () => {
    stub(401, { error: { code: "scope_not_authorized", message: "" } });
    await expect(fetchTiktokStats("tok", ["1"])).rejects.toBeInstanceOf(PlatformRejectedError);
    stub(401, { error: { code: "access_token_invalid", message: "" } });
    await expect(fetchTiktokStats("tok", ["1"])).rejects.toBeInstanceOf(ReauthRequiredError);
  });
});
