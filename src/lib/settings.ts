import { z } from "zod";

/** Préférences de clipping d'un utilisateur. Toute valeur absente retombe sur le défaut. */
export const settingsSchema = z.object({
  /** Langue des streams (transcription, titres générés) */
  language: z.string().min(2).max(5).default("fr"),
  /** 1 = seulement les moments énormes … 5 = beaucoup de clips */
  sensitivity: z.number().int().min(1).max(5).default(3),
  clipMinSec: z.number().min(8).max(60).default(18),
  clipMaxSec: z.number().min(15).max(180).default(50),
  /** Contexte gardé avant le début de l'action / après sa fin */
  preRollSec: z.number().min(0).max(30).default(8),
  postRollSec: z.number().min(0).max(20).default(4),
  maxClipsPerHour: z.number().int().min(1).max(60).default(12),

  template: z.enum(["BLUR", "FULL", "FACECAM"]).default("BLUR"),
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
