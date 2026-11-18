/**
 * Plan de montage : logique pure (aucun appel à ffmpeg ni à la base), testée par vitest.
 *
 * Toutes les entrées sont exprimées en secondes dans le fichier source du clip (source.mp4) ;
 * le plan dit quels morceaux de la source mettre bout à bout, et permet de convertir
 * un instant de la source en instant(s) de la vidéo finale.
 */
import type { Word } from "./captions";

/** Un morceau de la source repris tel quel dans le montage final. */
export interface Segment {
  from: number;
  to: number;
  /** « teaser » = flash du moment fort placé en ouverture (cold open) */
  kind: "teaser" | "body";
}

export interface EditPlan {
  segments: Segment[];
  /** Durée du montage (sans le carton de fin) */
  duration: number;
  /** Durée du cold open en tête de clip, 0 s'il n'y en a pas */
  teaserDur: number;
  /** Secondes de temps morts retirées */
  removed: number;
  /** Nombre de coupes sèches faites dans le corps du clip */
  cuts: number;
  /** Position du moment fort dans la vidéo finale (dans le corps, après le cold open) */
  peakOut: number;
}

export interface PlanInput {
  start: number;
  end: number;
  peak: number;
  /** Sonie (LUFS) toutes les 100 ms depuis le début de la source ; null = pas d'audio */
  loudness: ArrayLike<number> | null;
  /** Mots transcrits, horodatés dans la source ; vide si pas de transcription */
  words: Word[];
  coldOpen: boolean;
  trimSilence: boolean;
  /** Cadence de sortie : les coupes tombent sur une image entière */
  fps?: number;
}

// ───────────────────────── Réglages internes (calés sur le banc d'essai et des clips gaming réels) ─────────────────────────

/** On ne coupe jamais dans les dernières secondes avant le pic, ni après. */
export const PEAK_GUARD_SEC = 2.5;
/** Un trou doit faire au moins ça (après marges) pour valoir une coupe. */
const MIN_CUT_SEC = 0.4;
/** Silence de parole minimal pour envisager une coupe entre deux mots. */
const MIN_SPEECH_GAP_SEC = 0.7;
/** En dessous, la pause ne compte comme fin de phrase que si le mot précédent porte une ponctuation finale. */
const SENTENCE_GAP_SEC = 1.2;
/** Marges gardées autour de la parole pour ne pas manger les attaques et les fins de mots. */
const PAD_AFTER_WORD = 0.2;
const PAD_BEFORE_WORD = 0.15;
/** Un morceau gardé plus court que ça entre deux coupes ferait un « saut » illisible. */
const MIN_KEEP_SEC = 0.6;
/** On ne retire jamais plus de cette part de la mise en place. */
const MAX_REMOVED_RATIO = 0.4;
/** « Creux » sonore : au moins 10 LU sous le niveau de l'action du clip. */
const QUIET_BELOW_REF_LU = 10;
const ABSOLUTE_SILENCE_LUFS = -50;

/** Cold open : flash du pic de ~1,6 s. */
const TEASER_BEFORE = 0.5;
const TEASER_AFTER = 1.1;
const TEASER_MIN = 1.1;
const TEASER_MAX = 2.2;
/** Conditions pour qu'un cold open ait du sens. */
export const COLD_OPEN_MIN_CLIP_SEC = 14;
export const COLD_OPEN_MIN_PEAK_SEC = 6;

const round3 = (n: number) => Math.round(n * 1000) / 1000;

function quantize(t: number, fps: number): number {
  return round3(Math.round(t * fps) / fps);
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[i]!;
}

function loudSlice(loudness: ArrayLike<number>, from: number, to: number): number[] {
  const out: number[] = [];
  const lo = Math.max(0, Math.floor(from * 10));
  const hi = Math.min(loudness.length - 1, Math.ceil(to * 10) - 1);
  for (let i = lo; i <= hi; i++) out.push(loudness[i]!);
  return out;
}

/** Niveau de référence de l'action dans la fenêtre du clip (75e centile de la sonie). */
export function referenceLevel(loudness: ArrayLike<number>, from: number, to: number): number {
  return percentile(loudSlice(loudness, from, to), 0.75);
}

function isQuiet(loudness: ArrayLike<number>, from: number, to: number, ref: number): boolean {
  const vals = loudSlice(loudness, from, to);
  if (vals.length === 0) return false;
  // La fenêtre de sonie (400 ms) déborde : on juge sur le 80e centile, pas sur la moyenne.
  const level = percentile(vals, 0.8);
  return level <= Math.max(ref - QUIET_BELOW_REF_LU, ABSOLUTE_SILENCE_LUFS) || level <= ABSOLUTE_SILENCE_LUFS;
}

const endsSentence = (w: string) => /[.!?…]["»”)]*$/.test(w.trim());

/**
 * Temps morts à retirer entre `start` et la garde avant le pic : silences de parole qui tombent
 * entre deux phrases ET qui sont des creux sonores (pas de coupe pendant que le jeu fait du bruit).
 * Sans transcription, on se contente des creux sonores.
 */
export function findDeadAir(input: {
  start: number;
  peak: number;
  end: number;
  loudness: ArrayLike<number> | null;
  words: Word[];
}): Array<[number, number]> {
  const { start, peak, loudness } = input;
  const guard = Math.min(peak - PEAK_GUARD_SEC, input.end);
  if (!loudness || loudness.length === 0 || guard - start < 2) return [];
  const ref = referenceLevel(loudness, start, input.end);
  if (!Number.isFinite(ref)) return [];

  const candidates: Array<[number, number]> = [];
  const words = input.words.filter((w) => w.e > start && w.s < input.end).sort((a, b) => a.s - b.s);

  if (words.length > 0) {
    // Trou de tête : du début du clip au premier mot.
    const first = words[0]!;
    if (first.s - start >= MIN_SPEECH_GAP_SEC) candidates.push([start, first.s - PAD_BEFORE_WORD]);
    for (let i = 1; i < words.length; i++) {
      const prev = words[i - 1]!;
      const next = words[i]!;
      const gap = next.s - prev.e;
      if (gap < MIN_SPEECH_GAP_SEC) continue;
      // Jamais au milieu d'une phrase : il faut une ponctuation finale ou une vraie pause.
      if (!endsSentence(prev.w) && gap < SENTENCE_GAP_SEC) continue;
      candidates.push([prev.e + PAD_AFTER_WORD, next.s - PAD_BEFORE_WORD]);
    }
    // Après le dernier mot (s'il tombe avant la garde) : silence jusqu'à la garde.
    const last = words[words.length - 1]!;
    if (last.e + PAD_AFTER_WORD < guard) candidates.push([last.e + PAD_AFTER_WORD, guard]);
  } else {
    // Pas de transcription : suites de creux sonores d'au moins 0,8 s.
    let runStart = -1;
    const lo = Math.max(0, Math.ceil(start * 10));
    const hi = Math.min(loudness.length, Math.floor(guard * 10));
    const quietAt = (i: number) => loudness[i]! <= Math.max(ref - QUIET_BELOW_REF_LU, ABSOLUTE_SILENCE_LUFS);
    for (let i = lo; i <= hi; i++) {
      const q = i < hi && quietAt(i);
      if (q && runStart < 0) runStart = i;
      if (!q && runStart >= 0) {
        const a = runStart / 10;
        const b = i / 10;
        if (b - a >= 0.8) candidates.push([a === start ? a : a + PAD_AFTER_WORD, b - PAD_BEFORE_WORD]);
        runStart = -1;
      }
    }
  }

  const zones: Array<[number, number]> = [];
  for (const [a0, b0] of candidates) {
    const a = Math.max(start, a0);
    const b = Math.min(guard, b0);
    if (b - a < MIN_CUT_SEC) continue;
    if (!isQuiet(loudness, a, b, ref)) continue;
    zones.push([a, b]);
  }

  // Pas de miettes : un morceau gardé trop court entre deux coupes saute la seconde coupe.
  const out: Array<[number, number]> = [];
  let keptFrom = start;
  for (const z of zones) {
    if (z[0] > start && z[0] - keptFrom < MIN_KEEP_SEC) continue;
    out.push(z);
    keptFrom = z[1];
  }

  // Plafond : on ne vide pas la mise en place (on garde les coupes les plus longues).
  const budget = (guard - start) * MAX_REMOVED_RATIO;
  const total = out.reduce((n, [a, b]) => n + b - a, 0);
  if (total <= budget) return out;
  const byLength = [...out].sort((x, y) => y[1] - y[0] - (x[1] - x[0]));
  const kept: Array<[number, number]> = [];
  let used = 0;
  for (const z of byLength) {
    if (used + (z[1] - z[0]) > budget) continue;
    kept.push(z);
    used += z[1] - z[0];
  }
  return kept.sort((x, y) => x[0] - y[0]);
}

/** Fenêtre du cold open autour du pic, recalée pour ne pas couper un mot en deux. */
export function teaserWindow(peak: number, start: number, end: number, words: Word[]): [number, number] | null {
  let a = Math.max(start, peak - TEASER_BEFORE);
  let b = Math.min(end, peak + TEASER_AFTER);
  for (const w of words) {
    if (w.s < a && w.e > a) a = a - w.s <= 0.45 ? Math.max(start, w.s - 0.05) : w.e;
    if (w.s < b && w.e > b) b = w.e - b <= 0.6 ? Math.min(end, w.e + 0.05) : w.s;
  }
  if (b - a > TEASER_MAX) b = a + TEASER_MAX;
  if (b - a < TEASER_MIN) return null;
  return [a, b];
}

/** Construit le plan de montage complet. */
export function buildPlan(input: PlanInput): EditPlan {
  const fps = input.fps ?? 30;
  const start = input.start;
  const end = Math.max(input.end, start + 1);
  const peak = Math.min(Math.max(input.peak, start), end);

  const dead = input.trimSilence ? findDeadAir({ start, end, peak, loudness: input.loudness, words: input.words }) : [];
  const body: Segment[] = [];
  let cursor = start;
  for (const [a, b] of dead) {
    if (a > cursor) body.push({ from: cursor, to: a, kind: "body" });
    cursor = b;
  }
  if (end > cursor) body.push({ from: cursor, to: end, kind: "body" });

  let segments: Segment[] = body
    .map((s) => ({ ...s, from: quantize(s.from, fps), to: quantize(s.to, fps) }))
    .filter((s) => s.to - s.from >= 1 / fps);
  const removed = round3(end - start - segments.reduce((n, s) => n + s.to - s.from, 0));
  const cuts = dead.filter(([a]) => a > start).length;

  const bodyDur = segments.reduce((n, s) => n + s.to - s.from, 0);
  const peakInBody = mapTime(segments, peak)[0] ?? peak - start;

  let teaserDur = 0;
  if (input.coldOpen && bodyDur >= COLD_OPEN_MIN_CLIP_SEC && peakInBody >= COLD_OPEN_MIN_PEAK_SEC) {
    const win = teaserWindow(peak, start, end, input.words);
    if (win) {
      const t: Segment = { from: quantize(win[0], fps), to: quantize(win[1], fps), kind: "teaser" };
      teaserDur = round3(t.to - t.from);
      segments = [t, ...segments];
    }
  }

  return {
    segments,
    duration: round3(teaserDur + bodyDur),
    teaserDur,
    removed: Math.max(0, removed),
    cuts,
    peakOut: round3(teaserDur + peakInBody),
  };
}

/** Instants de la vidéo finale où passe l'instant `t` de la source (plusieurs si le cold open le reprend). */
export function mapTime(segments: Segment[], t: number): number[] {
  const out: number[] = [];
  let offset = 0;
  for (const s of segments) {
    if (t >= s.from && t <= s.to) out.push(round3(offset + t - s.from));
    offset += s.to - s.from;
  }
  return out;
}

/**
 * Recale les mots sur la vidéo finale. Un mot coupé par une borne de morceau est raccourci ;
 * renvoie aussi les instants de « rupture » (début de chaque morceau) pour ne pas regrouper
 * dans un même sous-titre des mots de part et d'autre d'une coupe.
 */
export function mapWords(segments: Segment[], words: Word[]): { words: Word[]; breaks: number[] } {
  const out: Word[] = [];
  const breaks: number[] = [];
  let offset = 0;
  for (const seg of segments) {
    breaks.push(round3(offset));
    for (const w of words) {
      const s = Math.max(w.s, seg.from);
      const e = Math.min(w.e, seg.to);
      // On garde un mot s'il est majoritairement dans le morceau.
      if (e - s <= 0 || e - s < 0.5 * (w.e - w.s)) continue;
      out.push({ w: w.w, s: round3(offset + s - seg.from), e: round3(offset + e - seg.from) });
    }
    offset += seg.to - seg.from;
  }
  out.sort((a, b) => a.s - b.s);
  return { words: out, breaks: breaks.slice(1) };
}

// ───────────────────────── Bornes intelligentes ─────────────────────────

export interface BoundsInput {
  start: number;
  end: number;
  peak: number;
  sourceDur: number;
  words: Word[];
  loudness: ArrayLike<number> | null;
}

const SENTENCE_START_GAP = 0.5;

function isSentenceStart(words: Word[], i: number): boolean {
  if (i === 0) return true;
  const prev = words[i - 1]!;
  const cur = words[i]!;
  return cur.s - prev.e >= SENTENCE_START_GAP || endsSentence(prev.w);
}

/**
 * Ajuste les bornes d'un clip fraîchement détecté :
 * - début calé sur un début de phrase (jusqu'à 3 s avant, 2,5 s après) ;
 * - premiers mots dans la première seconde ;
 * - fin après la phrase en cours ou la réaction (sonie encore haute), jusqu'à 4 s de plus.
 * Le pic reste toujours dans le clip avec au moins 3 s de mise en place et 1,5 s de suite.
 */
export function refineBounds(input: BoundsInput): { start: number; end: number; reasons: string[] } {
  const { peak, sourceDur } = input;
  let { start, end } = input;
  const reasons: string[] = [];
  const words = input.words.filter((w) => w.e > 0 && w.s < sourceDur).sort((a, b) => a.s - b.s);
  const latestStart = Math.max(0, peak - 3);

  if (words.length) {
    // 1. Début de phrase le plus proche.
    let best: number | null = null;
    for (let i = 0; i < words.length; i++) {
      const w = words[i]!;
      if (w.s < start - 3 || w.s > start + 2.5 || w.s - 0.2 > latestStart) continue;
      if (!isSentenceStart(words, i)) continue;
      if (best === null || Math.abs(w.s - start) < Math.abs(best - start)) best = w.s;
    }
    if (best !== null) {
      const s = Math.max(0, best - 0.2);
      if (Math.abs(s - start) > 0.05) reasons.push("début calé sur une phrase");
      start = s;
    } else {
      // Pas de début de phrase proche : au moins ne pas commencer au milieu d'un mot.
      const inside = words.find((w) => w.s < start && w.e > start);
      if (inside) {
        start = Math.max(0, inside.s - 0.1);
        reasons.push("début avant le mot coupé");
      }
    }
    // 2. Premiers mots dans la première seconde.
    const first = words.find((w) => w.s >= start - 0.05);
    if (first && first.s - start > 1 && first.s - 0.3 <= latestStart) {
      start = first.s - 0.3;
      reasons.push("blanc d'ouverture retiré");
    }

    // 3. Fin : finir la phrase en cours (mots qui s'enchaînent à moins de 0,6 s).
    let i = words.findIndex((w) => w.e > end - 0.3);
    if (i >= 0 && words[i]!.s < end + 0.6) {
      let chainEnd = words[i]!.e;
      while (i + 1 < words.length && words[i + 1]!.s - words[i]!.e < 0.6) {
        i++;
        chainEnd = words[i]!.e;
      }
      if (chainEnd + 0.35 <= end + 4) {
        const e = Math.min(sourceDur, chainEnd + 0.35);
        if (e > end + 0.05) reasons.push("fin après la phrase");
        end = Math.max(end, e);
      } else {
        // Phrase trop longue : on coupe à la dernière respiration avant la fin prévue (jamais trop près du pic).
        for (let j = words.length - 1; j > 0; j--) {
          const gapStart = words[j - 1]!.e;
          if (gapStart > end) continue;
          if (gapStart < peak + 1.5) break;
          if (words[j]!.s - gapStart >= 0.3) {
            end = gapStart + 0.25;
            reasons.push("fin sur une respiration");
            break;
          }
        }
      }
    }
  }

  // 4. Réaction encore en cours (cris, rires) : on laisse retomber.
  if (input.loudness && input.loudness.length) {
    const ref = referenceLevel(input.loudness, start, end);
    const high = ref - 3;
    const at = (t: number) => input.loudness![Math.min(input.loudness!.length - 1, Math.max(0, Math.round(t * 10)))]!;
    if (Number.isFinite(ref) && at(end - 0.1) >= high) {
      let t = end;
      const limit = Math.min(sourceDur, end + 3);
      let quietFor = 0;
      while (t < limit) {
        quietFor = at(t) < high ? quietFor + 0.1 : 0;
        if (quietFor >= 0.3) break;
        t += 0.1;
      }
      if (t > end + 0.15) {
        end = Math.min(sourceDur, t + 0.15);
        reasons.push("fin après la réaction");
      }
    }
  }

  start = Math.max(0, Math.min(start, latestStart));
  end = Math.min(sourceDur, Math.max(end, peak + 1.5, start + 5));
  return { start: round3(start), end: round3(end), reasons };
}

// ───────────────────────── Zoom d'impact ─────────────────────────

export interface ZoomWindow {
  /** Instant (vidéo finale) du moment fort */
  at: number;
  /** Le zoom s'arrête net à cet instant (fin du cold open) ; Infinity sinon */
  cutAt: number;
}

export const PUNCH_ZOOM = 0.12;

/** Fenêtres de zoom : une par passage du pic dans la vidéo finale. */
export function zoomWindows(plan: EditPlan, peak: number): ZoomWindow[] {
  const out: ZoomWindow[] = [];
  let offset = 0;
  for (const s of plan.segments) {
    if (peak >= s.from && peak <= s.to) {
      out.push({ at: round3(offset + peak - s.from), cutAt: s.kind === "teaser" ? round3(offset + s.to - s.from) : Infinity });
    }
    offset += s.to - s.from;
  }
  return out;
}

/** Facteur de zoom à l'instant t (pour les tests et l'aperçu) — même courbe que zoomExpr(). */
export function zoomAt(windows: ZoomWindow[], t: number, amount = PUNCH_ZOOM): number {
  const smooth = (x: number) => {
    const c = Math.min(1, Math.max(0, x));
    return c * c * (3 - 2 * c);
  };
  let best = 0;
  for (const w of windows) {
    if (t >= w.cutAt) continue;
    const up = smooth((t - (w.at - 0.35)) / 0.6);
    const down = smooth((t - (w.at + 2.2)) / 0.9);
    best = Math.max(best, up * (1 - down));
  }
  return 1 + amount * best;
}

/**
 * Expression ffmpeg du zoom (variable `t` en secondes), courbe identique à zoomAt() :
 * montée douce sur 0,6 s autour du pic, maintien ~2 s, retour sur 0,9 s.
 */
export function zoomExpr(windows: ZoomWindow[], tVar: string, amount = PUNCH_ZOOM): string {
  if (windows.length === 0) return "1";
  const sm = (x: string) => `(clip(${x},0,1)*clip(${x},0,1)*(3-2*clip(${x},0,1)))`;
  const terms = windows.map((w) => {
    const up = sm(`(${tVar}-${(w.at - 0.35).toFixed(3)})/0.6`);
    const down = sm(`(${tVar}-${(w.at + 2.2).toFixed(3)})/0.9`);
    const gate = Number.isFinite(w.cutAt) ? `*lt(${tVar},${w.cutAt.toFixed(3)})` : "";
    return `${up}*(1-${down})${gate}`;
  });
  const combined = terms.reduce((acc, t) => (acc ? `max(${acc},${t})` : t), "");
  return `1+${amount}*${combined}`;
}
