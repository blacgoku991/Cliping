import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, CalendarRange } from "lucide-react";
import { Card, EmptyState, LinkButton, Notice, PageHeader } from "@/components/ui";
import { ACTIVE_PUB, planAccountsFor } from "@/lib/batch";
import { db } from "@/lib/db";
import { PLATFORMS } from "@/lib/platforms";
import { requireUser } from "@/lib/session";
import { BatchPlanner } from "./batch-planner";

export const metadata: Metadata = { title: "Planifier en lot" };

export default async function PlanPage() {
  const user = await requireUser();
  const [planAccounts, clips, invalidCount] = await Promise.all([
    planAccountsFor(user.id),
    db.clip.findMany({
      where: { userId: user.id, status: "APPROVED", hasFinal: true, publications: { none: { status: { in: [...ACTIVE_PUB] } } } },
      orderBy: [{ score: "desc" }, { createdAt: "desc" }],
      take: 100,
      select: { id: true, title: true, score: true, renderedAt: true, endSec: true, startSec: true, streamer: { select: { displayName: true } }, recording: { select: { author: true } } },
    }),
    db.socialAccount.count({ where: { userId: user.id, valid: false } }),
  ]);

  const header = (
    <PageHeader
      title="Planifier en lot"
      subtitle="Tous tes clips approuvés, répartis sur tous tes comptes : chaque clip part sur un seul compte, avec des publications étalées dans le temps. L'aperçu ci-dessous est prêt ; vérifie-le (ou retouche-le) puis clique sur « Programmer »."
      action={<LinkButton href="/app/queue" size="sm"><ArrowLeft className="size-3.5" /> Publications</LinkButton>}
    />
  );

  if (planAccounts.length === 0 || clips.length === 0) {
    return (
      <>
        {header}
        <Card>
          <EmptyState
            icon={<CalendarRange className="size-6" />}
            title={planAccounts.length === 0 ? "Aucun compte prêt à publier" : "Aucun clip approuvé en attente"}
            action={planAccounts.length === 0 ? <LinkButton href="/app/accounts" variant="primary">Connecter un compte</LinkButton> : <LinkButton href="/app/clips?tab=review" variant="primary">Valider des clips</LinkButton>}
          >
            {planAccounts.length === 0
              ? "Connecte au moins un compte TikTok ou YouTube (ou reconnecte ceux qui ont expiré)."
              : "Le lot se compose des clips approuvés qui ne sont encore programmés sur aucun compte. Approuve des clips dans « Clips »."}
          </EmptyState>
        </Card>
      </>
    );
  }

  return (
    <>
      {header}
      {invalidCount ? (
        <Notice tone="warn" className="mb-5">
          {invalidCount} compte{invalidCount > 1 ? "s" : ""} à reconnecter n&apos;apparai{invalidCount > 1 ? "ssent" : "t"} pas ici. <Link href="/app/accounts" className="font-semibold underline">Comptes</Link>
        </Notice>
      ) : null}
      <BatchPlanner
        clips={clips.map((c) => ({
          id: c.id,
          title: c.title || "Sans titre",
          score: c.score,
          thumb: `/api/media/${c.id}/thumb.jpg?v=${c.renderedAt?.getTime() ?? 0}`,
          source: c.streamer?.displayName ?? c.recording?.author ?? "",
          durationSec: Math.round(c.endSec - c.startSec),
        }))}
        accounts={planAccounts.map(({ account: a, plan }) => {
          const adapter = PLATFORMS[a.platform];
          const privacy = a.defaultPrivacy ?? adapter.defaultPrivacy;
          return {
            id: a.id,
            platform: a.platform,
            displayName: a.displayName,
            privacyLabel: adapter.privacyOptions.find((o) => o.value === privacy)?.label ?? privacy,
            dailyCap: plan.dailyCap,
            existing: plan.existing,
          };
        })}
      />
    </>
  );
}
