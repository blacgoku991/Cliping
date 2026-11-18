import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { BarChart3, ExternalLink, Info } from "lucide-react";
import { SocialIcon } from "@/components/brand";
import { ACCENT, Delta, OTHER_COLOR, RatioBars, SERIES_COLORS, Sparkline, StatTile, ValueBars } from "@/components/stats/charts";
import { LineChart, type LineSeries } from "@/components/stats/line-chart";
import { TimeZoneSync } from "@/components/stats/timezone-sync";
import { LocalTime } from "@/components/client";
import { Card, CardHeader, cx, EmptyState, LinkButton, Notice, PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { ago } from "@/lib/format";
import { requireUser } from "@/lib/session";
import { TZ_COOKIE } from "@/lib/stats/hints";
import { compact, isValidTimeZone, MIN_SAMPLE, ratioLabel, type DimensionResult } from "@/lib/stats/math";
import { performanceReport } from "@/lib/stats/report";

export const metadata: Metadata = { title: "Performances" };

const PERIODS = [
  { key: "7", label: "7 j", days: 7 },
  { key: "30", label: "30 j", days: 30 },
  { key: "90", label: "90 j", days: 90 },
  { key: "all", label: "Tout", days: null },
] as const;

function href(period: string, account: string | null): string {
  const q = new URLSearchParams();
  if (period !== "all") q.set("periode", period);
  if (account) q.set("compte", account);
  const s = q.toString();
  return `/app/stats${s ? `?${s}` : ""}`;
}

function Chip({ active, href: to, children }: { active: boolean; href: string; children: React.ReactNode }) {
  return (
    <Link
      href={to}
      aria-current={active ? "true" : undefined}
      className={cx(
        "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition",
        active ? "bg-surface-2 text-ink ring-1 ring-line-strong" : "text-muted hover:bg-surface-2 hover:text-ink",
      )}
    >
      {children}
    </Link>
  );
}

function Insight({ title, hint, result, children }: { title: string; hint: string; result: DimensionResult; children?: React.ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} hint={hint} />
      <div className="px-5 py-4">
        {result.groups.length === 0 ? (
          <p className="text-sm text-faint">Pas encore de publication comparable.</p>
        ) : (
          <>
            {result.conclusive && result.best && result.worst ? (
              <p className="mb-4 text-sm leading-relaxed">
                <strong>{result.best.label}</strong> : {ratioLabel(result.best.medianRatio!)} par rapport à la médiane du compte
                <span className="text-muted"> ({result.best.n} publications)</span>
                {result.worst !== result.best ? (
                  <>
                    , contre {ratioLabel(result.worst.medianRatio!)} pour <strong>{result.worst.label}</strong>
                    <span className="text-muted"> ({result.worst.n})</span>
                  </>
                ) : null}
                .
              </p>
            ) : (
              <p className="mb-4 text-sm text-muted">
                Pas encore assez de données pour comparer : il faut au moins deux groupes de {MIN_SAMPLE} publications.
              </p>
            )}
            <RatioBars groups={result.groups} minSample={MIN_SAMPLE} />
            <p className="mt-3 flex items-center gap-2 text-xs text-faint">
              <span className="inline-block h-3 w-px bg-ink/40" aria-hidden /> médiane habituelle du compte
            </p>
          </>
        )}
        {children}
      </div>
    </Card>
  );
}

export default async function StatsPage({ searchParams }: { searchParams: Promise<{ periode?: string; compte?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const period = PERIODS.find((p) => p.key === sp.periode) ?? PERIODS[3];
  const tzCookie = (await cookies()).get(TZ_COOKIE)?.value ?? null;
  const timeZone = isValidTimeZone(tzCookie) ? tzCookie : null;

  const accountsAll = await db.socialAccount.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" }, select: { id: true, platform: true, displayName: true } });
  const accountId = accountsAll.some((a) => a.id === sp.compte) ? sp.compte! : null;
  const [report, publishedEver, lastStat] = await Promise.all([
    performanceReport(user.id, { timeZone: timeZone ?? "UTC", sinceDays: period.days, accountId }),
    db.publication.count({ where: { userId: user.id, status: "PUBLISHED" } }),
    db.publicationStat.findFirst({ where: { userId: user.id }, orderBy: { at: "desc" }, select: { at: true } }),
  ]);
  const { totals, untracked, insights } = report;

  // Couleur fixée par compte (ordre de connexion), jamais par classement ; au-delà de 4 comptes : « autres ».
  const colorOf = new Map(accountsAll.map((a, i) => [a.id, SERIES_COLORS[i] ?? OTHER_COLOR]));
  const series: LineSeries[] = [];
  const others: number[] = [];
  for (const s of report.timeline) {
    const color = colorOf.get(s.accountId) ?? OTHER_COLOR;
    if (color === OTHER_COLOR) s.values.forEach((v, i) => (others[i] = (others[i] ?? 0) + v));
    else series.push({ label: s.label, color, values: s.values });
  }
  if (others.length) series.push({ label: "Autres comptes", color: OTHER_COLOR, values: others });
  if (series.length === 1) series[0]!.color = ACCENT;

  const filters = (
    <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex flex-wrap gap-1 rounded-xl border border-line bg-surface p-1" role="group" aria-label="Période">
        {PERIODS.map((p) => (
          <Chip key={p.key} active={p === period} href={href(p.key, accountId)}>{p.label}</Chip>
        ))}
      </div>
      {accountsAll.length > 1 ? (
        <div className="flex flex-wrap gap-1 rounded-xl border border-line bg-surface p-1" role="group" aria-label="Compte">
          <Chip active={!accountId} href={href(period.key, null)}>Tous les comptes</Chip>
          {accountsAll.map((a) => (
            <Chip key={a.id} active={a.id === accountId} href={href(period.key, a.id)}>
              <SocialIcon platform={a.platform} className="size-3.5" />
              <span className="max-w-32 truncate">{a.displayName}</span>
            </Chip>
          ))}
        </div>
      ) : null}
    </div>
  );

  const notices = (
    <div className="mb-6 space-y-3 empty:hidden">
      {untracked.draft > 0 ? (
        <Notice>
          <strong>{untracked.draft} publication{untracked.draft > 1 ? "s" : ""} TikTok en brouillon</strong> ne {untracked.draft > 1 ? "peuvent" : "peut"} pas être
          suivie{untracked.draft > 1 ? "s" : ""} : un brouillon n&apos;a pas d&apos;identifiant public, et la vidéo que tu postes ensuite depuis l&apos;app n&apos;est
          reliée à rien de ce que TikTok nous renvoie. Elles ne comptent pas dans les chiffres ci-dessous (plutôt que d&apos;afficher des zéros).
        </Notice>
      ) : null}
      {untracked.unsupported > 0 ? (
        <Notice>
          <strong>{untracked.unsupported} publication{untracked.unsupported > 1 ? "s" : ""} Instagram</strong> ne {untracked.unsupported > 1 ? "sont" : "est"} pas
          suivie{untracked.unsupported > 1 ? "s" : ""} : Cliping ne relève pas encore les statistiques des Reels. Regarde-les dans l&apos;app Instagram ; elles ne comptent
          pas dans les chiffres ci-dessous.
        </Notice>
      ) : null}
      {report.accounts.some((a) => a.missingScope) ? (
        <Notice tone="warn">
          {report.accounts.filter((a) => a.missingScope).map((a) => a.displayName).join(", ")} : TikTok ne nous a pas autorisés à lire les vues de tes vidéos
          (autorisation « video.list »). Reconnecte le compte depuis <Link href="/app/accounts" className="underline">Comptes</Link> quand l&apos;app le
          proposera ; en attendant, ses publications ne sont pas suivies.
        </Notice>
      ) : null}
      {report.accounts.some((a) => !a.valid) ? (
        <Notice tone="warn">
          Compte à reconnecter ({report.accounts.filter((a) => !a.valid).map((a) => a.displayName).join(", ")}) : ses relevés sont en pause.
        </Notice>
      ) : null}
    </div>
  );

  const header = (
    <>
      <TimeZoneSync known={timeZone} />
      <PageHeader
        title="Performances"
        subtitle="Ce que deviennent tes clips une fois en ligne, d'après tes propres comptes. Relevés toutes les 15 min au début, puis de plus en plus espacés."
        action={lastStat ? <span className="text-xs text-faint">Dernier relevé {ago(lastStat.at)}</span> : undefined}
      />
    </>
  );

  if (totals.tracked === 0) {
    const reason =
      accountsAll.length === 0
        ? { title: "Aucun compte connecté", text: "Connecte un compte TikTok ou YouTube, publie des clips : leurs vues apparaîtront ici.", action: <LinkButton href="/app/accounts" variant="primary">Connecter un compte</LinkButton> }
        : publishedEver === 0
          ? { title: "Rien de publié pour l'instant", text: "Dès qu'un clip est en ligne, le bot relève ses vues, j'aime et commentaires, et cette page se remplit.", action: <LinkButton href="/app/clips" variant="primary">Voir mes clips</LinkButton> }
          : untracked.pending > 0
            ? { title: "Premier relevé en cours", text: "Tes publications sont en ligne : le bot relève leurs chiffres dans les minutes qui suivent. Reviens un peu plus tard.", action: null }
            : { title: "Aucune publication suivie sur cette période", text: "Change de période ou de compte, ou publie de nouveaux clips en mode public.", action: period.days ? <LinkButton href={href("all", accountId)}>Tout afficher</LinkButton> : null };
    return (
      <>
        {header}
        {publishedEver > 0 ? filters : null}
        {notices}
        <Card>
          <EmptyState icon={<BarChart3 className="size-6" />} title={reason.title} action={reason.action ?? undefined}>
            {reason.text}
          </EmptyState>
        </Card>
      </>
    );
  }

  const tzLabel = timeZone ?? "UTC (fuseau du navigateur en cours de détection)";

  return (
    <>
      {header}
      {filters}
      {notices}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Vues" value={compact(totals.views)} hint={<Delta current={report.gained.last7} previous={report.gained.prev7} period="sur 7 j" />} />
        <StatTile label="J'aime" value={compact(totals.likes)} hint={totals.views > 0 ? `${((totals.likes / totals.views) * 100).toFixed(1).replace(".", ",")} % des vues` : undefined} />
        <StatTile label="Commentaires" value={compact(totals.comments)} hint={`${totals.tracked} publication${totals.tracked > 1 ? "s" : ""} suivie${totals.tracked > 1 ? "s" : ""}`} />
        <StatTile label="Partages" value={totals.shares === null ? "—" : compact(totals.shares)} hint="TikTok seulement : YouTube ne les donne pas" />
      </div>

      <Card className="mt-6">
        <CardHeader title="Vues cumulées" hint={series.length > 1 ? "Par compte, en fin de journée" : "En fin de journée"} />
        <div className="px-3 pb-3 pt-4 sm:px-5">
          {series.length > 1 ? (
            <ul className="mb-3 flex flex-wrap gap-x-5 gap-y-1.5 px-2 text-xs sm:px-0">
              {series.map((s) => (
                <li key={s.label} className="flex items-center gap-2">
                  <span className="h-0.5 w-4 rounded-full" style={{ background: s.color }} />
                  <span className="text-muted">{s.label}</span>
                  <strong className="tabular-nums">{compact(s.values[s.values.length - 1])}</strong>
                </li>
              ))}
            </ul>
          ) : null}
          <LineChart days={report.days} series={series} ariaLabel="Vues cumulées par jour" />
          <details className="mt-2 px-2 text-xs sm:px-0">
            <summary className="cursor-pointer text-faint hover:text-ink">Voir les chiffres</summary>
            <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-line">
              <table className="w-full text-left tabular-nums">
                <thead className="sticky top-0 bg-surface-2 text-muted">
                  <tr>
                    <th className="px-3 py-1.5 font-medium">Jour</th>
                    {series.map((s) => <th key={s.label} className="px-3 py-1.5 text-right font-medium">{s.label}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {report.days.map((d, i) => (
                    <tr key={d}>
                      <td className="px-3 py-1"><LocalTime iso={d} /></td>
                      {series.map((s) => <td key={s.label} className="px-3 py-1 text-right">{(s.values[i] ?? 0).toLocaleString("fr-FR")}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      </Card>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Comparaison des comptes" hint="Vues médianes d'une publication 24 h après sa mise en ligne" />
          <div className="px-5 py-4">
            <ValueBars
              rows={report.accounts
                .filter((a) => a.published > 0)
                .map((a) => ({
                  key: a.id,
                  color: report.accounts.filter((x) => x.published > 0).length > 1 ? (colorOf.get(a.id) ?? OTHER_COLOR) : ACCENT,
                  label: (
                    <span className="flex items-center gap-1.5">
                      <SocialIcon platform={a.platform} className="size-3.5 shrink-0" />
                      <span className="truncate">{a.displayName}</span>
                    </span>
                  ),
                  value: a.n24h > 0 ? a.median24h : null,
                  note:
                    a.n24h > 0
                      ? `${a.n24h} pub. · ${compact(a.views)} vues au total`
                      : a.missingScope
                        ? "non suivi (autorisation)"
                        : a.tracked > 0
                          ? "pas encore 24 h de recul"
                          : "aucune publication suivie",
                }))}
            />
            <p className="mt-4 text-xs leading-relaxed text-faint">
              On compare à âge égal (24 h) pour ne pas avantager les vieilles vidéos ; la médiane évite qu&apos;un seul clip viral fausse tout.
            </p>
          </div>
        </Card>

        <Card>
          <CardHeader title="Meilleurs clips" hint="Par vues, sur la période" />
          <ol className="divide-y divide-line">
            {report.top.map((p, i) => (
              <li key={p.id} className="flex items-center gap-3 px-5 py-2.5">
                <span className="w-4 shrink-0 text-right text-xs tabular-nums text-faint">{i + 1}</span>
                <Link href={`/app/clips/${p.clipId}`} className="block aspect-[9/16] w-8 shrink-0 overflow-hidden rounded-md bg-surface-2">
                  {p.hasThumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/media/${p.clipId}/thumb.jpg?v=${p.thumbVersion}`} alt="" loading="lazy" className="size-full object-cover" />
                  ) : null}
                </Link>
                <div className="min-w-0 flex-1">
                  <Link href={`/app/clips/${p.clipId}`} className="block truncate text-sm font-medium hover:underline">{p.title}</Link>
                  <p className="flex items-center gap-1.5 truncate text-xs text-muted">
                    <SocialIcon platform={p.platform} className="size-3 shrink-0" /> {p.accountName}
                  </p>
                </div>
                <div className="shrink-0 text-right text-xs tabular-nums">
                  <p className="text-sm font-semibold">{compact(p.views)}</p>
                  <p className="text-faint">♥ {compact(p.likes)} · 💬 {compact(p.comments)}</p>
                </div>
                {p.externalUrl ? (
                  <a href={p.externalUrl} target="_blank" rel="noreferrer" className="hidden shrink-0 rounded-lg p-1.5 text-faint hover:bg-surface-2 hover:text-ink sm:block" aria-label="Voir sur la plateforme">
                    <ExternalLink className="size-3.5" />
                  </a>
                ) : null}
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Démarrage des dernières publications" hint="Les 48 premières heures, et les vues à 1 h, 6 h et 24 h comparées à la médiane du compte au même âge" />
        <ul className="divide-y divide-line">
          {report.launches.map((p) => (
            <li key={p.id} className="grid gap-3 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-5">
              <div className="min-w-0">
                <Link href={`/app/clips/${p.clipId}`} className="block truncate text-sm font-medium hover:underline">{p.title}</Link>
                <p className="flex items-center gap-1.5 text-xs text-muted">
                  <SocialIcon platform={p.platform} className="size-3 shrink-0" />
                  <span className="truncate">{p.accountName}</span>
                  <span className="text-faint">· <LocalTime iso={p.publishedAt} /></span>
                </p>
              </div>
              <Sparkline points={p.curve} className="hidden sm:block" />
              <dl className="grid grid-cols-3 gap-2 text-xs sm:w-72">
                {p.milestones.map((m) => {
                  const ratio = m.views !== null && m.accountMedian ? m.views / m.accountMedian : null;
                  return (
                    <div key={m.hours} className="rounded-lg bg-surface-2 px-2 py-1.5">
                      <dt className="text-faint">à {m.hours} h</dt>
                      <dd className="font-semibold tabular-nums">{m.views === null ? (p.ageHours < m.hours ? "bientôt" : "—") : compact(m.views)}</dd>
                      {ratio !== null ? (
                        <dd className={cx("tabular-nums", ratio >= 1.1 ? "text-ok" : ratio <= 0.9 ? "text-bad" : "text-muted")}>
                          {ratio >= 1.1 ? "▲ " : ratio <= 0.9 ? "▼ " : ""}
                          {ratioLabel(ratio)}
                        </dd>
                      ) : null}
                    </div>
                  );
                })}
              </dl>
            </li>
          ))}
        </ul>
      </Card>

      <section className="mt-10">
        <h2 className="text-xl font-bold tracking-tight">Ce qui marche chez toi</h2>
        <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted">
          Tirés de tes {insights.sample} publication{insights.sample > 1 ? "s" : ""} qui ont 24 h de recul
          {accountId ? " sur ce compte" : ""}. Chaque clip est comparé à la médiane de son compte (« +40 % » = 40 % de vues de plus que d&apos;habitude à
          24 h), pour qu&apos;un gros compte n&apos;écrase pas les autres. On ne conclut qu&apos;à partir de {MIN_SAMPLE} publications par groupe.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Insight title="Streamers" hint="Quels créateurs donnent les clips qui tiennent le mieux" result={insights.streamers} />
          <Insight title="Durée du clip" hint="Longueur du clip monté" result={insights.durations} />
          <Insight title="Heure de publication" hint={`Dans ton fuseau : ${tzLabel}`} result={insights.hours} />
          <Insight title="Style d'accroche" hint="Classé par règles simples sur le texte d'accroche du clip" result={insights.hooks} />
        </div>
        <p className="mt-4 flex gap-2 text-xs leading-relaxed text-faint">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          Ce sont des constats sur tes chiffres, pas des lois : un créneau peut sembler meilleur parce que tu y as posté tes meilleurs clips. Sers-t&apos;en
          pour tester, et regarde si l&apos;écart tient avec plus de publications.
        </p>
      </section>
    </>
  );
}
