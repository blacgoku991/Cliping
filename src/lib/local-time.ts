/**
 * Heures locales de l'utilisateur côté serveur. Le serveur ne connaît pas le fuseau de l'utilisateur :
 * il est relevé par le navigateur (Intl) quand il enregistre ses réglages, puis utilisé ici.
 * Module pur (Intl seulement), partagé par le pilote et les notifications.
 */

export const DEFAULT_TZ = "Europe/Paris";

export function isValidTimeZone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: isValidTimeZone(tz) ? tz : DEFAULT_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

/** Date locale (AAAA-MM-JJ) et minutes depuis minuit, dans le fuseau donné. */
export function localParts(ms: number, tz: string): { day: string; minutes: number } {
  const parts = Object.fromEntries(fmt(tz).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour) % 24;
  return { day: `${parts.year}-${parts.month}-${parts.day}`, minutes: hour * 60 + Number(parts.minute) };
}

/** Plage horaire quotidienne en heures locales [from, to[ ; from === to = toute la journée ; peut passer minuit (22 → 7). */
export interface HourRange {
  from: number;
  to: number;
}

export function inRange(ms: number, range: HourRange, tz: string): boolean {
  if (range.from === range.to) return true;
  const m = localParts(ms, tz).minutes;
  const a = range.from * 60;
  const b = range.to * 60;
  return a < b ? m >= a && m < b : m >= a || m < b;
}

/** Premier instant ≥ ms (au pas de 5 min, sur 48 h max) où l'on sort de la plage ; Infinity si la plage couvre tout. */
export function rangeEnd(ms: number, range: HourRange, tz: string): number {
  if (range.from === range.to) return Infinity;
  const step = 5 * 60_000;
  let t = Math.ceil(ms / step) * step;
  for (let i = 0; i < 576; i++, t += step) if (!inRange(t, range, tz)) return t;
  return Infinity;
}

/** Premier instant ≥ ms (au pas de 5 min) où l'on entre dans la plage. */
export function rangeStart(ms: number, range: HourRange, tz: string): number {
  if (inRange(ms, range, tz)) return ms;
  const step = 5 * 60_000;
  let t = Math.ceil(ms / step) * step;
  for (let i = 0; i < 576; i++, t += step) if (inRange(t, range, tz)) return t;
  return ms;
}

export function formatHour(h: number): string {
  return `${String(h % 24).padStart(2, "0")} h`;
}
