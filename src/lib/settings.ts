import { z } from "zod";

/** Styles de sous-titres (définis dans src/worker/render/captions.ts). */
export const CAPTION_STYLE_KEYS = ["classic", "impact", "boxed", "karaoke", "minimal"] as const;

/** Libellés affichés dans l'interface. */
export const CAPTION_STYLE_LABELS: Record<(typeof CAPTION_STYLE_KEYS)[number], { name: string; hint: string }> = {
  classic: { name: "Classique", hint: "2-3 mots en majuscules, le mot prononcé en couleur" },
  impact: { name: "Impact", hint: "Un mot à la fois, très gros, les mots forts qui claquent" },
  boxed: { name: "Encadré", hint: "Bandeau sombre derrière le texte, lisible sur tout fond" },
  karaoke: { name: "Karaoké", hint: "La phrase entière, remplie en couleur au fil de la voix" },
  minimal: { name: "Discret", hint: "Phrases entières, petites et sobres, seuls les mots forts colorés" },
};

/** Angles des accroches proposées par l'IA. */
export const HOOK_ANGLES = ["curiosite", "enjeu", "reaction", "citation", "question"] as const;
export type HookAngle = (typeof HOOK_ANGLES)[number];
export const HOOK_ANGLE_LABELS: Record<HookAngle, string> = {
  curiosite: "Curiosité",
  enjeu: "Enjeu",
  reaction: "Réaction",
  citation: "Citation",
  question: "Question",
};

/** Préférences de clipping d'un utilisateur. Toute valeur absente retombe sur le défaut. */
export const settingsSchema = z.object({
  /** Langue des streams (transcription, titres générés) */
  language: z.string().min(2).max(5).default("fr"),
  /** 1 = seulement les moments énormes … 5 = beaucoup de clips */
  sensitivity: z.number().int().min(1).max(5).default(3),
  /** 15 à 45 s : assez pour la mise en place + le pic, et dans la plage où TikTok et Shorts gardent le mieux l'attention */
  clipMinSec: z.number().min(8).max(60).default(15),
  clipMaxSec: z.number().min(15).max(180).default(45),
  /** Contexte gardé avant le début de l'action / après sa fin */
  preRollSec: z.number().min(0).max(30).default(8),
  postRollSec: z.number().min(0).max(20).default(4),
  maxClipsPerHour: z.number().int().min(1).max(60).default(12),

  template: z.enum(["BLUR", "FULL", "FACECAM"]).default("FACECAM"),
  /** Zoom du gameplay sur le template BLUR (1 = toute la largeur visible) */
  zoom: z.number().min(1).max(2).default(1.35),
  captions: z.boolean().default(true),
  captionFont: z.enum(["Poppins ExtraBold", "Anton"]).default("Poppins ExtraBold"),
  captionColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#FFE600"),
  showHook: z.boolean().default(true),
  showCredit: z.boolean().default(true),

  /** Style des sous-titres (voir CAPTION_STYLES) */
  captionStyle: z.enum(CAPTION_STYLE_KEYS).default("classic"),
  /** Ouvre le clip sur un flash d'environ 1,5 s du moment fort, puis reprend au début */
  coldOpen: z.boolean().default(true),
  /** Coupe les silences et les creux avant le moment fort */
  trimSilence: z.boolean().default(true),
  /** Cale le début sur une phrase et la fin après la réaction (à la création du clip) */
  smartBounds: z.boolean().default(true),
  /** Léger zoom progressif sur le gameplay au moment fort */
  punchZoom: z.boolean().default(true),
  /** Fine barre de progression en haut de la vidéo */
  progressBar: z.boolean().default(true),
  /** Carton de fin (2,5 s) : appel à s'abonner + crédit du streamer */
  endCard: z.boolean().default(false),
  endCardText: z.string().trim().min(1).max(40).default("Abonne-toi pour la suite"),

  defaultHashtags: z.array(z.string().min(1).max(40)).max(15).default(["gta6", "gtavi", "gaming", "clips"]),
  /** Suppression automatique des clips non publiés après N jours (0 = jamais) */
  retentionDays: z.number().int().min(0).max(365).default(14),
});

export type ClipSettings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: ClipSettings = settingsSchema.parse({});

export function parseSettings(raw: unknown): ClipSettings {
  const base = typeof raw === "object" && raw !== null ? raw : {};
  const parsed = settingsSchema.safeParse(base);
  if (parsed.success) return parsed.data;
  // Une clé invalide ne doit pas faire perdre les autres : on garde ce qui est valide.
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(base as Record<string, unknown>)) {
    const field = (settingsSchema.shape as Record<string, z.ZodType>)[k];
    if (field && field.safeParse(v).success) out[k] = v;
  }
  return settingsSchema.parse(out);
}

/** Options de montage réglables clip par clip. */
export const clipEditSchema = z
  .object({
    captionStyle: z.enum(CAPTION_STYLE_KEYS),
    coldOpen: z.boolean(),
    trimSilence: z.boolean(),
    punchZoom: z.boolean(),
    progressBar: z.boolean(),
    endCard: z.boolean(),
  })
  .partial();

export type ClipEdit = Required<z.infer<typeof clipEditSchema>>;

/** Options effectives d'un clip : ce qui est réglé sur le clip, sinon le défaut de l'utilisateur. */
export function effectiveEdit(settings: ClipSettings, raw: unknown): ClipEdit {
  const obj = (typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  // Clé par clé : une valeur invalide ne fait pas perdre les autres.
  const own: Partial<ClipEdit> = {};
  for (const [k, field] of Object.entries(clipEditSchema.shape)) {
    const r = (field as z.ZodType).safeParse(obj[k]);
    if (r.success && r.data !== undefined) (own as Record<string, unknown>)[k] = r.data;
  }
  return {
    captionStyle: own.captionStyle ?? settings.captionStyle,
    coldOpen: own.coldOpen ?? settings.coldOpen,
    trimSilence: own.trimSilence ?? settings.trimSilence,
    punchZoom: own.punchZoom ?? settings.punchZoom,
    progressBar: own.progressBar ?? settings.progressBar,
    endCard: own.endCard ?? settings.endCard,
  };
}

/** Résumé du dernier montage (champ JSON `montage` d'un clip), ou null s'il est absent ou illisible. */
export function montageSummary(raw: unknown): { duration: number; teaserDur: number; removed: number; cuts: number; endCard: number } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const n = (k: string) => (typeof r[k] === "number" && Number.isFinite(r[k]) ? (r[k] as number) : 0);
  if (!n("duration")) return null;
  return { duration: n("duration"), teaserDur: n("teaserDur"), removed: n("removed"), cuts: n("cuts"), endCard: n("endCard") };
}
