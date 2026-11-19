/**
 * Potentiel d'un clip (0..100) : une estimation de ses chances de bien tourner, à partir de ce qu'on mesure.
 *
 * Aucune formule ne prédit les vues : les plateformes ne publient pas leurs algorithmes. Ce score classe
 * les moments entre eux pour ne garder que les plus forts, en combinant :
 *  - l'intensité du moment (voix, action à l'écran), relative à l'habitude du stream (détecteur) ;
 *  - la réaction du chat : un moment qui ne fait pas réagir le chat perd des points, une explosion du chat en gagne ;
 *  - les demandes de clip : des spectateurs qui tapent « clip » plus que d'habitude sur ce live ;
 *  - l'avis de l'IA sur le contenu, quand elle est configurée.
 * La page Performances permet ensuite de vérifier, sur tes propres publications, si ce classement tient.
 */

export interface ViralityInput {
  /** Score du détecteur, 50..100 pour un moment retenu */
  detector: number;
  /** Écart de l'activité du chat au moment fort, en « sigmas » robustes (null = chat non lu) */
  chat: number | null;
  /** Messages contenant une demande de clip pendant le moment (null = chat non lu) */
  clipRequests: number | null;
  /** Même compte, en moyenne, sur une fenêtre de même durée dans les 10 minutes précédentes */
  clipBaseline: number | null;
  /** Note de l'IA 0..100 (null = IA non configurée) */
  ai: number | null;
}

export interface ViralityResult {
  score: number;
  /** Détail affichable : points ajoutés ou retirés par chaque signal */
  parts: { detector: number; chat: number; clips: number; ai: number | null };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Le chat réagit à 2 σ = neutre ; 0 σ = -8 ; 5 σ et plus = +12. */
export function chatAdjustment(chat: number | null): number {
  if (chat === null || !Number.isFinite(chat)) return 0;
  return clamp(Math.round((chat - 2) * 4), -12, 12);
}

/**
 * Demandes de clip plus nombreuses que d'habitude sur ce live : jusqu'à +15.
 * On compare au rythme habituel du chat, pour qu'un gros chat qui spamme « clip » en permanence ne gonfle pas tout.
 */
export function clipAdjustment(requests: number | null, baseline: number | null): number {
  if (requests === null || requests <= 0) return 0;
  const ratio = (requests + 1) / ((baseline ?? 0) + 1);
  return clamp(Math.round((ratio - 1) * 5), 0, 15);
}

export function viralityScore(input: ViralityInput): ViralityResult {
  const chat = chatAdjustment(input.chat);
  const clips = clipAdjustment(input.clipRequests, input.clipBaseline);
  const measured = clamp(input.detector + chat + clips, 1, 100);
  const score = input.ai === null ? measured : 0.55 * measured + 0.45 * clamp(input.ai, 0, 100);
  return {
    score: Math.round(clamp(score, 1, 100)),
    parts: { detector: Math.round(input.detector), chat, clips, ai: input.ai },
  };
}

/** Décision de tri : on garde un clip si son potentiel atteint le minimum choisi. */
export function keepClip(score: number, minScore: number): boolean {
  return score >= minScore;
}

export function rejectionNote(score: number, minScore: number): string {
  return `Écarté automatiquement : potentiel ${score}/100, sous ton minimum de ${minScore} (Réglages → Détection). Approuve-le si tu veux quand même le garder.`;
}
