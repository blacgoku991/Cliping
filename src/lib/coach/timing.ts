/**
 * Créneau de publication conseillé.
 *
 * Cliping ne connaît ni le fuseau ni les heures d'activité du public de l'utilisateur : il ne prétend donc
 * pas deviner « la meilleure heure ». Il propose le premier créneau libre qui laisse un écart raisonnable
 * avec les autres publications de la même plateforme (règle pratique, pas une exigence des plateformes).
 */
export const MIN_GAP_HOURS = 3;

export function suggestSlot(now: Date, busy: Date[], gapHours = MIN_GAP_HOURS): Date {
  const gap = gapHours * 3_600_000;
  // Au plus tôt dans 15 minutes, arrondi au quart d'heure suivant.
  let t = Math.ceil((now.getTime() + 15 * 60_000) / 900_000) * 900_000;
  const sorted = busy.map((d) => d.getTime()).sort((a, b) => a - b);
  for (let i = 0; i < 500; i++) {
    const clash = sorted.find((b) => Math.abs(b - t) < gap);
    if (clash === undefined) return new Date(t);
    t = Math.ceil((clash + gap) / 900_000) * 900_000;
  }
  return new Date(t);
}
