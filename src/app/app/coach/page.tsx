import type { Metadata } from "next";
import { BookOpen, ExternalLink, ShieldCheck } from "lucide-react";
import { CoachChecklist } from "@/components/coach/checklist";
import { Card, CardHeader, Notice } from "@/components/ui";
import { parseCoachState } from "@/lib/coach/types";
import { SOURCES, SOURCES_CHECKED_ON } from "@/lib/coach/sources";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Conseils" };

export default async function CoachPage() {
  const user = await requireUser();
  const row = await db.user.findUnique({ where: { id: user.id }, select: { coach: true } });
  const state = parseCoachState(row?.coach);
  const sources = Object.values(SOURCES);

  return (
    <div className="space-y-6">
      <Notice tone="neutral" className="flex gap-3">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ok" />
        <span>
          <strong className="text-ink">Comment lire ce guide.</strong> <span className="text-ok">Officiel</span> : la plateforme le dit dans ses pages d&apos;aide ou ses règles (lien à côté).{" "}
          <span className="text-ink">Usage</span> : pratique courante chez les clippeurs, sans garantie. Personne ne connaît l&apos;algorithme en détail : méfie-toi de quiconque promet un nombre de vues.
        </span>
      </Notice>

      <CoachChecklist initialDone={Object.keys(state.done)} />

      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><BookOpen className="size-4 text-brand" /> Sources</span>}
          hint={`Pages officielles consultées le ${SOURCES_CHECKED_ON}. Les plateformes les modifient souvent : en cas de doute, c'est la page à jour qui fait foi.`}
        />
        <ul className="grid gap-x-6 gap-y-2 px-5 py-4 text-sm md:grid-cols-2">
          {sources.map((s) => (
            <li key={s.id} className="min-w-0">
              <a href={s.url} target="_blank" rel="noreferrer" className="group inline-flex items-start gap-1.5 text-muted hover:text-ink">
                <ExternalLink className="mt-0.5 size-3.5 shrink-0 text-faint group-hover:text-brand" />
                <span>{s.label}</span>
              </a>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
