import type { Tone } from "../ui";

export const COMPILATION_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: "Brouillon", tone: "neutral" },
  RENDERING: { label: "Montage en cours", tone: "warn" },
  READY: { label: "Prête", tone: "ok" },
  FAILED: { label: "Échec du montage", tone: "bad" },
};
