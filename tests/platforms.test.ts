import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { chunkPlan, tiktok } from "@/lib/platforms/tiktok";
import { PlatformRejectedError, ReauthRequiredError, truncateBytes, type PublishInput } from "@/lib/platforms/types";
import { youtube } from "@/lib/platforms/youtube";

/**
 * Ces tests rejouent les protocoles d'envoi contre un faux réseau (fetch simulé).
 * Ils valident NOTRE enchaînement d'appels (découpage, reprise, lecture des statuts),
 * pas le comportement réel de YouTube/TikTok, qui ne peut se vérifier qu'avec de vrais comptes.
 */

let dir: string;
let file: string;
const SIZE = 20 * 1024 * 1024; // 20 Mio → 3 blocs de 8 Mio côté YouTube

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "cliping-test-"));
  file = path.join(dir, "final.mp4");
  await writeFile(file, Buffer.alloc(SIZE, 7));
  process.env.APP_URL = "https://clips.example.com";
  process.env.GOOGLE_CLIENT_ID = "gid";
  process.env.GOOGLE_CLIENT_SECRET = "gsecret";
  process.env.TIKTOK_CLIENT_KEY = "tkey";
  process.env.TIKTOK_CLIENT_SECRET = "tsecret";
});
afterAll(() => rm(dir, { recursive: true, force: true }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  bodySize: number;
  json: unknown;
}

function mockFetch(handler: (call: Call, n: number) => Response): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: string | URL, init: RequestInit = {}) => {
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const body = init.body;
    let json: unknown = null;
    if (typeof body === "string") {
      try {
        json = JSON.parse(body);
      } catch {
        json = null;
      }
    }
    const call: Call = {
      url: String(url),
      method: init.method ?? "GET",
      headers,
      bodySize: body instanceof Uint8Array ? body.byteLength : typeof body === "string" ? body.length : 0,
      json,
    };
    calls.push(call);
    return handler(call, calls.length);
  });
  return calls;
}

/** Fait avancer les minuteries simulées jusqu'à ce que la promesse aboutisse (en laissant passer les E/S réelles). */
async function settle<T>(p: Promise<T>): Promise<T> {
  let done = false;
  p.then(() => (done = true), () => (done = true));
  while (!done) {
    await vi.advanceTimersByTimeAsync(1000);
    await new Promise((r) => setImmediate(r));
  }
  return p;
}

const jsonRes = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(status === 308 ? null : JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });

function input(over: Partial<PublishInput> = {}): PublishInput & { saved: Array<Record<string, unknown>> } {
  const saved: Array<Record<string, unknown>> = [];
  return {
    filePath: file,
    fileSize: SIZE,
    title: "Le braquage tourne mal 😱",
    description: "Extrait du live.",
    hashtags: ["gta6", "clips"],
    privacy: "public",
    durationSec: 30,
    state: {},
    saveState: async (s) => void saved.push(s),
    saved,
    ...over,
  };
}

describe("YouTube", () => {
  it("construit une URL d'autorisation qui garantit un refresh_token", () => {
    const u = new URL(youtube.authUrl("abc"));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toContain("consent");
    expect(u.searchParams.get("redirect_uri")).toBe("https://clips.example.com/api/oauth/youtube/callback");
    expect(u.searchParams.get("scope")).toContain("youtube.upload");
    expect(u.searchParams.get("state")).toBe("abc");
  });

  it("envoie la vidéo par blocs et renvoie le lien du Short", async () => {
    const calls = mockFetch((c) => {
      if (c.method === "POST") return jsonRes({}, 200, { location: "https://upload.example/session/1" });
      const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(c.headers["content-range"] ?? "")!;
      const last = Number(m[2]);
      if (last + 1 < Number(m[3])) return jsonRes(null, 308, { range: `bytes=0-${last}` });
      return jsonRes({ id: "VID123", status: { privacyStatus: "public" } }, 201);
    });
    const inp = input();
    const res = await youtube.publish("token", inp);

    expect(res).toMatchObject({ status: "PUBLISHED", externalId: "VID123", url: "https://www.youtube.com/shorts/VID123" });
    expect(res.note).toBeUndefined();
    expect(inp.saved).toEqual([{ sessionUri: "https://upload.example/session/1" }]);
    const [init, ...puts] = calls;
    expect(init!.headers["x-upload-content-length"]).toBe(String(SIZE));
    expect(init!.headers.authorization).toBe("Bearer token");
    expect(init!.json).toMatchObject({ snippet: { categoryId: "20", tags: ["gta6", "clips"] }, status: { privacyStatus: "public", selfDeclaredMadeForKids: false } });
    expect((init!.json as { snippet: { description: string } }).snippet.description).toContain("#gta6 #clips");
    expect(puts.map((p) => p.headers["content-range"])).toEqual([
      `bytes 0-8388607/${SIZE}`,
      `bytes 8388608-16777215/${SIZE}`,
      `bytes 16777216-${SIZE - 1}/${SIZE}`,
    ]);
    expect(puts.reduce((n, p) => n + p.bodySize, 0)).toBe(SIZE);
  });

  it("reprend un envoi interrompu au lieu de republier", async () => {
    const calls = mockFetch((c) => {
      if (c.headers["content-range"] === `bytes */${SIZE}`) return jsonRes(null, 308, { range: "bytes=0-8388607" });
      const last = Number(/bytes \d+-(\d+)\//.exec(c.headers["content-range"]!)![1]);
      return last + 1 < SIZE ? jsonRes(null, 308, { range: `bytes=0-${last}` }) : jsonRes({ id: "VID9", status: { privacyStatus: "public" } }, 200);
    });
    const res = await youtube.publish("token", input({ state: { sessionUri: "https://upload.example/session/old" } }));
    expect(res.externalId).toBe("VID9");
    expect(calls.every((c) => c.method === "PUT" && c.url === "https://upload.example/session/old")).toBe(true);
    expect(calls[1]!.headers["content-range"]).toBe(`bytes 8388608-16777215/${SIZE}`);
  });

  it("ne renvoie rien si la session précédente avait en fait abouti", async () => {
    const calls = mockFetch(() => jsonRes({ id: "DONE1", status: { privacyStatus: "public" } }, 200));
    const res = await youtube.publish("token", input({ state: { sessionUri: "https://upload.example/s" } }));
    expect(res.externalId).toBe("DONE1");
    expect(calls).toHaveLength(1);
  });

  it("signale quand YouTube force la vidéo en privé", async () => {
    mockFetch((c) => (c.method === "POST" ? jsonRes({}, 200, { location: "https://u/s" }) : jsonRes({ id: "V", status: { privacyStatus: "private" } }, 201)));
    const res = await youtube.publish("token", input({ fileSize: 1024, filePath: file }));
    expect(res.note).toMatch(/private/);
  });

  it("traduit quota épuisé et jeton refusé en erreurs définitives", async () => {
    mockFetch(() => jsonRes({ error: { message: "quota", errors: [{ reason: "quotaExceeded" }] } }, 403));
    await expect(youtube.publish("token", input())).rejects.toBeInstanceOf(PlatformRejectedError);
    mockFetch(() => jsonRes({ error: { message: "Invalid Credentials" } }, 401));
    await expect(youtube.publish("token", input())).rejects.toBeInstanceOf(ReauthRequiredError);
    mockFetch(() => jsonRes({ error: "invalid_grant" }, 400));
    await expect(youtube.refresh("old")).rejects.toBeInstanceOf(ReauthRequiredError);
  });

  it("lit la chaîne connectée", async () => {
    mockFetch(() => jsonRes({ items: [{ id: "UC1", snippet: { title: "Ma chaîne", customUrl: "@machaine", thumbnails: { default: { url: "https://img/a.jpg" } } } }] }));
    expect(await youtube.fetchProfile("t")).toEqual({ externalId: "UC1", displayName: "Ma chaîne", handle: "@machaine", avatarUrl: "https://img/a.jpg" });
    mockFetch(() => jsonRes({ items: [] }));
    await expect(youtube.fetchProfile("t")).rejects.toThrow(/pas de chaîne/);
  });
});

describe("TikTok", () => {
  it("découpe selon les règles : un seul bloc jusqu'à 64 Mo, sinon 10 Mo et le dernier absorbe le reste", () => {
    expect(chunkPlan(3_000_000)).toEqual({ chunkSize: 3_000_000, count: 1 });
    expect(chunkPlan(64_000_000)).toEqual({ chunkSize: 64_000_000, count: 1 });
    expect(chunkPlan(65_000_000)).toEqual({ chunkSize: 10_000_000, count: 6 });
    expect(chunkPlan(159_999_999)).toEqual({ chunkSize: 10_000_000, count: 15 });
  });

  it("sépare les scopes par des virgules dans l'URL d'autorisation", () => {
    const u = new URL(tiktok.authUrl("xyz"));
    expect(u.searchParams.get("scope")).toBe("user.info.basic,video.publish,video.upload");
    expect(u.searchParams.get("client_key")).toBe("tkey");
    expect(u.searchParams.get("redirect_uri")).toBe("https://clips.example.com/api/oauth/tiktok/callback");
  });

  it("mode brouillon : init inbox → envoi → statut SEND_TO_USER_INBOX", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const calls = mockFetch((c) => {
      if (c.url.endsWith("/post/publish/inbox/video/init/")) return jsonRes({ data: { publish_id: "p1", upload_url: "https://up.tiktok/x?sig=1" }, error: { code: "ok" } });
      if (c.method === "PUT") return new Response(null, { status: 201 });
      if (c.url.endsWith("/post/publish/status/fetch/")) return jsonRes({ data: { status: "SEND_TO_USER_INBOX" }, error: { code: "ok" } });
      return jsonRes({}, 404);
    });
    const inp = input({ privacy: "draft" });
    const res = await settle(tiktok.publish("tok", inp));
    expect(res.status).toBe("PUBLISHED");
    expect(res.note).toMatch(/brouillons/);
    expect(calls[0]!.json).toEqual({ source_info: { source: "FILE_UPLOAD", video_size: SIZE, chunk_size: SIZE, total_chunk_count: 1 } });
    expect(calls[1]!.headers["content-range"]).toBe(`bytes 0-${SIZE - 1}/${SIZE}`);
    expect(calls[1]!.url).toBe("https://up.tiktok/x?sig=1");
    expect(inp.saved).toEqual([{ publishId: "p1", handle: null }]);
  });

  it("publication directe : vérifie la visibilité autorisée et renvoie le lien public", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const calls = mockFetch((c) => {
      if (c.url.endsWith("/creator_info/query/")) return jsonRes({ data: { creator_username: "monclip", privacy_level_options: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"], max_video_post_duration_sec: 600 }, error: { code: "ok" } });
      if (c.url.endsWith("/post/publish/video/init/")) return jsonRes({ data: { publish_id: "p2", upload_url: "https://up.tiktok/y" }, error: { code: "ok" } });
      if (c.method === "PUT") return new Response(null, { status: 201 });
      return jsonRes({ data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: [7412345] }, error: { code: "ok" } });
    });
    const res = await settle(tiktok.publish("tok", input()));
    expect(res).toMatchObject({ status: "PUBLISHED", externalId: "7412345", url: "https://www.tiktok.com/@monclip/video/7412345", handle: "monclip" });
    const init = calls.find((c) => c.url.endsWith("/video/init/"))!.json as { post_info: { privacy_level: string; title: string } };
    expect(init.post_info.privacy_level).toBe("PUBLIC_TO_EVERYONE");
    expect(init.post_info.title).toContain("#gta6");
  });

  it("refuse proprement une visibilité que le compte n'autorise pas", async () => {
    mockFetch(() => jsonRes({ data: { privacy_level_options: ["SELF_ONLY"] }, error: { code: "ok" } }));
    await expect(tiktok.publish("tok", input())).rejects.toThrow(/Moi uniquement|Brouillon/);
  });

  it("lit les erreurs métier renvoyées avec un HTTP 200", async () => {
    mockFetch(() => jsonRes({ data: {}, error: { code: "spam_risk_too_many_pending_share", message: "x" } }));
    await expect(tiktok.publish("tok", input({ privacy: "draft" }))).rejects.toBeInstanceOf(PlatformRejectedError);
    mockFetch(() => jsonRes({ data: {}, error: { code: "access_token_invalid", message: "x" } }, 401));
    await expect(tiktok.publish("tok", input({ privacy: "draft" }))).rejects.toBeInstanceOf(ReauthRequiredError);
  });

  it("reprend le suivi d'une vidéo déjà envoyée sans la renvoyer", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const calls = mockFetch(() => jsonRes({ data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: ["99"] }, error: { code: "ok" } }));
    const res = await settle(tiktok.publish("tok", input({ state: { publishId: "p7", handle: "moi" } })));
    expect(res.url).toBe("https://www.tiktok.com/@moi/video/99");
    expect(calls.every((c) => c.url.endsWith("/status/fetch/"))).toBe(true);
  });

  it("conserve le nouveau refresh_token quand TikTok en émet un", async () => {
    mockFetch(() => jsonRes({ access_token: "a2", refresh_token: "r2", expires_in: 86400, scope: "video.publish" }));
    const t = await tiktok.refresh("r1");
    expect(t).toMatchObject({ accessToken: "a2", refreshToken: "r2" });
    expect(t.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 86_000_000);
  });
});

describe("utilitaires", () => {
  it("tronque en octets sans casser un caractère", () => {
    expect(truncateBytes("éééé", 5)).toBe("éé");
    expect(truncateBytes("abc", 10)).toBe("abc");
  });
});
