import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { planAutoFollow, type AutoStreamerState } from "@/lib/discovery";
import { resetDirectoryCaches, resetDirectoryTokens, topStreams, type DiscoveredStream } from "@/lib/live-apis";

/**
 * L'annuaire Twitch/Kick est testé contre un faux réseau : on valide notre enchaînement d'appels
 * et notre lecture des réponses, d'après la documentation. Pas le comportement réel des API.
 */

const live = (login: string, viewers: number, platform: "TWITCH" | "KICK" = "TWITCH"): DiscoveredStream => ({
  platform, login, displayName: login, title: "", viewers, thumbnailUrl: null, language: "fr", startedAt: null, game: "Grand Theft Auto VI",
});
const auto = (login: string, extra: Partial<AutoStreamerState> = {}): AutoStreamerState => ({
  id: `id-${login}`, platform: "TWITCH", login, enabled: true, recording: false, hasClips: false, ...extra,
});

describe("mode automatique", () => {
  const ranked = [live("a", 9000), live("b", 8000), live("c", 7000), live("d", 6000), live("e", 5000)];

  it("suit les N plus gros, sans doublonner les chaînes manuelles ni reprendre les exclues", () => {
    const plan = planAutoFollow({ ranked, autos: [], manual: new Set(["TWITCH:a"]), excluded: new Set(["TWITCH:b"]), count: 2, slots: 6 });
    expect(plan.add.map((s) => s.login)).toEqual(["c", "d"]);
  });

  it("respecte les places d'enregistrement libres", () => {
    const plan = planAutoFollow({ ranked, autos: [], manual: new Set(), excluded: new Set(), count: 5, slots: 1 });
    expect(plan.add.map((s) => s.login)).toEqual(["a"]);
  });

  it("retire ce qui sort du classement, sauf une capture en cours encore en live", () => {
    const plan = planAutoFollow({
      ranked,
      autos: [auto("e", { recording: true }), auto("z"), auto("y", { hasClips: true }), auto("a")],
      manual: new Set(),
      excluded: new Set(),
      count: 2,
      slots: 6,
    });
    // e est gardée (capture en cours), a est gardée (n°1), donc rien d'autre n'est ajouté
    expect(plan.add).toEqual([]);
    expect(plan.remove).toEqual(["id-z"]);
    expect(plan.disable).toEqual(["id-y"]); // a des clips : mise en pause plutôt que supprimée
    expect(plan.viewers).toEqual(expect.arrayContaining([{ id: "id-a", viewers: 9000 }, { id: "id-e", viewers: 5000 }]));
  });

  it("mode coupé : tout ce qui n'enregistre pas est retiré", () => {
    const plan = planAutoFollow({ ranked, autos: [auto("a"), auto("b", { recording: true })], manual: new Set(), excluded: new Set(), count: 0, slots: 6 });
    expect(plan.remove).toEqual(["id-a"]);
    expect(plan.add).toEqual([]);
  });

  it("réactive une chaîne automatique qui revient dans le classement", () => {
    const plan = planAutoFollow({ ranked, autos: [auto("a", { enabled: false, hasClips: true })], manual: new Set(), excluded: new Set(), count: 1, slots: 6 });
    expect(plan.enable).toEqual(["id-a"]);
  });
});

describe("annuaire des lives (réseau simulé)", () => {
  const calls: string[] = [];
  beforeEach(() => {
    calls.length = 0;
    resetDirectoryTokens();
    resetDirectoryCaches();
    process.env.TWITCH_CLIENT_ID = "tid";
    process.env.TWITCH_CLIENT_SECRET = "tsecret";
    process.env.KICK_CLIENT_ID = "kid";
    process.env.KICK_CLIENT_SECRET = "ksecret";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of ["TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET", "KICK_CLIENT_ID", "KICK_CLIENT_SECRET"]) delete process.env[k];
  });

  function stub(handler: (url: URL, init: RequestInit) => Response) {
    vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit = {}) => {
      const url = new URL(String(input));
      calls.push(`${init.method ?? "GET"} ${url.host}${url.pathname}${url.search}`);
      return handler(url, init);
    });
  }
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

  it("Twitch + Kick : jeton d'application, catégorie, lives triés par spectateurs", async () => {
    let twitchTokens = 0;
    stub((url, init) => {
      if (url.host === "id.twitch.tv") {
        twitchTokens++;
        expect(String(init.body)).toContain("grant_type=client_credentials");
        return json({ access_token: `tok${twitchTokens}`, expires_in: 5000000, token_type: "bearer" });
      }
      if (url.host === "id.kick.com") return json({ access_token: "ktok", expires_in: 3600, token_type: "Bearer" });
      if (url.pathname === "/helix/games") {
        const h = init.headers as Record<string, string>;
        expect(h["Client-Id"]).toBe("tid");
        // Premier appel avec un jeton « périmé » : on vérifie qu'un nouveau est redemandé.
        if (h.Authorization === "Bearer tok1") return json({ message: "Invalid OAuth token" }, 401);
        return json({ data: [{ id: "1234", name: "Grand Theft Auto VI" }] });
      }
      if (url.pathname === "/helix/streams") {
        expect(url.searchParams.get("game_id")).toBe("1234");
        expect(url.searchParams.get("language")).toBe("fr");
        return json({
          data: [
            { user_login: "Gros", user_name: "Gros", title: "RP", viewer_count: 12000, language: "fr", type: "live", thumbnail_url: "https://x/{width}x{height}.jpg" },
            { user_login: "petit", user_name: "Petit", title: "solo", viewer_count: 300, language: "fr", type: "live" },
          ],
          pagination: {},
        });
      }
      if (url.pathname === "/public/v1/categories") return json({ data: [{ id: 99, name: "GTA V" }, { id: 7, name: "Grand Theft Auto VI" }] });
      if (url.pathname === "/public/v1/livestreams") {
        expect(url.searchParams.get("category_id")).toBe("7");
        return json({ data: [{ slug: "kickeur", stream_title: "GTA 6 day one", viewer_count: 5000, thumbnail: "https://k/t.jpg", language: "fr" }] });
      }
      return json({}, 404);
    });
    const { streams, errors } = await topStreams("GTA 6", "fr", 10);
    expect(errors).toEqual([]);
    expect(streams.map((s) => `${s.platform}:${s.login}:${s.viewers}`)).toEqual(["TWITCH:gros:12000", "KICK:kickeur:5000", "TWITCH:petit:300"]);
    expect(streams[0]!.thumbnailUrl).toBe("https://x/440x248.jpg");
    expect(twitchTokens).toBe(2);
  });

  it("une plateforme en panne n'empêche pas l'autre ; identifiants refusés expliqués", async () => {
    stub((url) => {
      if (url.host === "id.twitch.tv") return json({ status: 403, message: "invalid client secret" }, 403);
      if (url.host === "id.kick.com") return json({ access_token: "ktok", expires_in: 3600 });
      if (url.pathname === "/public/v1/categories") return json({ data: [{ id: 7, name: "Grand Theft Auto VI" }] });
      if (url.pathname === "/public/v1/livestreams") return json({ data: [{ slug: "k", viewer_count: 10 }] });
      return json({}, 404);
    });
    const { streams, errors } = await topStreams("Grand Theft Auto VI", "", 10);
    expect(streams.map((s) => s.login)).toEqual(["k"]);
    expect(errors[0]).toMatch(/TWITCH_CLIENT_ID/);
  });
});
