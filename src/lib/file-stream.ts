import { createReadStream } from "node:fs";

/**
 * Lit un fichier sous forme de flux web. Écrit à la main plutôt qu'avec Readable.toWeb() :
 * un lecteur vidéo interrompt sans cesse ses requêtes (avance rapide, changement de page), et il faut
 * alors arrêter proprement la lecture du fichier au lieu de pousser des données dans un flux déjà fermé.
 */
export function fileStream(path: string, range?: { start: number; end: number }): ReadableStream<Uint8Array> {
  const source = createReadStream(path, range);
  let closed = false;
  const finish = () => {
    closed = true;
    source.destroy();
  };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      source.on("data", (chunk) => {
        if (closed) return;
        try {
          controller.enqueue(chunk as Uint8Array);
          if ((controller.desiredSize ?? 0) <= 0) source.pause();
        } catch {
          finish();
        }
      });
      source.on("end", () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* le client est déjà parti */
        }
      });
      source.on("error", (err) => {
        if (closed) return;
        finish();
        try {
          controller.error(err);
        } catch {
          /* le client est déjà parti */
        }
      });
    },
    pull() {
      if (!closed) source.resume();
    },
    cancel() {
      finish();
    },
  });
}

/** Réponse 200 ou 206 (en-tête Range) pour un fichier, avec les en-têtes déjà préparés. */
export function rangeResponse(req: Request, path: string, size: number, headers: Headers): Response {
  headers.set("Accept-Ranges", "bytes");
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
    return new Response(req.method === "HEAD" ? null : fileStream(path, { start, end }), { status: 206, headers });
  }
  headers.set("Content-Length", String(size));
  return new Response(req.method === "HEAD" ? null : fileStream(path), { status: 200, headers });
}
