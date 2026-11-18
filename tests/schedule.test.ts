import { describe, expect, it } from "vitest";
import { buildPlan, checkPlan, DAY_MS, earliestSlot, type PlanAccount } from "@/lib/schedule";

const H = 3600_000;
const T0 = Date.UTC(2026, 11, 1, 10, 0, 0);

describe("planification en lot", () => {
  const accounts: PlanAccount[] = [
    { id: "a", dailyCap: null, existing: [] },
    { id: "b", dailyCap: null, existing: [] },
    { id: "c", dailyCap: 2, existing: [] },
  ];

  it("répartit des clips différents sur des comptes différents, étalés", () => {
    const clips = ["c1", "c2", "c3", "c4", "c5", "c6", "c7"];
    const rows = buildPlan(clips, accounts, { start: T0, gapMin: 180, staggerMin: 20 });
    expect(rows).toHaveLength(7);
    // chaque clip une seule fois
    expect(new Set(rows.map((r) => r.clipId)).size).toBe(7);
    // tous les comptes servent
    expect(new Set(rows.map((r) => r.accountId))).toEqual(new Set(["a", "b", "c"]));
    // écart minimal par compte
    for (const id of ["a", "b", "c"]) {
      const t = rows.filter((r) => r.accountId === id).map((r) => r.at).sort((x, y) => x - y);
      for (let k = 1; k < t.length; k++) expect(t[k]! - t[k - 1]!).toBeGreaterThanOrEqual(3 * H);
    }
    // plafond de c : jamais 3 publications en 24 h
    const c = rows.filter((r) => r.accountId === "c").map((r) => r.at).sort((x, y) => x - y);
    for (let k = 2; k < c.length; k++) expect(c[k]! - c[k - 2]!).toBeGreaterThanOrEqual(DAY_MS);
    expect(checkPlan(rows, accounts, { gapMin: 180, now: T0 })).toEqual([]);
    // décalage entre comptes au départ
    expect(rows.slice(0, 3).map((r) => r.at)).toEqual([T0, T0 + 20 * 60_000, T0 + 40 * 60_000]);
  });

  it("tient compte des publications déjà programmées", () => {
    const acc: PlanAccount[] = [{ id: "a", dailyCap: null, existing: [T0 + H] }];
    const rows = buildPlan(["x"], acc, { start: T0, gapMin: 120, staggerMin: 0 });
    expect(rows[0]!.at).toBe(T0 + 3 * H);
    expect(earliestSlot([T0], T0, 0, 1)).toBe(T0 + DAY_MS);
  });

  it("refuse un clip en double, un écart trop court, un plafond dépassé, une date passée", () => {
    const issues = checkPlan(
      [
        { clipId: "x", accountId: "a", at: T0 },
        { clipId: "x", accountId: "b", at: T0 },
        { clipId: "y", accountId: "a", at: T0 + 30 * 60_000 },
        { clipId: "z", accountId: "c", at: T0 },
        { clipId: "w", accountId: "c", at: T0 + 5 * H },
        { clipId: "v", accountId: "c", at: T0 + 10 * H },
        { clipId: "u", accountId: "b", at: T0 - 2 * H },
        { clipId: "t", accountId: "inconnu", at: T0 + 20 * H },
      ],
      accounts,
      { gapMin: 60, now: T0 },
    );
    const text = issues.map((i) => `${i.row}:${i.message}`).join("\n");
    expect(text).toMatch(/^1:Ce clip est déjà prévu ligne 1/m);
    expect(text).toMatch(/^2:Moins de 1 h/m);
    expect(text).toMatch(/Plus de 2 publications en 24 h/);
    expect(text).toMatch(/^6:Cette date est déjà passée/m);
    expect(text).toMatch(/^7:Compte inconnu/m);
  });

  it("ignore les conflits entre publications déjà programmées (seules les lignes du planning comptent)", () => {
    const acc: PlanAccount[] = [{ id: "a", dailyCap: 1, existing: [T0, T0 + H] }];
    expect(checkPlan([{ clipId: "x", accountId: "a", at: T0 + 3 * DAY_MS }], acc, { gapMin: 180, now: T0 })).toEqual([]);
    expect(checkPlan([{ clipId: "x", accountId: "a", at: T0 + 2 * H }], acc, { gapMin: 30, now: T0 }).map((i) => i.row)).toEqual([0]);
  });
});
