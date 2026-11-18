import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { enqueue, PermanentError } from "@/lib/jobs";
import { accessTokenFor, PLATFORMS, PlatformRejectedError, ReauthRequiredError } from "@/lib/platforms";
import type { PublishResult } from "@/lib/platforms/types";
import { signedMediaUrl } from "@/lib/public-media";
import { clipFile, fileSize } from "@/lib/storage";
import { log } from "./proc";

async function applyResult(publicationId: string, accountId: string, result: PublishResult): Promise<void> {
  await db.publication.update({
    where: { id: publicationId },
    data: {
      status: result.status,
      externalId: result.externalId,
      externalUrl: result.url,
      note: result.note ?? null,
      error: null,
      publishedAt: result.status === "PUBLISHED" ? new Date() : null,
    },
  });
  if (result.handle) await db.socialAccount.update({ where: { id: accountId }, data: { handle: result.handle } }).catch(() => {});
  if (result.status === "PROCESSING") {
    await enqueue("publish.check", { publicationId }, { runAt: new Date(Date.now() + 60_000), maxAttempts: 10 });
  }
}

/** Les erreurs où réessayer ne changera rien deviennent définitives pour la file de tâches. */
function classify(err: unknown, label: string): unknown {
  if (err instanceof ReauthRequiredError || err instanceof PlatformRejectedError) return new PermanentError(err.message);
  // Erreurs réseau de fetch (« fetch failed », délai dépassé) : message compréhensible, et on réessaiera.
  if (err instanceof TypeError || (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError"))) {
    return new Error(`Connexion à ${label} impossible (problème réseau ou délai dépassé).`);
  }
  return err;
}

/** Envoie un clip sur un compte social. */
export async function publish(publicationId: string): Promise<void> {
  const pub = await db.publication.findUnique({ where: { id: publicationId }, include: { clip: true, account: true } });
  if (!pub || pub.status === "CANCELED" || pub.status === "PUBLISHED") return;
  const adapter = PLATFORMS[pub.account.platform];
  const file = clipFile(pub.clipId, "final");
  const size = await fileSize(file);
  if (!pub.clip.hasFinal || !size) throw new PermanentError("Le clip n'a pas de vidéo montée (supprimée ou montage échoué).");
  if (!adapter.configured()) throw new PermanentError(`${adapter.label} n'est pas configuré sur ce serveur (${adapter.requiredEnv.join(", ")}).`);

  await db.publication.update({ where: { id: publicationId }, data: { status: "UPLOADING", error: null } });
  try {
    const token = await accessTokenFor(pub.account);
    const result = await adapter.publish(token, {
      filePath: file,
      fileSize: size,
      title: pub.title,
      description: pub.description,
      hashtags: pub.clip.hashtags,
      privacy: pub.privacy,
      durationSec: pub.clip.endSec - pub.clip.startSec,
      state: (pub.uploadState as Record<string, unknown> | null) ?? {},
      saveState: async (state) => {
        await db.publication.update({ where: { id: publicationId }, data: { uploadState: state as Prisma.InputJsonValue } });
      },
      mediaUrl: () => signedMediaUrl(publicationId),
    });
    await applyResult(publicationId, pub.accountId, result);
    log("publish", `${adapter.label} · ${pub.account.displayName} : ${result.status === "PUBLISHED" ? "publié" : "en traitement"} ${result.url ?? ""}`);
  } catch (err) {
    // Jeton refusé par la plateforme (accès révoqué) : le compte est signalé « à reconnecter » dans l'interface.
    if (err instanceof ReauthRequiredError) {
      await db.socialAccount.update({ where: { id: pub.accountId }, data: { valid: false } }).catch(() => {});
    }
    throw classify(err, adapter.label);
  }
}

/** Revérifie une publication que la plateforme traitait encore. */
export async function checkPublication(publicationId: string): Promise<void> {
  const pub = await db.publication.findUnique({ where: { id: publicationId }, include: { account: true } });
  if (!pub || pub.status !== "PROCESSING" || !pub.externalId) return;
  const adapter = PLATFORMS[pub.account.platform];
  if (!adapter.checkStatus) return;
  try {
    const token = await accessTokenFor(pub.account);
    const result = await adapter.checkStatus(token, pub.externalId, pub.account.handle);
    if (result.status === "PROCESSING") throw new Error("La plateforme traite encore la vidéo");
    await applyResult(publicationId, pub.accountId, result);
  } catch (err) {
    throw classify(err, adapter.label);
  }
}

/** Reflète dans la publication l'issue d'une tentative ratée. */
export async function markPublicationError(publicationId: string, message: string, willRetry: boolean, checking: boolean): Promise<void> {
  if (checking) {
    // La vidéo est déjà chez la plateforme : si on n'arrive plus à suivre son traitement, on le dit sans la déclarer perdue.
    if (!willRetry) {
      await db.publication
        .updateMany({
          where: { id: publicationId, status: "PROCESSING" },
          data: { status: "PUBLISHED", publishedAt: new Date(), note: "Vidéo envoyée ; la plateforme n'a pas confirmé la fin du traitement. Vérifie sur ton compte." },
        })
        .catch(() => {});
    }
    return;
  }
  await db.publication
    .updateMany({
      where: { id: publicationId, status: { in: ["UPLOADING", "QUEUED"] } },
      data: { status: willRetry ? "QUEUED" : "FAILED", error: message.slice(0, 1000) },
    })
    .catch(() => {});
}
