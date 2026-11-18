import { spawn, type ChildProcess } from "node:child_process";
import { readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SourcePlatform } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { enqueue } from "@/lib/jobs";
import type { ClipSettings } from "@/lib/settings";
import { clipDir, clipFile, ensureDir, recordingDir, removeDir } from "@/lib/storage";
import { defaultDetectorOptions, HighlightDetector, snapToQuiet, thresholdForSensitivity, type Highlight } from "./analysis/detector";
import { analyzeMedia, SILENCE_LUFS } from "./analysis/features";
import { TwitchChat } from "./chat/twitch";
import { log, runOk } from "./proc";
import { validFacecam } from "./render/render";

/** Marge gardée avant/après chaque clip dans source.mp4, pour pouvoir ajuster la coupe à la main. */
export const CUT_PAD_SEC = 5;

export interface RecorderTarget {
  recordingId: string;
  userId: string;
  streamer: {
    id: string;
    platform: SourcePlatform;
    login: string;
    url: string;
    quality: string;
    displayName: string;
    facecam: unknown;
  };
  settings: ClipSettings;
}

interface Segment {
  index: number;
  file: string;
  start: number;
  dur: number;
  /** Horloge (s) à laquelle la fin du segment a été reçue */
  wallEnd: number;
  deleted: boolean;
}

export function detectorOptionsFor(settings: ClipSettings, live: boolean) {
  return defaultDetectorOptions({
    threshold: thresholdForSensitivity(settings.sensitivity),
    minDur: settings.clipMinSec,
    maxDur: Math.max(settings.clipMaxSec, settings.clipMinSec + 2),
    preRoll: settings.preRollSec,
    postRoll: settings.postRollSec,
    maxPerHour: live ? settings.maxClipsPerHour : 0,
  });
}

/**
 * Enregistre un live en continu et en extrait les moments forts au fil de l'eau.
 *
 *   streamlink ──(flux MPEG-TS)──▶ ffmpeg (découpe en segments, sans réencodage)
 *        chaque segment terminé ──▶ analyse son/image ──▶ détecteur ──▶ source.mp4 du clip ──▶ tâche de montage
 *
 * Seul un tampon glissant de quelques minutes reste sur disque : un live de 10 h ne remplit pas le serveur.
 */
export class LiveRecorder {
  readonly dir: string;
  private sl?: ChildProcess;
  private ff?: ChildProcess;
  private chat?: TwitchChat;
  private readonly detector: HighlightDetector;
  private readonly segments: Segment[] = [];
  private nextIndex = 0;
  /** Secondes de stream analysées jusqu'ici */
  private timeline = 0;
  /** Sonie toutes les 100 ms sur toute la durée */
  private readonly loud: number[] = [];
  private readonly sceneSec: Array<number | null> = [];
  private rowsPushed = 0;
  private readonly pending: Highlight[] = [];
  private procEnded = false;
  private finalized = false;
  private stopping = false;
  private busy = false;
  private timer?: NodeJS.Timeout;
  private lastDbUpdate = 0;
  private slErrors: string[] = [];
  private clipsMade = 0;
  stopReason = "";
  onEnd?: (rec: LiveRecorder) => void;

  constructor(readonly target: RecorderTarget) {
    this.dir = recordingDir(target.recordingId);
    this.detector = new HighlightDetector(detectorOptionsFor(target.settings, true));
  }

  get streamerId(): string {
    return this.target.streamer.id;
  }

  get done(): boolean {
    return this.finalized;
  }

  private tag(): string {
    return `rec:${this.target.streamer.login}`;
  }

  async start(): Promise<void> {
    await ensureDir(this.dir);
    const { streamer } = this.target;

    if (streamer.platform === "TWITCH") {
      this.chat = new TwitchChat(streamer.login);
      this.chat.start();
    }

    const slArgs = [
      ...env.worker.streamlinkArgs,
      "--stdout",
      "--loglevel", "warning",
      "--retry-open", "2",
      // Twitch : streamlink filtre lui-même les coupures pub (pas d'option à passer depuis la v7).
      streamer.url,
      streamer.quality || "best",
    ];
    const ffArgs = [
      "-hide_banner", "-loglevel", "error",
      "-fflags", "+genpts+discardcorrupt",
      "-i", "pipe:0",
      "-map", "0:v:0", "-map", "0:a:0?",
      "-c", "copy",
      "-f", "segment",
      "-segment_time", String(env.worker.segmentSec),
      "-segment_format", "mpegts",
      "-reset_timestamps", "1",
      "seg_%06d.ts",
    ];

    const sl = spawn(env.bin.streamlink, slArgs, { stdio: ["ignore", "pipe", "pipe"] });
    const ff = spawn(env.bin.ffmpeg, ffArgs, { cwd: this.dir, stdio: ["pipe", "ignore", "pipe"] });
    this.sl = sl;
    this.ff = ff;

    sl.stdout!.pipe(ff.stdin!);
    // Si ffmpeg s'arrête le premier, l'écriture dans le tube échoue : ce n'est pas une erreur à remonter.
    ff.stdin!.on("error", () => {});
    sl.stdout!.on("error", () => {});
    sl.stderr!.setEncoding("utf8").on("data", (d: string) => {
      for (const line of d.split("\n")) if (line.trim()) this.slErrors.push(line.trim());
      if (this.slErrors.length > 20) this.slErrors.splice(0, this.slErrors.length - 20);
    });
    ff.stderr!.setEncoding("utf8").on("data", () => {});
    sl.on("error", (err) => {
      this.slErrors.push(`Impossible de lancer streamlink : ${err.message}`);
      ff.stdin?.end();
    });
    ff.on("error", (err) => {
      this.slErrors.push(`Impossible de lancer ffmpeg : ${err.message}`);
      sl.kill("SIGTERM");
      this.procEnded = true;
    });
    sl.on("close", () => {
      if (!this.stopReason) this.stopReason = "fin du live";
    });
    ff.on("close", () => {
      this.procEnded = true;
      if (!sl.killed && sl.exitCode === null) sl.kill("SIGTERM");
    });

    this.timer = setInterval(() => void this.tick(), 2000);
    log(this.tag(), `enregistrement démarré (${streamer.url}, qualité ${streamer.quality || "best"})`);
  }

  /** Demande l'arrêt : les derniers segments sont quand même analysés et les clips en attente découpés. */
  stop(reason: string): void {
    if (this.stopping || this.finalized) return;
    this.stopping = true;
    this.stopReason = reason;
    this.sl?.kill("SIGTERM");
    setTimeout(() => {
      if (!this.procEnded) {
        this.sl?.kill("SIGKILL");
        this.ff?.kill("SIGKILL");
      }
    }, 8000).unref();
  }

  /** Attend la fin complète (utilisé à l'arrêt du worker). */
  async waitDone(timeoutMs: number): Promise<void> {
    const until = Date.now() + timeoutMs;
    while (!this.finalized && Date.now() < until) await new Promise((r) => setTimeout(r, 250));
  }

  private async tick(): Promise<void> {
    if (this.busy || this.finalized) return;
    this.busy = true;
    try {
      const ended = this.procEnded;
      const names = (await readdir(this.dir).catch(() => [] as string[])).filter((n) => /^seg_\d{6}\.ts$/.test(n)).sort();
      const last = names.length ? Number(names[names.length - 1]!.slice(4, 10)) : -1;
      // Un segment est complet quand le suivant existe (ou quand la capture est terminée).
      while (this.nextIndex < last || (ended && this.nextIndex <= last)) {
        await this.ingest(this.nextIndex);
        this.nextIndex++;
      }
      this.feedDetector(ended);
      if (ended) this.queue(this.detector.flush());
      await this.cutReady(ended);
      await this.prune();
      if (Date.now() - this.lastDbUpdate > 30_000) {
        this.lastDbUpdate = Date.now();
        await db.recording.update({ where: { id: this.target.recordingId }, data: { durationSec: this.timeline } }).catch(() => {});
      }
      if (ended) await this.finalize();
    } catch (err) {
      log(this.tag(), `erreur dans la boucle d'analyse : ${err instanceof Error ? err.message : err}`);
    } finally {
      this.busy = false;
    }
  }

  private async ingest(index: number): Promise<void> {
    const file = `seg_${String(index).padStart(6, "0")}.ts`;
    const full = path.join(this.dir, file);
    const seg: Segment = { index, file, start: this.timeline, dur: 0, wallEnd: Date.now() / 1000, deleted: false };
    try {
      const st = await stat(full);
      seg.wallEnd = st.mtimeMs / 1000;
      if (st.size < 2000) throw new Error("segment vide");
      const f = await analyzeMedia(full);
      if (f.duration <= 0.2) throw new Error("segment sans durée");
      seg.dur = f.duration;
      const base10 = Math.round(seg.start * 10);
      for (let i = 0; i < f.loudness.length; i++) this.loud[base10 + i] = f.loudness[i]!;
      for (let s = 0; s < f.scenePerSec.length; s++) {
        const g = Math.floor(seg.start + s);
        const v = f.scenePerSec[s];
        if (v !== null && v !== undefined) this.sceneSec[g] = Math.max(this.sceneSec[g] ?? 0, v);
      }
      this.timeline += seg.dur;
    } catch (err) {
      // Segment illisible (coupure réseau, pub filtrée…) : on l'écarte sans arrêter l'enregistrement.
      log(this.tag(), `segment ${file} ignoré : ${err instanceof Error ? err.message : err}`);
      seg.deleted = true;
      await unlink(full).catch(() => {});
    }
    this.segments.push(seg);
  }

  /** Horloge à laquelle la seconde `s` du stream nous est parvenue. */
  private wallAt(s: number): number {
    for (let i = this.segments.length - 1; i >= 0; i--) {
      const seg = this.segments[i]!;
      if (seg.dur > 0 && s >= seg.start - 0.001) return seg.wallEnd - (seg.start + seg.dur - s);
    }
    return Date.now() / 1000;
  }

  private feedDetector(force: boolean): void {
    const lag = env.worker.chatLagSec;
    const chatActive = !!this.chat && this.chat.counter.total > 0;
    const now = Date.now() / 1000;
    while (this.rowsPushed + 1 <= this.timeline + 1e-6) {
      const s = this.rowsPushed;
      const wall = this.wallAt(s);
      // Le chat réagit avec quelques secondes de retard : on attend que ses messages soient arrivés.
      if (chatActive && !force && now < wall + lag + 1.5) break;
      let audio = SILENCE_LUFS;
      for (let i = s * 10; i < s * 10 + 10; i++) {
        const v = this.loud[i];
        if (v !== undefined && v > audio) audio = v;
      }
      const chat = chatActive ? this.chat!.counter.get(Math.floor(wall + lag)) : null;
      this.queue(this.detector.push({ audio, scene: this.sceneSec[s] ?? null, chat }));
      this.rowsPushed++;
    }
    if (this.chat) this.chat.counter.prune(Math.floor(now) - 3600);
  }

  private queue(highlights: Highlight[]): void {
    for (const h of highlights) {
      // Coupes calées sur les silences pour ne pas trancher une phrase.
      const start = Math.max(0, snapToQuiet(this.loud, h.start));
      const end = snapToQuiet(this.loud, h.end, { before: 1, after: 1.5 });
      this.pending.push({ ...h, start, end: Math.max(end, start + 5) });
      log(this.tag(), `moment fort à ${fmt(h.peak)} (score ${h.score}) — son ${h.parts.audio}σ, chat ${h.parts.chat ?? "–"}σ`);
    }
  }

  private async cutReady(force: boolean): Promise<void> {
    for (let i = 0; i < this.pending.length; ) {
      const h = this.pending[i]!;
      if (!force && this.timeline < h.end + CUT_PAD_SEC) {
        i++;
        continue;
      }
      this.pending.splice(i, 1);
      await this.cut(h).catch((err) => log(this.tag(), `découpe impossible : ${err instanceof Error ? err.message : err}`));
    }
  }

  private async cut(h: Highlight): Promise<void> {
    const cs = Math.max(0, h.start - CUT_PAD_SEC);
    const ce = Math.min(this.timeline, h.end + CUT_PAD_SEC);
    const segs = this.segments.filter((s) => !s.deleted && s.dur > 0 && s.start < ce && s.start + s.dur > cs);
    if (segs.length === 0) {
      log(this.tag(), `moment à ${fmt(h.peak)} perdu : segments déjà purgés`);
      return;
    }
    const origin = segs[0]!.start;
    const sourceDur = segs.reduce((n, s) => n + s.dur, 0);
    const { streamer, settings } = this.target;
    const template = settings.template === "FACECAM" && !validFacecam(streamer.facecam) ? "BLUR" : settings.template;

    const clip = await db.clip.create({
      data: {
        userId: this.target.userId,
        recordingId: this.target.recordingId,
        streamerId: streamer.id,
        status: "PROCESSING",
        template,
        originSec: origin,
        peakSec: h.peak + 0.5 - origin,
        startSec: h.start - origin,
        endSec: Math.min(h.end, this.timeline) - origin,
        sourceDur,
        score: h.score,
        signals: { ...h.parts, detector: h.score, raw: h.raw },
        captions: settings.captions,
      },
    });
    const list = path.join(this.dir, `cut_${clip.id}.txt`);
    try {
      await ensureDir(clipDir(clip.id));
      await writeFile(list, segs.map((s) => `file '${s.file}'`).join("\n") + "\n", "utf8");
      await runOk(
        env.bin.ffmpeg,
        ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", list,
          "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy", "-movflags", "+faststart", clipFile(clip.id, "source")],
        { timeoutMs: 120_000 },
      );
      await enqueue("clip.process", { clipId: clip.id });
      this.clipsMade++;
    } catch (err) {
      await db.clip.delete({ where: { id: clip.id } }).catch(() => {});
      await removeDir(clipDir(clip.id));
      throw err;
    } finally {
      await unlink(list).catch(() => {});
    }
  }

  /** Supprime les segments sortis du tampon glissant (sauf ceux qu'un clip en attente utilise encore). */
  private async prune(): Promise<void> {
    const buffer = Math.max(env.worker.bufferSec, this.target.settings.clipMaxSec + 90);
    let keepFrom = this.timeline - buffer;
    for (const h of this.pending) keepFrom = Math.min(keepFrom, h.start - CUT_PAD_SEC);
    for (const seg of this.segments) {
      if (seg.deleted || seg.start + seg.dur >= keepFrom) continue;
      seg.deleted = true;
      await unlink(path.join(this.dir, seg.file)).catch(() => {});
    }
    // La liste elle-même ne garde que la partie utile.
    while (this.segments.length > 2 && this.segments[0]!.deleted && this.segments[1]!.deleted) this.segments.shift();
  }

  private async finalize(): Promise<void> {
    if (this.finalized) return;
    this.finalized = true;
    if (this.timer) clearInterval(this.timer);
    this.chat?.stop();
    await removeDir(this.dir);
    const failed = this.timeline === 0;
    const error = failed ? (this.slErrors.slice(-3).join(" · ") || "Aucune donnée reçue du flux").slice(0, 1000) : null;
    await db.recording
      .update({
        where: { id: this.target.recordingId },
        data: { status: failed ? "FAILED" : "DONE", endedAt: new Date(), durationSec: this.timeline, error },
      })
      .catch(() => {});
    log(
      this.tag(),
      failed
        ? `échec : ${error}`
        : `terminé (${this.stopReason || "fin du flux"}) — ${fmt(this.timeline)} analysés, ${this.clipsMade} clip(s)`,
    );
    this.onEnd?.(this);
  }
}

export function fmt(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h${String(m).padStart(2, "0")}m${String(s % 60).padStart(2, "0")}` : `${m}m${String(s % 60).padStart(2, "0")}`;
}
