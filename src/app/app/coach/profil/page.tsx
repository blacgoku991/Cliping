import type { Metadata } from "next";
import Link from "next/link";
import type { SocialPlatform } from "@prisma/client";
import { SocialIcon } from "@/components/brand";
import { AiNotice } from "@/components/coach/ai-notice";
import { ProfileKitPanel } from "@/components/coach/profile-kit";
import { Badge, Card, CardHeader } from "@/components/ui";
import { aiAvailable } from "@/lib/coach/ai";
import { LIMITS } from "@/lib/coach/limits";
import { parseCoachState, parseProfileKit, type ProfileKit } from "@/lib/coach/types";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Bio et profil" };

function defaultsFrom(kit: ProfileKit | null, streamers: string[]) {
  return {
    niche: kit?.input.niche ?? "",
    tone: kit?.input.tone ?? "chaleureux",
    streamers: (kit?.input.streamers.length ? kit.input.streamers : streamers).join(", "),
  };
}

export default async function CoachProfilePage() {
  const user = await requireUser();
  const [accounts, streamers, row] = await Promise.all([
    db.socialAccount.findMany({ where: { userId: user.id }, orderBy: [{ platform: "asc" }, { createdAt: "asc" }] }),
    db.streamer.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" }, select: { displayName: true }, take: 6 }),
    db.user.findUnique({ where: { id: user.id }, select: { coach: true } }),
  ]);
  const names = streamers.map((s) => s.displayName);
  const drafts = parseCoachState(row?.coach).drafts;

  return (
    <div className="space-y-6">
      <AiNotice available={aiAvailable()} />
      <p className="max-w-3xl text-sm leading-relaxed text-muted">
        Pour chaque compte, décris ta niche : tu reçois plusieurs bios qui tiennent dans la limite de la plateforme, des idées de nom et quelques conseils. Les propositions restent enregistrées ici. Donne à chaque compte un angle différent : c&apos;est ce qui les rend utiles, et ça évite qu&apos;ils se marchent dessus.
      </p>

      {accounts.length === 0 ? (
        <Card className="px-5 py-4 text-sm text-muted">
          Aucun compte connecté pour l&apos;instant. Tu peux déjà préparer ton profil ci-dessous, puis connecter tes comptes dans{" "}
          <Link href="/app/accounts" className="font-semibold text-brand hover:underline">Comptes</Link>.
        </Card>
      ) : (
        <div className="space-y-5">
          {accounts.map((a) => {
            const kit = parseProfileKit(a.profileKit);
            return (
              <Card key={a.id}>
                <CardHeader
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      <SocialIcon platform={a.platform} className="size-5" /> {a.displayName}
                      {a.handle ? <span className="text-sm font-normal text-muted">@{a.handle.replace(/^@/, "")}</span> : null}
                      {!a.valid ? <Badge tone="warn">à reconnecter</Badge> : null}
                    </span>
                  }
                  hint={`${LIMITS[a.platform].label} · bio ${LIMITS[a.platform].bio.max} caractères max.`}
                />
                <div className="p-5">
                  <ProfileKitPanel target={`account:${a.id}`} platform={a.platform} kit={kit} defaults={defaultsFrom(kit, names)} />
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <div>
        <h2 className="mb-1 text-lg font-semibold">Préparer un nouveau compte</h2>
        <p className="mb-4 text-sm text-muted">Pour un compte que tu n&apos;as pas encore créé ou connecté.</p>
        <div className="grid gap-5 xl:grid-cols-2">
          {(["TIKTOK", "YOUTUBE"] as SocialPlatform[]).map((p) => {
            const kit = drafts[p] ?? null;
            return (
              <Card key={p}>
                <CardHeader
                  title={<span className="flex items-center gap-2"><SocialIcon platform={p} className="size-5" /> Nouveau compte {LIMITS[p].label}</span>}
                  hint={`Bio ${LIMITS[p].bio.max} caractères max. · nom d'utilisateur ${LIMITS[p].username.min}-${LIMITS[p].username.max}`}
                />
                <div className="p-5">
                  <ProfileKitPanel target={`draft:${p}`} platform={p} kit={kit} defaults={defaultsFrom(kit, names)} />
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      <p className="text-xs leading-relaxed text-faint">
        Limites vérifiées le 18 novembre 2026. Le @handle YouTube (3 à 30 caractères) et le titre YouTube (100) viennent des pages d&apos;aide officielles ; la bio TikTok (80), le nom TikTok (30) et la description de chaîne YouTube (1 000) sont les limites affichées dans les applications. Si l&apos;app affiche autre chose, c&apos;est elle qui a raison.
      </p>
    </div>
  );
}
