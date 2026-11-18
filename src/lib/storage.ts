import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { env } from "./env";

/** Les identifiants viennent de la base (cuid), mais on refuse quand même tout ce qui ressemble à un chemin. */
function safeId(id: string): string {
  if (!/^[a-z0-9_-]{6,64}$/i.test(id)) throw new Error(`Identifiant invalide : ${id}`);
  return id;
}

export const CLIP_FILES = {
  source: "source.mp4",
  final: "final.mp4",
  thumb: "thumb.jpg",
  captions: "captions.ass",
} as const;

export type ClipFileKind = keyof typeof CLIP_FILES;

export function recordingDir(recordingId: string): string {
  return path.join(env.dataDir, "recordings", safeId(recordingId));
}

export function clipDir(clipId: string): string {
  return path.join(env.dataDir, "clips", safeId(clipId));
}

export function clipFile(clipId: string, kind: ClipFileKind): string {
  return path.join(clipDir(clipId), CLIP_FILES[kind]);
}

export async function ensureDir(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function removeDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

export async function fileSize(file: string): Promise<number | null> {
  try {
    return (await stat(file)).size;
  } catch {
    return null;
  }
}
