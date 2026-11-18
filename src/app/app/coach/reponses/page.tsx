import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";
import { AiNotice } from "@/components/coach/ai-notice";
import { ReplyHelper } from "@/components/coach/reply-helper";
import { Card, CardHeader } from "@/components/ui";
import { aiAvailable } from "@/lib/coach/ai";

export const metadata: Metadata = { title: "Répondre aux commentaires" };

const RULES = [
  "Réponds en ton nom, depuis le compte qui a publié. Jamais avec un autre compte qui se ferait passer pour un spectateur.",
  "Face à un troll ou une insulte, ne réponds pas forcément : masquer, supprimer ou filtrer suffit souvent.",
  "Si le streamer te demande de retirer un clip, accepte poliment et retire-le vite.",
  "Relis toujours une réponse proposée avant de la poster : c'est toi qui parles.",
];

export default function CoachRepliesPage() {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-5">
        <AiNotice available={aiAvailable()} />
        <Card>
          <CardHeader title="Aide aux réponses" hint="Colle un commentaire reçu, choisis un ton : tu obtiens quelques réponses possibles. Rien n'est enregistré." />
          <div className="p-5">
            <ReplyHelper />
          </div>
        </Card>
      </div>
      <Card className="self-start">
        <CardHeader title={<span className="flex items-center gap-2"><ShieldAlert className="size-4 text-warn" /> Les règles du jeu</span>} />
        <ul className="space-y-3 px-5 py-4 text-sm leading-relaxed text-muted">
          {RULES.map((r) => (
            <li key={r} className="flex gap-2"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-brand" />{r}</li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
