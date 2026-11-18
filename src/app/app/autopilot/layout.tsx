import { AutomationTabs } from "@/components/automation";
import { PageHeader } from "@/components/ui";

export default function AutomationLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader
        title="Pilote automatique"
        subtitle="Ce que Cliping fait quand tu n'es pas devant l'écran : te prévenir sur ton téléphone, et, si tu le décides, approuver et programmer des clips à ta place selon tes règles."
      />
      <AutomationTabs />
      {children}
    </>
  );
}
