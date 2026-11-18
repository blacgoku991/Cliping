import type { Metadata } from "next";
import { Plus, Trash2 } from "lucide-react";
import { disconnectAccount } from "@/app/actions/settings";
import { SocialIcon } from "@/components/brand";
import { ConfirmButton } from "@/components/client";
import { Badge, Card, CardHeader, Notice, PageHeader, buttonClass } from "@/components/ui";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { ago } from "@/lib/format";
import { PLATFORMS } from "@/lib/platforms";
import { redirectUri } from "@/lib/platforms/types";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Comptes" };

const TIPS: Record<string, string[]> = {
  YOUTUBE: [
    "Un compte Google peut gérer plusieurs chaînes : au moment de la connexion, choisis la chaîne voulue. Répète l'opération pour chaque chaîne.",
    "Tant que ton projet Google Cloud est en mode « test », les connexions expirent au bout de 7 jours et YouTube peut forcer les vidéos en privé. Passe l'écran de consentement en production pour lever ces limites.",
  ],
  TIKTOK: [
    "Mode « Brouillon » (par défaut) : la vidéo arrive dans les notifications de ton app TikTok, tu ajoutes un son si tu veux et tu postes. C'est le mode qui marche sans audit de ton application.",
    "La publication directe en public demande que ton application TikTok ait passé l'audit « Content Posting API ». Avant ça, TikTok n'accepte que « Moi uniquement », et seulement sur un compte privé.",
  ],
};

export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const accounts = await db.socialAccount.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { publications: { where: { status: "PUBLISHED" } } } } },
  });

  return (
    <>
      <PageHeader title="Comptes" subtitle="Connecte autant de comptes TikTok et de chaînes YouTube que tu veux. Tu choisis ensuite, clip par clip, où publier." />
      {sp.connected ? <Notice tone="ok" className="mb-5">Compte connecté : {sp.connected}</Notice> : null}
      {sp.error ? <Notice tone="bad" className="mb-5">{sp.error}</Notice> : null}
      {env.encryptionKey.length < 32 ? (
        <Notice tone="warn" className="mb-5">
          <strong>ENCRYPTION_KEY n&apos;est pas définie sur le serveur</strong> (32 caractères minimum). Elle protège les accès à tes comptes : sans elle, aucune connexion ne peut être enregistrée. Génère-la avec <code className="rounded bg-black/30 px-1.5 py-0.5 text-xs">openssl rand -base64 32</code>, ajoute-la au fichier <code className="rounded bg-black/30 px-1.5 py-0.5 text-xs">.env</code> et redémarre.
        </Notice>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        {Object.values(PLATFORMS).map((p) => {
          const mine = accounts.filter((a) => a.platform === p.id);
          const ready = p.configured();
          return (
            <Card key={p.id} className="flex flex-col">
              <CardHeader
                title={<span className="flex items-center gap-2"><SocialIcon platform={p.id} className="size-5" /> {p.label}</span>}
                hint={`${mine.length} compte${mine.length > 1 ? "s" : ""} connecté${mine.length > 1 ? "s" : ""}`}
                action={
                  ready ? (
                    <a href={`/api/oauth/${p.id.toLowerCase()}/start`} className={buttonClass({ variant: "primary", size: "sm" })}>
                      <Plus className="size-3.5" /> Connecter un compte
                    </a>
                  ) : undefined
                }
              />
              {!ready ? (
                <div className="space-y-2 border-b border-line bg-warn/5 px-5 py-4 text-sm leading-relaxed">
                  <p className="font-medium text-warn">À configurer sur le serveur</p>
                  <p className="text-muted">
                    Crée une application développeur {p.id === "YOUTUBE" ? "Google Cloud (API « YouTube Data API v3 »)" : "TikTok for Developers (produits « Login Kit » et « Content Posting API »)"}, puis renseigne{" "}
                    {p.requiredEnv.map((v, i) => <span key={v}>{i ? " et " : ""}<code className="rounded bg-black/30 px-1.5 py-0.5 text-xs">{v}</code></span>)} dans le fichier <code className="rounded bg-black/30 px-1.5 py-0.5 text-xs">.env</code> et redémarre.
                  </p>
                  <p className="text-muted">
                    Adresse de redirection à déclarer : <code className="break-all rounded bg-black/30 px-1.5 py-0.5 text-xs">{redirectUri(env.appUrl, p.id)}</code>
                  </p>
                </div>
              ) : null}
              {mine.length > 0 ? (
                <ul className="divide-y divide-line">
                  {mine.map((a) => (
                    <li key={a.id} className="flex items-center gap-3 px-5 py-3.5">
                      {a.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={a.avatarUrl} alt="" referrerPolicy="no-referrer" className="size-9 shrink-0 rounded-full bg-surface-2 object-cover" />
                      ) : (
                        <div className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-sm font-bold">{a.displayName.slice(0, 1).toUpperCase()}</div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{a.displayName}</p>
                        <p className="truncate text-xs text-faint">
                          {a.handle ? `${a.handle.startsWith("@") ? "" : "@"}${a.handle} · ` : ""}{a._count.publications} publication{a._count.publications > 1 ? "s" : ""} · connecté {ago(a.createdAt)}
                        </p>
                      </div>
                      {a.valid ? <Badge tone="ok">Actif</Badge> : (
                        <a href={`/api/oauth/${p.id.toLowerCase()}/start`} className={buttonClass({ variant: "danger", size: "sm" })}>Reconnecter</a>
                      )}
                      <form action={disconnectAccount}>
                        <input type="hidden" name="id" value={a.id} />
                        <ConfirmButton size="sm" variant="ghost" message={`Déconnecter ${a.displayName} ? Les publications programmées sur ce compte seront supprimées.`} aria-label={`Déconnecter ${a.displayName}`}>
                          <Trash2 className="size-3.5" />
                        </ConfirmButton>
                      </form>
                    </li>
                  ))}
                </ul>
              ) : ready ? (
                <p className="px-5 py-6 text-sm text-muted">Aucun compte pour l&apos;instant.</p>
              ) : null}
              <ul className="mt-auto space-y-2 border-t border-line px-5 py-4 text-xs leading-relaxed text-faint">
                {TIPS[p.id]?.map((t) => <li key={t}>• {t}</li>)}
              </ul>
            </Card>
          );
        })}
      </div>

      <Notice className="mt-6">
        <strong className="text-ink">Avant de publier en masse :</strong> poster la même vidéo sur plusieurs comptes, ou des extraits d&apos;un créateur qui n&apos;autorise pas le clipping, peut faire classer tes comptes en « contenu non original » ou entraîner des retraits pour droits d&apos;auteur. Privilégie les streamers qui ont un programme de clipping, et varie les clips d&apos;un compte à l&apos;autre.
      </Notice>
    </>
  );
}
