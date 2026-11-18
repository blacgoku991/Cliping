import { Logo } from "@/components/brand";
import { LinkButton } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="grid-glow grid min-h-dvh place-items-center px-5 text-center">
      <div>
        <Logo className="justify-center" />
        <h1 className="mt-8 font-display text-5xl uppercase tracking-wide">Page introuvable</h1>
        <p className="mt-3 text-muted">Ce clip ou cette page n&apos;existe pas (ou plus).</p>
        <div className="mt-6"><LinkButton href="/app" variant="primary">Retour à l&apos;app</LinkButton></div>
      </div>
    </div>
  );
}
