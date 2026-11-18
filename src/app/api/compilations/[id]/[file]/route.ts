import { stat } from "node:fs/promises";
import { compilationFile, type CompilationFileKind } from "@/lib/compilation-files";
import { db } from "@/lib/db";
import { fileStream } from "@/lib/file-stream";
import { getUser } from "@/lib/session";

const FILES: Record<string, { kind: CompilationFileKind; type: string }> = {
  "final.mp4": { kind: "final", type: "video/mp4" },
  "thumb.jpg": { kind: "thumb", type: "image/jpeg" },
};

/** Sert la vidéo et la miniature d'une compilation à son propriétaire (Range pris en charge pour la lecture). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string; file: string }> }): Promise<Response> {
  const { id, file } = await ctx.params;
  const spec = FILES[file];
  if (!spec || !/^[a-z0-9]{6,64}$/i.test(id)) return new Response("Introuvable", { status: 404 });

  const user = await getUser();
  if (!user) return new Response("Non connecté", { status: 401 });
  const comp = await db.compilation.findFirst({ where: { id, userId: user.id }, select: { id: true, title: true } });
  if (!comp) return new Response("Introuvable", { status: 404 });

  const path = compilationFile(id, spec.kind);
  const info = await stat(path).catch(() => null);
  if (!info || !info.isFile()) return new Response("Introuvable", { status: 404 });

  const size = info.size;
  const headers = new Headers({
    "Content-Type": spec.type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=0, must-revalidate",
    "Last-Modified": info.mtime.toUTCString(),
  });
  if (new URL(req.url).searchParams.has("download")) {
    const name = (comp.title || "compilation").normalize("NFD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || "compilation";
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
