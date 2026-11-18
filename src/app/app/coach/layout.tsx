import { CoachTabs } from "@/components/coach/tabs";
import { PageHeader } from "@/components/ui";

export default function CoachLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader
        title="Conseils"
        subtitle="Ce qui aide vraiment un compte de clips à grandir, d'après les recommandations des plateformes et les pratiques courantes. Aucune recette miracle : des bases solides, appliquées avec régularité."
      />
      <CoachTabs />
      {children}
    </>
  );
}
