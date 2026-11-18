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

