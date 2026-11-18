import { stat } from "node:fs/promises";
import { db } from "@/lib/db";
import { rangeResponse } from "@/lib/file-stream";
import { verifyMediaToken } from "@/lib/public-media";
import { clipFile } from "@/lib/storage";

/**
 * Vidéo montée d'une publication, sans session, pour la plateforme qui vient la chercher (Instagram).
 * Accès accordé seulement si : signature valide, lien non expiré, publication en cours d'envoi
 * vers une plateforme qui a besoin de ce lien. Rien d'autre n'est servi (ni source, ni miniature, ni autre clip).
 */
async function serve(req: Request, ctx: { params: Promise<{ token: string; file: string }> }): Promise<Response> {
  const { token, file } = await ctx.params;
  const noStore = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" };
  if (file !== "clip.mp4") return new Response("Introuvable", { status: 404, headers: noStore });

  const check = verifyMediaToken(token);
  if (!check.ok) return new Response(check.reason === "expired" ? "Lien expiré" : "Lien invalide", { status: check.reason === "expired" ? 410 : 403, headers: noStore });

  const pub = await db.publication.findUnique({
    where: { id: check.publicationId },
    select: { clipId: true, status: true, account: { select: { platform: true } } },
  });
  // Seule la vidéo d'un clip est servie ici (une publication de compilation n'a pas de clip).
  if (!pub || !pub.clipId || pub.account.platform !== "INSTAGRAM" || !["UPLOADING", "PROCESSING"].includes(pub.status)) {
    return new Response("Lien expiré", { status: 410, headers: noStore });
  }

  const path = clipFile(pub.clipId, "final");
  const info = await stat(path).catch(() => null);
  if (!info || !info.isFile()) return new Response("Introuvable", { status: 404, headers: noStore });
  const headers = new Headers({ ...noStore, "Content-Type": "video/mp4", "Last-Modified": info.mtime.toUTCString() });
  return rangeResponse(req, path, info.size, headers);
}

export const GET = serve;
export const HEAD = serve;
