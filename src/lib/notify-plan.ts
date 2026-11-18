/**
 * Notifications : préférences, plages de silence et regroupement. Module pur (testé) ;
 * l'envoi lui-même est dans src/lib/notify/.
 *
 * Règle de regroupement : le premier événement part tout de suite ; ceux qui arrivent ensuite
 * pendant `groupMin` minutes attendent et partent ensemble, un seul message par type
 * (« 6 clips prêts à valider »). Pendant les heures de silence, rien ne part : tout est
 * regroupé et envoyé à la fin de la plage.
 */
import { DEFAULT_TZ, inRange, isValidTimeZone, type HourRange } from "./local-time";

export const NOTIFY_TYPES = ["clipReady", "publishFailed", "accountInvalid", "autopilot", "digest"] as const;
export type NotifyType = (typeof NOTIFY_TYPES)[number] | "test";

export const TYPE_LABELS: Record<(typeof NOTIFY_TYPES)[number], { label: string; hint: string }> = {
  clipReady: { label: "Clip prêt à valider", hint: "Un nouveau clip attend ton accord." },
  publishFailed: { label: "Publication échouée", hint: "Un envoi vers TikTok ou YouTube n'a pas abouti." },
  accountInvalid: { label: "Compte à reconnecter", hint: "Un compte a perdu son accès : plus rien ne part dessus." },
  autopilot: { label: "Pilote automatique", hint: "Ce que le pilote a programmé (avec le délai pour annuler), comptes mis en pause." },
  digest: { label: "Résumé quotidien", hint: "Une fois par jour : clips sortis, publiés, échoués, en attente." },
};

export interface NotifyPrefs {
  types: Record<(typeof NOTIFY_TYPES)[number], boolean>;
  /** Heures de silence (locales) ; null = jamais */
  quiet: HourRange | null;
  /** Fenêtre de regroupement, en minutes */
  groupMin: number;
  /** Heure locale du résumé quotidien */
  digestHour: number;
  tz: string;
}

export const DEFAULT_PREFS: NotifyPrefs = {
  types: { clipReady: true, publishFailed: true, accountInvalid: true, autopilot: true, digest: true },
  quiet: { from: 1, to: 8 },
  groupMin: 10,
  digestHour: 9,
  tz: DEFAULT_TZ,
};

export function parsePrefs(raw: unknown): NotifyPrefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const t = (r.types && typeof r.types === "object" ? r.types : {}) as Record<string, unknown>;
  const types = { ...DEFAULT_PREFS.types };
  for (const k of NOTIFY_TYPES) if (typeof t[k] === "boolean") types[k] = t[k] as boolean;
  const int = (v: unknown, lo: number, hi: number, def: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
  };
  let quiet: HourRange | null = DEFAULT_PREFS.quiet;
  if (r.quiet === null) quiet = null;
  else if (r.quiet && typeof r.quiet === "object") {
    const q = r.quiet as Record<string, unknown>;
    quiet = { from: int(q.from, 0, 23, 1), to: int(q.to, 0, 23, 8) };
    if (quiet.from === quiet.to) quiet = null;
  }
  return {
    types,
    quiet,
    groupMin: int(r.groupMin, 0, 180, DEFAULT_PREFS.groupMin),
    digestHour: int(r.digestHour, 0, 23, DEFAULT_PREFS.digestHour),
    tz: typeof r.tz === "string" && isValidTimeZone(r.tz) ? r.tz : DEFAULT_TZ,
  };
}

export interface PendingEvent {
  id: string;
  type: NotifyType;
  title: string;
  body: string;
  url: string;
  createdAt: number;
}

export interface OutMessage {
  title: string;
  body: string;
  url: string;
  /** Identifiant de regroupement côté appareil (remplace la notification précédente du même type) */
  tag: string;
  /** Événements couverts par ce message */
  ids: string[];
}

export interface DispatchPlan {
  send: OutMessage[];
  /** Événements abandonnés (type désactivé) */
  skip: string[];
  /** Raison de l'attente quand des événements restent en file */
  waitReason: "quiet" | "grouping" | null;
}

const GROUP_TITLES: Record<NotifyType, (n: number) => string> = {
  clipReady: (n) => `${n} clips prêts à valider`,
  publishFailed: (n) => `${n} publications ont échoué`,
  accountInvalid: (n) => `${n} comptes à reconnecter`,
  autopilot: (n) => `Pilote automatique : ${n} actions`,
  digest: () => "Résumé de la journée",
  test: (n) => `${n} notifications de test`,
};

const GROUP_URLS: Record<NotifyType, string> = {
  clipReady: "/app/review",
  publishFailed: "/app/queue",
  accountInvalid: "/app/accounts",
  autopilot: "/app/autopilot",
  digest: "/app",
  test: "/app/autopilot/notifications",
};

/** Message unique pour un ou plusieurs événements du même type. */
export function groupMessage(type: NotifyType, events: PendingEvent[]): OutMessage {
  const ids = events.map((e) => e.id);
  if (events.length === 1) {
    const e = events[0]!;
    return { title: e.title, body: e.body, url: e.url, tag: type, ids };
  }
  const shown = events.slice(0, 3).map((e) => `• ${e.body || e.title}`);
  if (events.length > 3) shown.push(`… et ${events.length - 3} autre${events.length > 4 ? "s" : ""}`);
  return { title: GROUP_TITLES[type](events.length), body: shown.join("\n"), url: GROUP_URLS[type], tag: type, ids };
}

/** Que faut-il envoyer maintenant ? `test` passe toujours, tout de suite. */
export function planDispatch(input: { pending: PendingEvent[]; prefs: NotifyPrefs; lastSentAt: number | null; now: number }): DispatchPlan {
  const { prefs, now } = input;
  const plan: DispatchPlan = { send: [], skip: [], waitReason: null };
  const live: PendingEvent[] = [];
  for (const e of input.pending) {
    if (e.type === "test") plan.send.push(groupMessage("test", [e]));
    else if (!prefs.types[e.type]) plan.skip.push(e.id);
    else live.push(e);
  }
  if (live.length === 0) return plan;
  if (prefs.quiet && inRange(now, prefs.quiet, prefs.tz)) {
    plan.waitReason = "quiet";
    return plan;
  }
  if (input.lastSentAt !== null && now - input.lastSentAt < prefs.groupMin * 60_000) {
    plan.waitReason = "grouping";
    return plan;
  }
  const byType = new Map<NotifyType, PendingEvent[]>();
  for (const e of [...live].sort((a, b) => a.createdAt - b.createdAt)) {
    byType.set(e.type, [...(byType.get(e.type) ?? []), e]);
  }
  const messages = [...byType.entries()].map(([type, events]) => groupMessage(type, events));
  // Au-delà de trois messages d'un coup, on n'en envoie qu'un qui résume tout.
  if (messages.length > 3) {
    plan.send.push({
      title: "Cliping : du nouveau",
      body: messages.map((m) => `• ${m.title}`).join("\n"),
      url: "/app",
      tag: "summary",
      ids: messages.flatMap((m) => m.ids),
    });
  } else {
    plan.send.push(...messages);
  }
  return plan;
}
