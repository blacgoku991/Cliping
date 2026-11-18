import { Sparkles } from "lucide-react";
import { cx } from "../ui";

/** Explique que les suggestions sont génériques sans clé API, et comment activer l'IA. */
export function AiNotice({ available, className, compact = false }: { available: boolean; className?: string; compact?: boolean }) {
  if (available) return null;
  return (
    <div className={cx("flex gap-3 rounded-xl border border-violet/30 bg-violet/10 px-4 py-3 text-sm leading-relaxed", className)}>
      <Sparkles className="mt-0.5 size-4 shrink-0 text-violet" />
      <div className="min-w-0">
        <p className="font-medium text-ink">Suggestions génériques : l&apos;IA n&apos;est pas activée</p>
        {compact ? (
          <p className="mt-0.5 text-muted">Ces textes sont des modèles à adapter. Avec une clé Claude, ils sont rédigés pour ce clip précis.</p>
        ) : (
          <p className="mt-0.5 text-muted">
            Les propositions ci-dessous sont des modèles à adapter, pas des textes écrits pour toi. Pour des propositions sur mesure, ajoute{" "}
            <code className="rounded bg-black/30 px-1.5 py-0.5 text-xs">ANTHROPIC_API_KEY</code> dans le fichier{" "}
            <code className="rounded bg-black/30 px-1.5 py-0.5 text-xs">.env</code> du serveur (clé à créer sur console.anthropic.com), puis redémarre Cliping.
          </p>
        )}
      </div>
    </div>
  );
}

export function SourceBadge({ source }: { source: "ai" | "template" }) {
  return source === "ai" ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand/12 px-2.5 py-0.5 text-xs font-medium text-brand">
      <Sparkles className="size-3" /> Rédigé par l&apos;IA — relis avant de publier
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-xs font-medium text-muted">Modèle générique</span>
  );
}
