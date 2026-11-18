import { stat } from "node:fs/promises";
import { db } from "@/lib/db";
import { fileStream } from "@/lib/file-stream";
import { getUser } from "@/lib/session";
import { clipFile, type ClipFileKind } from "@/lib/storage";

const FILES: Record<string, { kind: ClipFileKind; type: string }> = {
  "final.mp4": { kind: "final", type: "video/mp4" },
  "source.mp4": { kind: "source", type: "video/mp4" },
  "thumb.jpg": { kind: "thumb", type: "image/jpeg" },
};

/** Sert les fichiers d'un clip à son propriétaire, avec prise en charge de Range (lecture/avance rapide). */
export async function GET(req: Request, ctx: { params: Promise<{ clipId: string; file: string }> }): Promise<Response> {
  const { clipId, file } = await ctx.params;
  const spec = FILES[file];
  if (!spec || !/^[a-z0-9]{6,64}$/i.test(clipId)) return new Response("Introuvable", { status: 404 });

  const user = await getUser();
  if (!user) return new Response("Non connecté", { status: 401 });
  const clip = await db.clip.findFirst({ where: { id: clipId, userId: user.id }, select: { id: true, title: true } });
  if (!clip) return new Response("Introuvable", { status: 404 });

  const path = clipFile(clipId, spec.kind);
  const info = await stat(path).catch(() => null);
  if (!info || !info.isFile()) return new Response("Introuvable", { status: 404 });

  const size = info.size;
  const headers = new Headers({
    "Content-Type": spec.type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=0, must-revalidate",
    "Last-Modified": info.mtime.toUTCString(),
  });
  const url = new URL(req.url);
  if (url.searchParams.has("download")) {
    const name = (clip.title || "clip").normalize("NFD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "clip";
    headers.set("Content-Disposition", `attachment; filename="${name}.${file.split(".").pop()}"`);
  }

  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(end, size - 1);
    if (start > end || start >= size) {
      headers.set("Content-Range", `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    headers.set("Content-Length", String(end - start + 1));
    return new Response(fileStream(path, { start, end }), { status: 206, headers });
  }
  headers.set("Content-Length", String(size));
  return new Response(fileStream(path), { status: 200, headers });
}
