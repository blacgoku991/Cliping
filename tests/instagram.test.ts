import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCaption, graphError, instagram } from "@/lib/platforms/instagram";
import { PlatformRejectedError, ReauthRequiredError, type PublishInput } from "@/lib/platforms/types";
import { appUrlIsPrivate, signedMediaUrl, signMediaToken, verifyMediaToken } from "@/lib/public-media";

/**
 * Enchaînement des appels Instagram rejoué contre un faux réseau (fetch simulé).
 * Valide NOTRE logique (ordre des appels, reprise, traduction des erreurs), pas le comportement réel de Meta :
 * les formats de réponse viennent de la documentation et de guides, aucun vrai compte n'a été utilisé.
 */

beforeEach(() => {
  process.env.APP_URL = "https://clips.example.com";
  process.env.INSTAGRAM_APP_ID = "igapp";
  process.env.INSTAGRAM_APP_SECRET = "igsecret";
  process.env.ENCRYPTION_KEY = "k".repeat(40);
  delete process.env.INSTAGRAM_GRAPH_URL;
  delete process.env.INSTAGRAM_API_VERSION;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

interface Call {
  url: URL;
  method: string;
  form: URLSearchParams | null;
}

function mockFetch(handler: (call: Call) => Response): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: string | URL, init: RequestInit = {}) => {
    const call: Call = {
      url: new URL(String(url)),
      method: init.method ?? "GET",
      form: init.body instanceof URLSearchParams ? init.body : null,
    };
    calls.push(call);
    return handler(call);
  });
  return calls;
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const gErr = (code: number, sub?: number, message = "Erreur", status = 400) => json({ error: { message, type: "OAuthException", code, error_subcode: sub } }, status);

async function settle<T>(p: Promise<T>): Promise<T> {
  let done = false;
  p.then(() => (done = true), () => (done = true));
  while (!done) {
    await vi.advanceTimersByTimeAsync(5000);
    await new Promise((r) => setImmediate(r));
  }
  return p;
}

function input(over: Partial<PublishInput> = {}): PublishInput & { saved: Array<Record<string, unknown>> } {
  const saved: Array<Record<string, unknown>> = [];
  return {
    filePath: "/tmp/inutile.mp4",
    fileSize: 1000,
    title: "Le braquage tourne mal 😱",
    description: "Extrait du live de Zack.",
    hashtags: ["gta6", "gtarp", "clips", "fr", "fails", "drole", "rp"],
    privacy: "feed",
    durationSec: 30,
    state: {},
    saveState: async (s) => void saved.push(s),
    mediaUrl: () => "https://clips.example.com/api/public-media/TOKEN/clip.mp4",
    saved,
    ...over,
  };
}

const ME = { user_id: "1789", username: "gta.moments", name: "GTA Moments", account_type: "MEDIA_CREATOR", profile_picture_url: "https://cdn/x.jpg" };

/** Faux Instagram : profil, quota, conteneur qui passe IN_PROGRESS → FINISHED, publication. */
function fakeInstagram(opts: { statuses?: string[]; publishError?: Response; quota?: [number, number]; media?: unknown[] } = {}) {
  const statuses = [...(opts.statuses ?? ["IN_PROGRESS", "FINISHED"])];
  return mockFetch((c) => {
    const p = c.url.pathname;
    if (p === "/v24.0/me") return json(ME);
    if (p === "/v24.0/1789/content_publishing_limit") return json({ data: [{ quota_usage: opts.quota?.[0] ?? 3, config: { quota_total: opts.quota?.[1] ?? 100, quota_duration: 86400 } }] });
    if (p === "/v24.0/1789/media" && c.method === "POST") return json({ id: "C1" });
    if (p === "/v24.0/1789/media" && c.method === "GET") return json({ data: opts.media ?? [] });
    if (p.startsWith("/v24.0/C")) {
      const s = statuses.length > 1 ? statuses.shift()! : statuses[0]!;
      return json(s.startsWith("ERROR") ? { status_code: "ERROR", status: s.slice(6) } : { status_code: s });
    }
    if (p === "/v24.0/1789/media_publish") return opts.publishError ?? json({ id: "M9" });
    if (p === "/v24.0/M9") return json({ permalink: "https://www.instagram.com/reel/abc/" });
    return json({ error: { message: `inattendu ${p}` } }, 404);
  });
}

describe("Instagram : connexion", () => {
  it("construit l'adresse d'autorisation (compte pro, permission de publier, state)", () => {
    const url = new URL(instagram.authUrl("etat123"));
    expect(url.origin + url.pathname).toBe("https://www.instagram.com/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("igapp");
    expect(url.searchParams.get("redirect_uri")).toBe("https://clips.example.com/api/oauth/instagram/callback");
    expect(url.searchParams.get("scope")).toBe("instagram_business_basic,instagram_business_content_publish");
    expect(url.searchParams.get("state")).toBe("etat123");
    expect(url.searchParams.get("response_type")).toBe("code");
  });

  it("échange le code contre un jeton court puis un jeton de 60 jours", async () => {
    const calls = mockFetch((c) => {
      if (c.url.host === "api.instagram.com") return json({ data: [{ access_token: "SHORT", user_id: 1789, permissions: "instagram_business_basic,instagram_business_content_publish" }] });
      return json({ access_token: "LONG", token_type: "bearer", expires_in: 5_184_000 });
    });
    const t = await instagram.exchangeCode("CODE#_");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.form?.get("code")).toBe("CODE");
    expect(calls[0]!.form?.get("grant_type")).toBe("authorization_code");
    expect(calls[0]!.form?.get("redirect_uri")).toBe("https://clips.example.com/api/oauth/instagram/callback");
    expect(calls[1]!.url.pathname).toBe("/access_token");
    expect(calls[1]!.url.searchParams.get("grant_type")).toBe("ig_exchange_token");
    expect(calls[1]!.url.searchParams.get("access_token")).toBe("SHORT");
    expect(t.accessToken).toBe("LONG");
    expect(t.refreshToken).toBe("LONG");
    expect((t.expiresAt!.getTime() - Date.now()) / 86400_000).toBeCloseTo(60, 0);
  });

  it("accepte aussi la réponse à plat (sans « data »)", async () => {
    mockFetch((c) =>
      c.url.host === "api.instagram.com"
        ? json({ access_token: "SHORT", user_id: 1789, permissions: ["instagram_business_basic", "instagram_business_content_publish"] })
        : json({ access_token: "LONG", expires_in: 100 }),
    );
    expect((await instagram.exchangeCode("C")).accessToken).toBe("LONG");
  });

  it("refuse une connexion sans la permission de publier", async () => {
    mockFetch(() => json({ data: [{ access_token: "SHORT", user_id: 1, permissions: "instagram_business_basic" }] }));
    await expect(instagram.exchangeCode("C")).rejects.toThrow(/autorisation de publier/);
  });

  it("explique une adresse de redirection non déclarée", async () => {
    mockFetch(() => json({ error_type: "OAuthException", code: 400, error_message: "Error validating verification code. Please make sure your redirect_uri is identical" }, 400));
    await expect(instagram.exchangeCode("C")).rejects.toThrow(/clips\.example\.com\/api\/oauth\/instagram\/callback/);
  });

  it("renouvelle le jeton longue durée avec lui-même", async () => {
    const calls = mockFetch(() => json({ access_token: "LONG2", token_type: "bearer", expires_in: 5_184_000 }));
    const t = await instagram.refresh("LONG");
    expect(calls[0]!.url.pathname).toBe("/refresh_access_token");
    expect(calls[0]!.url.searchParams.get("grant_type")).toBe("ig_refresh_token");
    expect(calls[0]!.url.searchParams.get("access_token")).toBe("LONG");
    expect(t).toMatchObject({ accessToken: "LONG2", refreshToken: "LONG2" });
  });

  it("jeton expiré ou révoqué → reconnecter", async () => {
    mockFetch(() => gErr(190, 463, "Error validating access token: Session has expired"));
    await expect(instagram.refresh("OLD")).rejects.toBeInstanceOf(ReauthRequiredError);
  });

  it("lit le profil d'un compte pro", async () => {
    const calls = mockFetch(() => json(ME));
    const p = await instagram.fetchProfile("T");
    expect(calls[0]!.url.searchParams.get("access_token")).toBe("T");
    expect(p).toEqual({ externalId: "1789", displayName: "GTA Moments", handle: "gta.moments", avatarUrl: "https://cdn/x.jpg" });
  });

  it("refuse un compte personnel avec la marche à suivre", async () => {
    mockFetch(() => json({ ...ME, account_type: "PERSONAL" }));
    const err = await instagram.fetchProfile("T").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PlatformRejectedError);
    expect((err as Error).message).toMatch(/compte personnel.*professionnel/);
  });
});

describe("Instagram : publication d'un Reel", () => {
  it("crée le conteneur avec le lien signé, attend le traitement, publie et renvoie le lien public", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const calls = fakeInstagram({ statuses: ["IN_PROGRESS", "IN_PROGRESS", "FINISHED"] });
    const inp = input();
    const res = await settle(instagram.publish("T", inp));
    expect(res).toMatchObject({ status: "PUBLISHED", externalId: "M9", url: "https://www.instagram.com/reel/abc/", handle: "gta.moments" });

    const create = calls.find((c) => c.method === "POST" && c.url.pathname.endsWith("/media"))!;
    expect(create.form?.get("media_type")).toBe("REELS");
    expect(create.form?.get("video_url")).toBe("https://clips.example.com/api/public-media/TOKEN/clip.mp4");
    expect(create.form?.get("share_to_feed")).toBe("true");
    const caption = create.form?.get("caption") ?? "";
    expect(caption.match(/#/g)).toHaveLength(5); // 5 hashtags maximum
    expect(caption.startsWith("Le braquage tourne mal 😱")).toBe(true);
    expect(calls.filter((c) => c.url.pathname.endsWith("/media_publish"))).toHaveLength(1);
    expect(calls.find((c) => c.url.pathname.endsWith("/media_publish"))!.form?.get("creation_id")).toBe("C1");
    // Le conteneur est noté dès sa création, puis l'intention de publier, puis le Reel publié.
    expect(inp.saved.map((s) => [s.containerId, s.publishing ?? null, s.mediaId ?? null])).toEqual([
      ["C1", null, null],
      ["C1", true, null],
      ["C1", null, "M9"],
    ]);
  });

  it("« Onglet Reels uniquement » ne partage pas dans le fil", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const calls = fakeInstagram();
    await settle(instagram.publish("T", input({ privacy: "reels_only" })));
    expect(calls.find((c) => c.method === "POST" && c.url.pathname.endsWith("/media"))!.form?.get("share_to_feed")).toBe("false");
  });

  it("reprise : un Reel déjà publié n'est pas republié", async () => {
    const calls = fakeInstagram();
    const res = await instagram.publish("T", input({ state: { containerId: "C1", mediaId: "M9", username: "gta.moments" } }));
    expect(res).toMatchObject({ status: "PUBLISHED", externalId: "M9", url: "https://www.instagram.com/reel/abc/" });
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("reprise : réponse de publication perdue, le Reel est retrouvé au lieu d'être republié", async () => {
    const caption = buildCaption(input());
    const calls = fakeInstagram({ statuses: ["FINISHED"], media: [{ id: "M9", caption, permalink: "https://www.instagram.com/reel/abc/", timestamp: new Date().toISOString() }] });
    const inp = input({ state: { containerId: "C1", caption, publishing: true } });
    const res = await instagram.publish("T", inp);
    expect(res).toMatchObject({ status: "PUBLISHED", externalId: "M9" });
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    expect(inp.saved.at(-1)).toMatchObject({ mediaId: "M9" });
  });

  it("reprise : conteneur déjà marqué publié → pas de deuxième publication", async () => {
    const calls = fakeInstagram({ statuses: ["PUBLISHED"] });
    const res = await instagram.publish("T", input({ state: { containerId: "C1", publishing: true } }));
    expect(res.status).toBe("PUBLISHED");
    expect(res.note).toMatch(/tentative précédente/);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("reprise : conteneur prêt mais jamais publié → on le publie (sans en recréer)", async () => {
    const calls = fakeInstagram({ statuses: ["FINISHED"] });
    const res = await instagram.publish("T", input({ state: { containerId: "C1" } }));
    expect(res.externalId).toBe("M9");
    expect(calls.filter((c) => c.method === "POST").map((c) => c.url.pathname)).toEqual(["/v24.0/1789/media_publish"]);
  });

  it("reprise : conteneur expiré → un nouveau est créé", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const calls = fakeInstagram({ statuses: ["EXPIRED", "FINISHED"] });
    const res = await settle(instagram.publish("T", input({ state: { containerId: "C0" } })));
    expect(res.externalId).toBe("M9");
    expect(calls.filter((c) => c.method === "POST").map((c) => c.url.pathname)).toEqual(["/v24.0/1789/media", "/v24.0/1789/media_publish"]);
  });

  it("traitement trop long : erreur temporaire (la tâche réessaiera en reprenant le même conteneur)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const calls = fakeInstagram({ statuses: ["IN_PROGRESS"] });
    const inp = input();
    const err = await settle(instagram.publish("T", inp)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(PlatformRejectedError);
    expect((err as Error).message).toMatch(/traite encore/);
    expect(inp.saved[0]).toMatchObject({ containerId: "C1" });
    expect(calls.some((c) => c.url.pathname.endsWith("/media_publish"))).toBe(false);
  });

  it("vidéo refusée (format) → message clair, définitif", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    fakeInstagram({ statuses: ["ERROR Error: Media upload has failed with error code 2207026"] });
    const err = await settle(instagram.publish("T", input())).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PlatformRejectedError);
    expect((err as Error).message).toMatch(/format de la vidéo/);
  });

  it("vidéo refusée sans code connu → message générique avec les règles des Reels", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    fakeInstagram({ statuses: ["ERROR Error: something"] });
    const err = await settle(instagram.publish("T", input())).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PlatformRejectedError);
    expect((err as Error).message).toMatch(/refusé la vidéo/);
  });

  it("quota de publications atteint (vérifié avant d'envoyer)", async () => {
    const calls = fakeInstagram({ quota: [100, 100] });
    const err = await instagram.publish("T", input()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PlatformRejectedError);
    expect((err as Error).message).toMatch(/limite de publications/);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("quota atteint au moment de publier (code 9 / 2207042)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    fakeInstagram({ publishError: gErr(9, 2207042, "Application request limit reached") });
    const err = await settle(instagram.publish("T", input())).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PlatformRejectedError);
    expect((err as Error).message).toMatch(/limite de publications/);
  });

  it("refuse d'envoyer si APP_URL n'est pas joignable depuis Internet", async () => {
    process.env.APP_URL = "http://localhost:3000";
    const calls = fakeInstagram();
    const err = await instagram.publish("T", input()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PlatformRejectedError);
    expect((err as Error).message).toMatch(/APP_URL/);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });
});

describe("Instagram : traduction des erreurs", () => {
  it.each([
    [{ code: 190 }, 400, ReauthRequiredError, /reconnecte/],
    [{ code: 10, message: "Application does not have permission for this action" }, 403, PlatformRejectedError, /autorisation manquante.*App Review/],
    [{ code: 200 }, 403, PlatformRejectedError, /autorisation manquante/],
    [{ code: 9, error_subcode: 2207042 }, 400, PlatformRejectedError, /limite de publications/],
    [{ code: 9004, error_subcode: 2207052 }, 400, PlatformRejectedError, /APP_URL/],
    [{ code: 352, error_subcode: 2207026 }, 400, PlatformRejectedError, /format/],
    [{ code: 4 }, 400, Error, /limite le nombre d'appels/],
    [{ code: -1, error_subcode: 2207001 }, 500, Error, /temporaire/],
    [{ code: 9007, error_subcode: 2207027 }, 400, Error, /temporaire/],
    [{ code: 100, message: "Invalid parameter", error_user_msg: "La légende est trop longue." }, 400, PlatformRejectedError, /trop longue/],
  ])("%j", (err, status, cls, msg) => {
    const e = graphError(err, status, "la publication");
    expect(e).toBeInstanceOf(cls);
    if (cls === Error) expect(e).not.toBeInstanceOf(PlatformRejectedError);
    expect(e.message).toMatch(msg);
  });

  it("légende : 2200 caractères maximum, hashtags compris", () => {
    const c = buildCaption({ title: "x".repeat(3000), description: "", hashtags: ["a", "b"] });
    expect([...c].length).toBeLessThanOrEqual(2200);
    expect(c.endsWith("#a #b")).toBe(true);
  });
});

describe("Lien public signé", () => {
  it("valide, limité dans le temps, infalsifiable", () => {
    const now = Date.now();
    const token = signMediaToken("pub_123456", 3600, now);
    expect(verifyMediaToken(token, now)).toEqual({ ok: true, publicationId: "pub_123456" });
    expect(verifyMediaToken(token, now + 3601_000)).toEqual({ ok: false, reason: "expired" });

    const [payload, sig] = token.split(".") as [string, string];
    // Autre publication avec la signature d'origine
    const other = Buffer.from(JSON.stringify({ p: "pub_999999", e: Math.floor(now / 1000) + 3600 })).toString("base64url");
    expect(verifyMediaToken(`${other}.${sig}`, now)).toEqual({ ok: false, reason: "invalid" });
    // Expiration repoussée
    const later = Buffer.from(JSON.stringify({ p: "pub_123456", e: Math.floor(now / 1000) + 999_999 })).toString("base64url");
    expect(verifyMediaToken(`${later}.${sig}`, now)).toEqual({ ok: false, reason: "invalid" });
    // Signature modifiée
    expect(verifyMediaToken(`${payload}.${sig.slice(0, -2)}AA`, now).ok).toBe(false);
    expect(verifyMediaToken("n'importe quoi", now).ok).toBe(false);
    expect(verifyMediaToken(`${payload}.${sig}.x`, now).ok).toBe(false);
  });

  it("dépend de ENCRYPTION_KEY", () => {
    const token = signMediaToken("pub_123456");
    process.env.ENCRYPTION_KEY = "z".repeat(40);
    expect(verifyMediaToken(token).ok).toBe(false);
  });

  it("adresse complète", () => {
    expect(signedMediaUrl("pub_123456")).toMatch(/^https:\/\/clips\.example\.com\/api\/public-media\/[\w-]+\.[\w-]+\/clip\.mp4$/);
  });

  it("repère les adresses non joignables depuis Internet", () => {
    for (const u of ["http://localhost:3000", "http://127.0.0.1:3000", "http://192.168.1.20", "http://10.0.0.2", "http://cliping", "https://nas.local", "http://[::1]:3000"]) {
      expect(appUrlIsPrivate(u), u).toBe(true);
    }
    for (const u of ["https://clips.mondomaine.fr", "https://8.8.8.8"]) expect(appUrlIsPrivate(u), u).toBe(false);
  });
});
