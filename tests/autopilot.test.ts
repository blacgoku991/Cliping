import { describe, expect, it } from "vitest";
import { decide, DEFAULT_AUTOPILOT, parseAutopilotConfig, type AutopilotConfig, type CandidateClip, type DecisionInput, type PilotAccount } from "@/lib/autopilot";
import { inRange, rangeEnd, rangeStart } from "@/lib/local-time";
import { DAY_MS } from "@/lib/schedule";

const H = 3600_000;
// 2026-12-01 12:00 à Paris (UTC+1)
const NOW = Date.UTC(2026, 11, 1, 11, 0, 0);

function clip(id: string, over: Partial<CandidateClip> = {}): CandidateClip {
  return { id, title: id, status: "APPROVED", score: 70, streamerId: "s1", hasFinal: true, createdAt: NOW - H, handled: false, ...over };
}
function account(id: string, over: Partial<PilotAccount> = {}): PilotAccount {
  return { id, label: id, valid: true, dailyCap: null, existing: [], ...over };
}
function config(over: Partial<AutopilotConfig> = {}): AutopilotConfig {
  return { ...DEFAULT_AUTOPILOT, schedule: true, allStreamers: true, accounts: ["a", "b"], window: { from: 0, to: 0 }, tz: "Europe/Paris", ...over };
}
function input(over: Partial<DecisionInput> = {}): DecisionInput {
  return { now: NOW, config: config(), clips: [], accounts: [account("a"), account("b")], paused: {}, scheduledLast24h: 0, ...over };
}

describe("pilote automatique : approbation", () => {
  it("approuve les clips prêts au-dessus du score, pas les autres", () => {
    const d = decide(input({ config: config({ minScore: 80, schedule: false }), clips: [clip("hi", { status: "READY", score: 85 }), clip("lo", { status: "READY", score: 79 }), clip("ok", { status: "APPROVED", score: 99 })] }));
    expect(d.approve.map((a) => a.clipId)).toEqual(["hi"]);
    expect(d.schedule).toEqual([]);
  });

  it("n'approuve rien si l'approbation automatique est coupée", () => {
    const d = decide(input({ config: config({ approve: false, schedule: false }), clips: [clip("hi", { status: "READY", score: 99 })] }));
    expect(d.approve).toEqual([]);
  });

  it("respecte la liste des streamers autorisés", () => {
    const d = decide(input({ config: config({ allStreamers: false, streamers: ["s1"], schedule: false }), clips: [clip("x", { status: "READY", score: 90, streamerId: "s2" }), clip("y", { status: "READY", score: 90 }), clip("imp", { status: "READY", score: 90, streamerId: null })] }));
    expect(d.approve.map((a) => a.clipId)).toEqual(["y"]);
    expect(d.skipped.map((s) => s.clipId).sort()).toEqual(["imp", "x"]);
  });

  it("ignore les clips trop vieux ou sans vidéo montée", () => {
    const d = decide(input({ config: config({ schedule: false, maxClipAgeH: 24 }), clips: [clip("old", { status: "READY", score: 99, createdAt: NOW - 25 * H }), clip("nofile", { status: "READY", score: 99, hasFinal: false })] }));
    expect(d.approve).toEqual([]);
  });
});

describe("pilote automatique : programmation", () => {
  it("programme des clips différents par compte, meilleur score d'abord, après le délai de grâce", () => {
    const d = decide(input({ config: config({ graceMin: 30, gapMin: 120, staggerMin: 20 }), clips: [clip("c1", { score: 60 }), clip("c2", { score: 90 }), clip("c3", { score: 75 })] }));
    expect(d.schedule).toHaveLength(3);
    expect(new Set(d.schedule.map((r) => r.clipId)).size).toBe(3);
    for (const r of d.schedule) expect(r.at).toBeGreaterThanOrEqual(NOW + 30 * 60_000);
    // Le meilleur clip part le premier
    expect(d.schedule[0]!.clipId).toBe("c2");
    // Écart respecté sur chaque compte
    for (const id of ["a", "b"]) {
      const times = d.schedule.filter((r) => r.accountId === id).map((r) => r.at).sort((x, y) => x - y);
      for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(120 * 60_000);
    }
  });

  it("ne reprend jamais un clip déjà publié, programmé ou annulé", () => {
    const d = decide(input({ clips: [clip("done", { handled: true }), clip("new")] }));
    expect(d.schedule.map((r) => r.clipId)).toEqual(["new"]);
  });

  it("n'utilise que les comptes choisis", () => {
    const d = decide(input({ config: config({ accounts: ["b"] }), accounts: [account("a"), account("b"), account("c")], clips: [clip("1"), clip("2")] }));
    expect(new Set(d.schedule.map((r) => r.accountId))).toEqual(new Set(["b"]));
  });

  it("plafond global atteint : rien n'est programmé", () => {
    const d = decide(input({ config: config({ globalDailyCap: 5 }), scheduledLast24h: 5, clips: [clip("1")] }));
    expect(d.schedule).toEqual([]);
    expect(d.notes.join(" ")).toMatch(/Plafond global/);
  });

  it("plafond global presque atteint : seulement ce qui reste", () => {
    const d = decide(input({ config: config({ globalDailyCap: 5 }), scheduledLast24h: 3, clips: ["1", "2", "3", "4"].map((id) => clip(id)) }));
    expect(d.schedule).toHaveLength(2);
    expect(d.notes.join(" ")).toMatch(/attendront/);
  });

  it("plafond par compte du pilote, publications existantes comprises", () => {
    const d = decide(input({
      config: config({ accounts: ["a"], perAccountCap: 2, gapMin: 15 }),
      accounts: [account("a", { existing: [NOW - H] })],
      clips: ["1", "2", "3"].map((id) => clip(id)),
    }));
    // 1 publication il y a 1 h + plafond 2 sur 24 h glissantes → une tout de suite, la suivante
    // seulement quand la première sort de la fenêtre (23 h plus tard), jamais 3 en 24 h.
    expect(d.schedule).toHaveLength(2);
    expect(d.schedule[0]!.at).toBe(NOW + 30 * 60_000);
    expect(d.schedule[1]!.at).toBeGreaterThanOrEqual(NOW - H + DAY_MS);
  });

  it("le plafond propre au compte reste prioritaire s'il est plus bas", () => {
    const d = decide(input({ config: config({ accounts: ["a"], perAccountCap: 5, gapMin: 15 }), accounts: [account("a", { dailyCap: 1 })], clips: ["1", "2"].map((id) => clip(id)) }));
    expect(d.schedule).toHaveLength(1);
  });

  it("écarte un compte à reconnecter et un compte en pause", () => {
    const d = decide(input({ accounts: [account("a", { valid: false }), account("b")], paused: {}, clips: [clip("1"), clip("2")] }));
    expect(d.schedule.every((r) => r.accountId === "b")).toBe(true);
    expect(d.blocked).toEqual([{ accountId: "a", reason: "connexion à refaire" }]);

    const p = decide(input({ paused: { b: "2 échecs" }, clips: [clip("1")] }));
    expect(p.schedule.every((r) => r.accountId === "a")).toBe(true);
    expect(p.blocked.map((b) => b.accountId)).toEqual(["b"]);
  });

  it("aucun compte disponible : rien, avec une explication", () => {
    const d = decide(input({ accounts: [account("a", { valid: false }), account("b")], paused: { b: "pause" }, clips: [clip("1")] }));
    expect(d.schedule).toEqual([]);
    expect(d.notes.join(" ")).toMatch(/Aucun compte disponible/);
    const none = decide(input({ config: config({ accounts: [] }), clips: [clip("1")] }));
    expect(none.schedule).toEqual([]);
    expect(none.notes.join(" ")).toMatch(/Aucun compte choisi/);
  });

  it("hors plage horaire : rien ; et rien ne déborde après la fin de la plage", () => {
    // 12 h à Paris + 30 min de grâce, plage 18 h – 23 h → hors plage
    const out = decide(input({ config: config({ window: { from: 18, to: 23 } }), clips: [clip("1")] }));
    expect(out.schedule).toEqual([]);
    expect(out.notes.join(" ")).toMatch(/plage horaire/);
    // plage 10 h – 14 h, écart 2 h sur un seul compte : 12 h 30 puis 14 h 30 (hors plage) → un seul
    const d = decide(input({ config: config({ accounts: ["a"], window: { from: 10, to: 14 }, gapMin: 120 }), clips: [clip("1"), clip("2")] }));
    expect(d.schedule).toHaveLength(1);
    expect(d.notes.join(" ")).toMatch(/reportés/);
  });

  it("délai de grâce : jamais avant maintenant + grâce, même avec un compte libre", () => {
    const d = decide(input({ config: config({ graceMin: 90 }), clips: [clip("1")] }));
    expect(d.schedule[0]!.at).toBe(NOW + 90 * 60_000);
  });

  it("un clip approuvé à ce passage est programmable au même passage", () => {
    const d = decide(input({ config: config({ minScore: 80 }), clips: [clip("r", { status: "READY", score: 88 })] }));
    expect(d.approve.map((a) => a.clipId)).toEqual(["r"]);
    expect(d.schedule.map((r) => r.clipId)).toEqual(["r"]);
  });

  it("un clip prêt sous le seuil n'est jamais programmé", () => {
    const d = decide(input({ config: config({ minScore: 80 }), clips: [clip("r", { status: "READY", score: 50 })] }));
    expect(d.schedule).toEqual([]);
  });

  it("ne programme jamais au-delà de 24 h", () => {
    const d = decide(input({ config: config({ accounts: ["a"], gapMin: 600, globalDailyCap: 50, perAccountCap: 20 }), clips: Array.from({ length: 10 }, (_, i) => clip(`c${i}`)) }));
    for (const r of d.schedule) expect(r.at).toBeLessThan(NOW + DAY_MS);
  });
});

describe("configuration du pilote", () => {
  it("borne toutes les valeurs et rejette les fuseaux inconnus", () => {
    const c = parseAutopilotConfig({ minScore: 500, graceMin: 0, globalDailyCap: -3, gapMin: "abc", tz: "Mars/Olympus", window: { from: 30, to: -1 }, accounts: ["a", "a", 3] });
    expect(c.minScore).toBe(100);
    expect(c.graceMin).toBe(5);
    expect(c.globalDailyCap).toBe(1);
    expect(c.gapMin).toBe(DEFAULT_AUTOPILOT.gapMin);
    expect(c.tz).toBe("Europe/Paris");
    expect(c.window).toEqual({ from: 23, to: 0 });
    expect(c.accounts).toEqual(["a"]);
  });

  it("par défaut : rien n'est programmé, aucun compte, aucun streamer", () => {
    const c = parseAutopilotConfig({});
    expect(c.schedule).toBe(false);
    expect(c.accounts).toEqual([]);
    expect(c.allStreamers).toBe(false);
  });
});

describe("heures locales", () => {
  const tz = "Europe/Paris";
  it("plage qui passe minuit", () => {
    const r = { from: 22, to: 7 };
    expect(inRange(Date.UTC(2026, 11, 1, 22, 30), r, tz)).toBe(true); // 23 h 30 à Paris
    expect(inRange(Date.UTC(2026, 11, 1, 5, 0), r, tz)).toBe(true); // 6 h
    expect(inRange(Date.UTC(2026, 11, 1, 6, 0), r, tz)).toBe(false); // 7 h
  });
  it("fin et début de plage", () => {
    const r = { from: 10, to: 14 };
    expect(rangeEnd(NOW, r, tz)).toBe(Date.UTC(2026, 11, 1, 13, 0)); // 14 h à Paris
    expect(rangeStart(Date.UTC(2026, 11, 1, 14, 0), r, tz)).toBe(Date.UTC(2026, 11, 2, 9, 0)); // lendemain 10 h
  });
});
