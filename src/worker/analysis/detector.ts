/**
 * Détection des moments forts, en flux continu.
 *
 * Chaque seconde de stream fournit jusqu'à trois signaux :
 *   - audio : sonie max de la seconde (cris, rires, explosion de volume)
 *   - chat  : messages/seconde pondérés par les réactions « hype » (KEKW, MDR, CLIP…)
 *   - scene : intensité des changements d'image (action à l'écran)
 * Chaque signal est comparé à SA ligne de base glissante (médiane + MAD) : on mesure
 * « à quel point c'est inhabituel pour ce streamer », pas un volume absolu.
 * Les écarts sont combinés, lissés sur 5 s (un simple coup de feu ne suffit pas),
 * puis on retient les pics qui dépassent le seuil.
 */

export interface FeatureRow {
  audio: number;
  scene: number | null;
  chat: number | null;
}

export interface DetectorOptions {
  /** Seuil sur le score combiné lissé */
  threshold: number;
  /** Secondes de « futur » nécessaires avant de valider un pic */
  lookahead: number;
  /** Écart minimal entre deux pics */
  minGap: number;
  /** Taille de la ligne de base glissante */
  baselineWindow: number;
  /** Secondes d'observation avant de commencer à détecter */
  warmup: number;
  minDur: number;
  maxDur: number;
  preRoll: number;
  postRoll: number;
  /** 0 = illimité */
  maxPerHour: number;
}

export interface Highlight {
  /** Seconde du pic */
  peak: number;
  start: number;
  end: number;
  /** 0..100 */
  score: number;
  /** Score combiné brut au pic */
  raw: number;
  /** Écart max de chaque signal pendant le moment (en « sigmas » robustes) */
  parts: { audio: number; chat: number | null; scene: number | null };
}

const WEIGHTS = { audio: 1.0, chat: 1.5, scene: 0.35 };
const SENSITIVITY_THRESHOLDS = [3.0, 2.4, 1.9, 1.5, 1.15];

export function thresholdForSensitivity(sensitivity: number): number {
  const i = Math.min(5, Math.max(1, Math.round(sensitivity))) - 1;
  return SENSITIVITY_THRESHOLDS[i]!;
}

export function defaultDetectorOptions(overrides: Partial<DetectorOptions> = {}): DetectorOptions {
  return {
    threshold: thresholdForSensitivity(3),
    lookahead: 12,
    minGap: 30,
    baselineWindow: 600,
    warmup: 30,
    minDur: 18,
    maxDur: 50,
    preRoll: 8,
    postRoll: 4,
    maxPerHour: 0,
    ...overrides,
  };
}

function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = n >> 1;
  return n % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function robustStats(values: number[]): { med: number; mad: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const med = median(sorted);
  const dev = sorted.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
  return { med, mad: median(dev) * 1.4826 };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function scoreFromRaw(raw: number, threshold: number): number {
  return Math.round(clamp(50 + (50 * (raw - threshold)) / (2 * threshold), 1, 100));
}

export class HighlightDetector {
  private readonly audio: number[] = [];
  private readonly chat: Array<number | null> = [];
  private readonly scene: Array<number | null> = [];
  private readonly zAudio: number[] = [];
  private readonly zChat: Array<number | null> = [];
  private readonly zScene: Array<number | null> = [];
  private readonly raw: number[] = [];
  private readonly smoothCache: number[] = [];
  private nextCandidate = 0;
  private lastPeak = -Infinity;
  private lastEnd = 0;
  private readonly emitted: number[] = [];

  constructor(private readonly opts: DetectorOptions) {}

  get length(): number {
    return this.raw.length;
  }

  /** Score combiné lissé (pour l'affichage d'une courbe d'intensité). */
  smoothedAt(i: number): number {
    return this.smooth(i);
  }

  /** Ajoute une seconde de signaux ; renvoie les moments forts validés à cet instant. */
  push(row: FeatureRow): Highlight[] {
    const i = this.raw.length;
    this.audio.push(row.audio);
    this.chat.push(row.chat);
    this.scene.push(row.scene);

    const from = Math.max(0, i - this.opts.baselineWindow);
    const zA = this.zFor(this.audio.slice(from, i), row.audio, { floor: 2.5, cap: 6 });
    // Quasi-silence : pas un moment fort, quel que soit l'écart statistique.
    this.zAudio.push(row.audio < -45 ? 0 : zA);

    let zC: number | null = null;
    if (row.chat !== null) {
      const hist = this.chat.slice(from, i).filter((v): v is number => v !== null);
      const { med } = hist.length ? robustStats(hist) : { med: 0 };
      zC = this.zFor(hist, row.chat, { floor: Math.max(1.5, Math.sqrt(med)), cap: 6 });
    }
    this.zChat.push(zC);

    let zS: number | null = null;
    if (row.scene !== null) {
      const hist = this.scene.slice(from, i).filter((v): v is number => v !== null);
      zS = this.zFor(hist, row.scene, { floor: 0.05, cap: 4 });
    }
    this.zScene.push(zS);

    let sum = WEIGHTS.audio * this.zAudio[i]!;
    let weight = WEIGHTS.audio;
    if (zC !== null) {
      sum += WEIGHTS.chat * zC;
      weight += WEIGHTS.chat;
    }
    if (zS !== null) {
      sum += WEIGHTS.scene * zS;
      weight += WEIGHTS.scene;
    }
    this.raw.push(sum / weight);

    return this.evaluate(this.opts.lookahead);
  }

  /** Fin du stream : valide les derniers pics sans attendre le « futur » habituel. */
  flush(): Highlight[] {
    return this.evaluate(0);
  }

  private zFor(history: number[], value: number, o: { floor: number; cap: number }): number {
    if (history.length < Math.min(this.opts.warmup, 10)) return 0;
    const { med, mad } = robustStats(history);
    return clamp((value - med) / Math.max(mad, o.floor), 0, o.cap);
  }

  private smooth(i: number): number {
    const cached = this.smoothCache[i];
    if (cached !== undefined) return cached;
    const lo = Math.max(0, i - 2);
    const hi = Math.min(this.raw.length - 1, i + 2);
    let s = 0;
    for (let k = lo; k <= hi; k++) s += this.raw[k]!;
    const v = s / 5;
    // La valeur n'est définitive qu'une fois les 2 secondes suivantes connues.
    if (i + 2 <= this.raw.length - 1) this.smoothCache[i] = v;
    return v;
  }

  private evaluate(lookahead: number): Highlight[] {
    const out: Highlight[] = [];
    const n = this.raw.length;
    const { threshold, minGap, warmup } = this.opts;
    const back = Math.min(minGap, 15);

    for (; this.nextCandidate <= n - 1 - lookahead; this.nextCandidate++) {
      const c = this.nextCandidate;
      if (c < warmup) continue;
      const s = this.smooth(c);
      if (s < threshold) continue;
      if (c - this.lastPeak < minGap) continue;

      let isPeak = true;
      for (let j = Math.max(0, c - back); j < c && isPeak; j++) if (this.smooth(j) >= s) isPeak = false;
      const ahead = Math.min(n - 1, c + Math.max(lookahead, 0));
      for (let j = c + 1; j <= ahead && isPeak; j++) if (this.smooth(j) > s) isPeak = false;
      if (!isPeak) continue;

      if (this.opts.maxPerHour > 0) {
        while (this.emitted.length && this.emitted[0]! < c - 3600) this.emitted.shift();
        if (this.emitted.length >= this.opts.maxPerHour) continue;
      }

      const h = this.buildWindow(c, s, ahead);
      if (!h) continue;
      this.lastPeak = c;
      this.lastEnd = h.end;
      this.emitted.push(c);
      out.push(h);
    }
    return out;
  }

  private buildWindow(c: number, s: number, ahead: number): Highlight | null {
    const { threshold, minDur, maxDur, preRoll, postRoll } = this.opts;
    const low = Math.max(0.45 * s, 0.5 * threshold);

    let a = c;
    while (a - 1 >= Math.max(0, c - maxDur) && this.smooth(a - 1) > low) a--;
    let b = c;
    while (b + 1 <= ahead && this.smooth(b + 1) > low) b++;

    let start = a - preRoll;
    let end = b + 1 + postRoll;
    if (end - start < minDur) {
      // On ajoute surtout du contexte AVANT : c'est la mise en place qui rend le moment compréhensible.
      const deficit = minDur - (end - start);
      start -= deficit * 0.65;
      end += deficit * 0.35;
    }
    if (end - start > maxDur) {
      start = Math.max(start, Math.min(c - maxDur * 0.6, end - maxDur));
      end = start + maxDur;
    }
    // Pas de recouvrement avec le clip précédent.
    start = Math.max(0, start, this.lastEnd);
    if (end - start < Math.min(minDur, 10) || c < start || c > end) return null;

    const maxOf = (arr: Array<number | null>): number | null => {
      let m: number | null = null;
      for (let k = a; k <= b; k++) {
        const v = arr[k];
        if (v !== null && v !== undefined && (m === null || v > m)) m = v;
      }
      return m === null ? null : Math.round(m * 10) / 10;
    };

    return {
      peak: c,
      start: Math.round(start * 10) / 10,
      end: Math.round(end * 10) / 10,
      score: scoreFromRaw(s, threshold),
      raw: Math.round(s * 100) / 100,
      parts: { audio: maxOf(this.zAudio) ?? 0, chat: maxOf(this.zChat), scene: maxOf(this.zScene) },
    };
  }
}

/**
 * Décale un point de coupe vers le creux sonore le plus proche (fin de phrase, respiration),
 * pour éviter de couper au milieu d'un mot. `loudness` : une valeur toutes les 100 ms.
 */
export function snapToQuiet(
  loudness: ArrayLike<number>,
  t: number,
  opts: { before?: number; after?: number; offset?: number } = {},
): number {
  const before = opts.before ?? 1.5;
  const after = opts.after ?? 1.0;
  const offset = opts.offset ?? 0;
  const lo = Math.max(0, Math.round((t - before - offset) * 10));
  const hi = Math.min(loudness.length - 1, Math.round((t + after - offset) * 10));
  if (hi <= lo) return t;
  let minV = Infinity;
  let minI = -1;
  let sum = 0;
  for (let i = lo; i <= hi; i++) {
    const v = loudness[i]!;
    sum += v;
    if (v < minV) {
      minV = v;
      minI = i;
    }
  }
  const mean = sum / (hi - lo + 1);
  // Creux pas assez marqué : on ne touche à rien.
  if (minI < 0 || mean - minV < 6) return t;
  return Math.round((minI / 10 + 0.05 + offset) * 10) / 10;
}

/** Détection hors-ligne (VOD) : passe tout le signal, puis garde les `limit` meilleurs moments. */
export function detectOffline(rows: FeatureRow[], opts: DetectorOptions, limit: number): Highlight[] {
  const det = new HighlightDetector({ ...opts, maxPerHour: 0 });
  const all: Highlight[] = [];
  for (const r of rows) all.push(...det.push(r));
  all.push(...det.flush());
  return all
    .sort((x, y) => y.raw - x.raw)
    .slice(0, Math.max(1, limit))
    .sort((x, y) => x.peak - y.peak);
}
