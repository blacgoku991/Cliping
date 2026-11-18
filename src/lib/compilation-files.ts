import path from "node:path";
import { env } from "./env";

/** Fichiers d'une compilation, dans DATA_DIR/compilations/<id>/. */
export const COMPILATION_FILES = {
  final: "final.mp4",
  thumb: "thumb.jpg",
  captions: "captions.ass",
  thumbAss: "thumb.ass",
} as const;

export type CompilationFileKind = keyof typeof COMPILATION_FILES;

export function compilationDir(id: string): string {
  if (!/^[a-z0-9_-]{6,64}$/i.test(id)) throw new Error(`Identifiant invalide : ${id}`);
  return path.join(env.dataDir, "compilations", id);
}

export function compilationFile(id: string, kind: CompilationFileKind): string {
  return path.join(compilationDir(id), COMPILATION_FILES[kind]);
}
