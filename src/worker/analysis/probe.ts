import { env } from "@/lib/env";
import { runOk } from "../proc";

export interface MediaInfo {
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  hasVideo: boolean;
}

function ratio(v: string | undefined): number {
  if (!v) return 0;
  const [a, b] = v.split("/").map(Number);
  if (!a || !Number.isFinite(a)) return 0;
  return b && Number.isFinite(b) ? a / b : a;
}

export async function probe(file: string): Promise<MediaInfo> {
  const { stdout } = await runOk(
    env.bin.ffprobe,
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file],
    { timeoutMs: 60_000 },
  );
  const data = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{
      codec_type?: string;
      width?: number;
      height?: number;
      avg_frame_rate?: string;
      r_frame_rate?: string;
      duration?: string;
    }>;
  };
  const video = data.streams?.find((s) => s.codec_type === "video");
  const audio = data.streams?.find((s) => s.codec_type === "audio");
  const duration = Number(data.format?.duration ?? video?.duration ?? audio?.duration ?? 0);
  return {
    duration: Number.isFinite(duration) ? duration : 0,
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    fps: ratio(video?.avg_frame_rate) || ratio(video?.r_frame_rate) || 30,
    hasAudio: !!audio,
    hasVideo: !!video,
  };
}

/** Dernière image clé située à `t` secondes ou avant (pour couper sans réencoder). null si introuvable. */
export async function keyframeAtOrBefore(file: string, t: number, lookback = 15): Promise<number | null> {
  if (t <= 0) return 0;
  const from = Math.max(0, t - lookback);
  const { stdout } = await runOk(
    env.bin.ffprobe,
    [
      "-v", "error",
      "-select_streams", "v:0",
      "-skip_frame", "nokey",
      "-show_entries", "frame=pts_time",
      "-of", "csv=p=0",
      "-read_intervals", `${from.toFixed(3)}%${(t + 0.05).toFixed(3)}`,
      file,
    ],
    { timeoutMs: 60_000 },
  );
  let best: number | null = null;
  for (const line of stdout.split("\n")) {
    const v = Number(line.trim().split(",")[0]);
    if (Number.isFinite(v) && v <= t + 0.001 && (best === null || v > best)) best = v;
  }
  return best;
}
