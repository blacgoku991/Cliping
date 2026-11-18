import type { SocialPlatform } from "@prisma/client";
import { z } from "zod";
import { ALL_ITEM_IDS } from "./guide";

/** D'où vient un texte : Claude, ou les modèles génériques utilisés sans clé API. */
export type KitSource = "ai" | "template";

export const TONES = {
  chaleureux: "Chaleureux",
  drole: "Drôle",
  sobre: "Sobre",
  direct: "Direct",
} as const;
export type Tone = keyof typeof TONES;

export function parseTone(raw: unknown): Tone {
  return typeof raw === "string" && raw in TONES ? (raw as Tone) : "chaleureux";
}

// ───────────── Profil (bio, nom) ─────────────

export interface ProfileInput {
  niche: string;
  tone: Tone;
  streamers: string[];
  language: string;
}

export interface ProfileKit {
  platform: SocialPlatform;
  input: ProfileInput;
  bios: string[];
  displayNames: string[];
  usernames: string[];
  /** Conseils courts sur la photo et le lien (génériques ou adaptés par l'IA) */
  tips: string[];
  source: KitSource;
  generatedAt: string;
}

// ───────────── Kit de publication d'un clip ─────────────

export interface ReplyIdea {
  /** Commentaire type auquel on répond */
  comment: string;
  reply: string;
}

export interface PlatformKit {
  title: string;
  caption: string;
  hashtags: string[];
  pinnedComments: string[];
  replies: ReplyIdea[];
}

export interface PublishKit {
  platforms: Partial<Record<SocialPlatform, PlatformKit>>;
  source: KitSource;
  generatedAt: string;
}

// ───────────── État du coach stocké sur l'utilisateur ─────────────

export interface CoachState {
  /** id de conseil → date ISO à laquelle il a été coché */
  done: Record<string, string>;
  /** Profils préparés pour un compte pas encore connecté */
  drafts: Partial<Record<SocialPlatform, ProfileKit>>;
}

const platformSchema = z.enum(["TIKTOK", "YOUTUBE"]);
const strList = (max: number) => z.array(z.string()).max(max).catch([]);

const profileKitSchema = z.object({
  platform: platformSchema,
  input: z.object({
    niche: z.string().catch(""),
    tone: z.string().transform(parseTone).catch("chaleureux" as Tone),
    streamers: strList(10),
    language: z.string().catch("fr"),
  }),
  bios: strList(10),
  displayNames: strList(10),
  usernames: strList(10),
  tips: strList(10),
  source: z.enum(["ai", "template"]).catch("template"),
  generatedAt: z.string().catch(""),
});

const platformKitSchema = z.object({
  title: z.string().catch(""),
  caption: z.string().catch(""),
  hashtags: strList(30),
  pinnedComments: strList(10),
  replies: z.array(z.object({ comment: z.string(), reply: z.string() })).max(12).catch([]),
});

const publishKitSchema = z.object({
  platforms: z.object({ TIKTOK: platformKitSchema.optional(), YOUTUBE: platformKitSchema.optional() }),
  source: z.enum(["ai", "template"]).catch("template"),
  generatedAt: z.string().catch(""),
});

/** Lit un kit de profil stocké en base ; null si absent ou illisible. */
export function parseProfileKit(raw: unknown): ProfileKit | null {
  const r = profileKitSchema.safeParse(raw);
  return r.success ? r.data : null;
}

export function parsePublishKit(raw: unknown): PublishKit | null {
  const r = publishKitSchema.safeParse(raw);
  return r.success ? r.data : null;
}

export function parseCoachState(raw: unknown): CoachState {
  const obj = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const done: Record<string, string> = {};
  const known = new Set(ALL_ITEM_IDS);
  if (typeof obj.done === "object" && obj.done !== null) {
    for (const [k, v] of Object.entries(obj.done as Record<string, unknown>)) {
      if (known.has(k) && typeof v === "string") done[k] = v;
    }
  }
  const drafts: CoachState["drafts"] = {};
  if (typeof obj.drafts === "object" && obj.drafts !== null) {
    for (const p of ["TIKTOK", "YOUTUBE"] as const) {
      const kit = parseProfileKit((obj.drafts as Record<string, unknown>)[p]);
      if (kit) drafts[p] = kit;
    }
  }
  return { done, drafts };
}
