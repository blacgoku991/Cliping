import type { Metadata } from "next";
import { AlertTriangle, Compass, ExternalLink, Eye, Lightbulb, Users } from "lucide-react";
import { SocialIcon } from "@/components/brand";
import { Badge, Card, CardHeader, Notice, cx } from "@/components/ui";
import { ACCOUNT_PLAN_EXAMPLE, ALGO_DISCLAIMER, DIFFERENCES, FORMATS, MEMO, SCALE_RULES, type Point } from "@/lib/coach/platforms";
import { SOURCES, shortLabel } from "@/lib/coach/sources";

export const metadata: Metadata = { title: "Plateformes" };

function BasisBadge({ basis }: { basis: Point["basis"] }) {
  return basis === "official" ? (
    <Badge tone="ok" className="px-2 py-0 text-[11px]" title="La plateforme le dit dans ses pages officielles">Officiel</Badge>
  ) : (
    <Badge tone="neutral" className="px-2 py-0 text-[11px]" title="Pratique courante, pas une règle officielle">Usage</Badge>
  );
}

function PointView({ point, className }: { point: Point; className?: string }) {
  return (
    <div className={cx("text-sm leading-relaxed", className)}>
      <p>
        {point.text} <BasisBadge basis={point.basis} />
      </p>
      {point.sources?.length ? (
        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
          {point.sources.map((id) => (
            <a key={id} href={SOURCES[id].url} target="_blank" rel="noreferrer" title={SOURCES[id].label} className="inline-flex items-center gap-1 text-faint hover:text-brand">
              <ExternalLink className="size-3" /> {shortLabel(SOURCES[id])}
            </a>
          ))}
        </p>
      ) : null}
    </div>
  );
}

function Section({ icon, title, tone, points }: { icon: React.ReactNode; title: string; tone: string; points: Point[] }) {
  return (
    <div className="px-5 py-4">
      <h3 className={cx("mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide", tone)}>{icon}{title}</h3>
      <ul className="space-y-3">
        {points.map((p) => (
          <li key={p.text} className="flex gap-2.5">
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-line-strong" />
            <PointView point={p} className="min-w-0 flex-1" />
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function CoachPlatformsPage() {
  return (
    <div className="space-y-8">
      <Notice tone="neutral" className="flex gap-3">
        <Compass className="mt-0.5 size-4 shrink-0 text-brand" />
        <span>{ALGO_DISCLAIMER}</span>
      </Notice>

      <section>
        <h2 className="mb-1 text-lg font-semibold">Comment les plateformes choisissent ce qu&apos;elles montrent</h2>
        <p className="mb-4 text-sm text-muted">Une fiche par format : les signaux annoncés, ce que ça change pour toi, les erreurs qui coûtent cher.</p>
        <div className="grid gap-5 xl:grid-cols-3">
          {FORMATS.map((f) => (
            <Card key={f.id} id={f.id} className="flex scroll-mt-24 flex-col">
              <div className="border-b border-line px-5 py-4">
                <h3 className="flex items-center gap-2 text-base font-semibold">
                  <SocialIcon platform={f.platform} className="size-5 shrink-0" /> {f.title}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{f.summary}</p>
              </div>
              <div className="divide-y divide-line">
                <Section icon={<Eye className="size-3.5" />} title="Ce que la plateforme dit regarder" tone="text-ok" points={f.signals} />
                <Section icon={<Lightbulb className="size-3.5" />} title="Ce que ça change pour toi" tone="text-brand-2" points={f.implications} />
                <Section icon={<AlertTriangle className="size-3.5" />} title="Les erreurs qui coûtent cher" tone="text-bad" points={f.mistakes} />
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-lg font-semibold">Mémo : TikTok et Shorts côte à côte</h2>
        <p className="mb-4 text-sm text-muted">Les « bons paramètres » qui existent vraiment. Quand une plateforme ne donne pas de chiffre, on ne t&apos;en invente pas.</p>
        <Card className="overflow-hidden">
          <div className="hidden grid-cols-[160px_1fr_1fr] border-b border-line bg-surface-2/50 text-xs font-semibold uppercase tracking-wide text-faint md:grid">
            <span className="px-5 py-3" />
            <span className="flex items-center gap-2 px-5 py-3"><SocialIcon platform="TIKTOK" className="size-4" /> TikTok</span>
            <span className="flex items-center gap-2 px-5 py-3"><SocialIcon platform="YOUTUBE" className="size-4" /> YouTube Shorts</span>
          </div>
          <dl className="divide-y divide-line">
            {MEMO.map((row) => (
              <div key={row.label} className="grid gap-x-0 md:grid-cols-[160px_1fr_1fr]">
                <dt className="px-5 pb-1 pt-4 text-sm font-semibold md:py-4">{row.label}</dt>
                <dd className="px-5 py-2 md:py-4">
                  <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-faint md:hidden"><SocialIcon platform="TIKTOK" className="size-3.5" /> TikTok</span>
                  <PointView point={row.tiktok} />
                </dd>
                <dd className="px-5 pb-4 pt-2 md:py-4">
                  <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-faint md:hidden"><SocialIcon platform="YOUTUBE" className="size-3.5" /> Shorts</span>
                  <PointView point={row.shorts} />
                </dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card className="mt-5">
          <CardHeader title="Ce qui diffère entre TikTok et Shorts" />
          <ul className="space-y-3 px-5 py-4">
            {DIFFERENCES.map((p) => (
              <li key={p.text} className="flex gap-2.5"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-brand" /><PointView point={p} className="min-w-0 flex-1" /></li>
            ))}
          </ul>
        </Card>
      </section>

      <section id="multi-comptes" className="scroll-mt-24">
        <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold"><Users className="size-5 text-brand" /> Plusieurs comptes à grande échelle</h2>
        <p className="mb-4 max-w-3xl text-sm text-muted">
          Chaque compte doit avoir sa propre identité : ses clips, son angle, ses horaires. Plusieurs comptes qui publient la même chose ne font que se concurrencer, et risquent d&apos;être écartés pour contenu dupliqué.
        </p>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card>
            <CardHeader title="Les règles" />
            <ul className="space-y-3 px-5 py-4">
              {SCALE_RULES.map((p) => (
                <li key={p.text} className="flex gap-2.5"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-brand" /><PointView point={p} className="min-w-0 flex-1" /></li>
              ))}
            </ul>
          </Card>
          <Card className="self-start">
            <CardHeader title="Exemple de répartition" hint="Illustratif : adapte les angles à tes streamers et les créneaux à tes statistiques." />
            <ul className="divide-y divide-line">
              {ACCOUNT_PLAN_EXAMPLE.map((r) => (
                <li key={r.account} className="grid gap-1 px-5 py-3.5 text-sm sm:grid-cols-[100px_1fr]">
                  <span className="font-semibold">{r.account}</span>
                  <div className="min-w-0 space-y-0.5">
                    <p className="font-medium text-ink">{r.angle}</p>
                    <p className="text-muted">Clips : {r.clips}</p>
                    <p className="text-muted">Horaires : {r.schedule}</p>
                  </div>
                </li>
              ))}
            </ul>
            <p className="border-t border-line px-5 py-3 text-xs leading-relaxed text-faint">
              Prépare la bio et le nom de chaque compte selon son angle dans l&apos;onglet « Bio et profil ».
            </p>
          </Card>
        </div>
      </section>
    </div>
  );
}
