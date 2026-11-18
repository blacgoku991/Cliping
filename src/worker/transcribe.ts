import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { env } from "@/lib/env";
import { log, runOk } from "./proc";
import type { Word } from "./render/captions";

export function transcriptionEnabled(): boolean {
  return !!env.transcribe.apiUrl && !!env.transcribe.apiKey;
}

interface VerboseTranscription {
  text?: string;
  words?: Array<{ word: string; start: number; end: number }>;
  segments?: Array<{ text: string; start: number; end: number }>;
}

/**
 * Transcrit l'audio d'un fichier via une API compatible OpenAI (`/audio/transcriptions`) :
 * OpenAI (whisper-1), Groq (whisper-large-v3-turbo), ou un serveur Whisper auto-hébergé.
 * Renvoie les mots horodatés, relatifs au début du fichier. null si la transcription est désactivée.
 */
export async function transcribe(file: string, language: string): Promise<Word[] | null> {
  if (!transcriptionEnabled()) return null;
  const tmp = await mkdtemp(path.join(os.tmpdir(), "cliping-tr-"));
  try {
    const audio = path.join(tmp, "audio.m4a");
    // Mono 16 kHz : c'est ce qu'attend Whisper, et le fichier reste minuscule.
    await runOk(
      env.bin.ffmpeg,
      ["-hide_banner", "-loglevel", "error", "-y", "-i", file, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "aac", "-b:a", "48k", audio],
      { timeoutMs: 5 * 60_000 },
    );
    const form = new FormData();
    form.append("file", new Blob([await readFile(audio)], { type: "audio/mp4" }), "audio.m4a");
    form.append("model", env.transcribe.model);
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
    if (language) form.append("language", language);

    const res = await fetch(`${env.transcribe.apiUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.transcribe.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      throw new Error(`Transcription refusée (HTTP ${res.status}) : ${body}`);
    }
    return wordsFromResponse((await res.json()) as VerboseTranscription);
  } catch (err) {
    // Un clip sans sous-titres vaut mieux que pas de clip du tout.
    log("transcribe", `échec, le clip sera monté sans sous-titres : ${err instanceof Error ? err.message : err}`);
    return null;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

export function wordsFromResponse(data: VerboseTranscription): Word[] {
  if (data.words?.length) {
    return data.words
      .map((x) => ({ w: x.word.trim(), s: x.start, e: x.end }))
      .filter((x) => x.w && Number.isFinite(x.s) && Number.isFinite(x.e));
  }
  // Fournisseur sans horodatage par mot : on répartit les mots sur la durée de chaque segment.
  const out: Word[] = [];
  for (const seg of data.segments ?? []) {
    const tokens = seg.text.trim().split(/\s+/).filter(Boolean);
    const total = tokens.reduce((n, t) => n + t.length, 0) || 1;
    let t = seg.start;
    for (const tok of tokens) {
      const d = ((seg.end - seg.start) * tok.length) / total;
      out.push({ w: tok, s: t, e: t + d });
      t += d;
    }
  }
  return out;
}

export function wordsToText(words: Word[], from = -Infinity, to = Infinity): string {
  return words
    .filter((x) => x.e > from && x.s < to)
    .map((x) => x.w)
    .join(" ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .trim();
}
