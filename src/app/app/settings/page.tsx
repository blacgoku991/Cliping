import type { Metadata } from "next";
import { saveSettings } from "@/app/actions/settings";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, CardHeader, Field, Input, PageHeader, Select } from "@/components/ui";
import { requireUser } from "@/lib/session";
import { CAPTION_STYLE_KEYS, CAPTION_STYLE_LABELS, parseSettings } from "@/lib/settings";
import { getWorkerStatus } from "@/lib/worker-status";

export const metadata: Metadata = { title: "Réglages" };

function Check({ name, label, hint, checked }: { name: string; label: string; hint?: string; checked: boolean }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-bg px-3 py-2.5 text-sm">
      <input type="checkbox" name={name} defaultChecked={checked} className="mt-0.5 size-4 accent-[var(--color-brand)]" />
      <span>
        {label}
        {hint ? <span className="mt-0.5 block text-xs leading-relaxed text-faint">{hint}</span> : null}
      </span>
    </label>
  );
}

export default async function SettingsPage() {
  const user = await requireUser();
  const s = parseSettings(user.settings);
  const worker = await getWorkerStatus();

  return (
    <>
      <PageHeader title="Réglages" subtitle="Comment le bot choisit et monte tes clips. Les changements s'appliquent aux prochains lives et imports." />
      <ActionForm action={saveSettings} className="space-y-6">
        <Card>
          <CardHeader title="Détection des moments forts" />
          <div className="grid gap-5 p-5 md:grid-cols-2">
            <Field label="Sensibilité" hint="Plus c'est élevé, plus le bot crée de clips (et plus tu auras de tri à faire).">
              <Select name="sensitivity" defaultValue={s.sensitivity}>
                <option value={1}>1 — Seulement les moments énormes</option>
                <option value={2}>2 — Sélectif</option>
                <option value={3}>3 — Équilibré (recommandé)</option>
                <option value={4}>4 — Généreux</option>
                <option value={5}>5 — Tout ce qui bouge</option>
              </Select>
            </Field>
            <Field label="Clips max par heure et par live" hint="Garde-fou pour ne pas être noyé pendant un live très agité.">
              <Input name="maxClipsPerHour" type="number" min={1} max={60} defaultValue={s.maxClipsPerHour} />
            </Field>
            <Field label="Potentiel minimum pour garder un clip" hint="De 0 à 100. En dessous, le clip part directement dans « Écartés » : seuls les moments les plus forts arrivent à valider. 60 par défaut ; monte à 70 ou plus pour être très sélectif.">
              <Input name="minScore" type="number" min={0} max={100} defaultValue={s.minScore} />
            </Field>
            <Field label="Durée minimale (s)"><Input name="clipMinSec" type="number" min={8} max={60} defaultValue={s.clipMinSec} /></Field>
            <Field label="Durée maximale (s)"><Input name="clipMaxSec" type="number" min={15} max={180} defaultValue={s.clipMaxSec} /></Field>
            <Field label="Contexte avant l'action (s)" hint="Ce qui précède le moment fort : la mise en place qui rend le clip compréhensible.">
              <Input name="preRollSec" type="number" min={0} max={30} defaultValue={s.preRollSec} />
            </Field>
            <Field label="Marge après l'action (s)"><Input name="postRollSec" type="number" min={0} max={20} defaultValue={s.postRollSec} /></Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Montage" />
          <div className="grid gap-5 p-5 md:grid-cols-2">
            <Field label="Mise en page par défaut">
              <Select name="template" defaultValue={s.template}>
                <option value="BLUR">Gameplay centré, fond flouté</option>
                <option value="FULL">Plein écran (recadré au centre)</option>
                <option value="FACECAM">Facecam en haut + gameplay (si la zone est définie sur la chaîne)</option>
              </Select>
            </Field>
            <Field label="Zoom sur le gameplay" hint="Pour la mise en page « fond flouté ». 1 = toute la largeur du stream visible ; 1,35 = recadré pour être plus lisible sur mobile.">
              <Input name="zoom" type="number" min={1} max={2} step={0.05} defaultValue={s.zoom} />
            </Field>
            <Field label="Style des sous-titres" hint={CAPTION_STYLE_KEYS.map((k) => `${CAPTION_STYLE_LABELS[k].name} : ${CAPTION_STYLE_LABELS[k].hint.toLowerCase()}.`).join(" ") + " Modifiable clip par clip."}>
              <Select name="captionStyle" defaultValue={s.captionStyle}>
                {CAPTION_STYLE_KEYS.map((k) => (
                  <option key={k} value={k}>{CAPTION_STYLE_LABELS[k].name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Police du style Classique">
              <Select name="captionFont" defaultValue={s.captionFont}>
                <option value="Poppins ExtraBold">Poppins ExtraBold (ronde)</option>
                <option value="Anton">Anton (condensée)</option>
              </Select>
            </Field>
            <Field label="Couleur de mise en valeur" hint="Mot prononcé, mots forts, barre de progression.">
              <input type="color" name="captionColor" defaultValue={s.captionColor} className="h-10 w-full cursor-pointer rounded-xl border border-line bg-bg p-1" />
            </Field>
            <Field label="Langue des streams" hint="Utilisée pour la transcription et la rédaction des titres.">
              <Select name="language" defaultValue={s.language}>
                <option value="fr">Français</option>
                <option value="en">Anglais</option>
                <option value="es">Espagnol</option>
                <option value="de">Allemand</option>
                <option value="pt">Portugais</option>
                <option value="it">Italien</option>
              </Select>
            </Field>
            <div className="space-y-2.5 md:col-span-2">
              <Check name="captions" checked={s.captions} label="Sous-titres automatiques" hint={worker.transcription ? "Transcription active sur ce serveur." : "Nécessite TRANSCRIBE_API_URL et TRANSCRIBE_API_KEY sur le serveur — pas configuré pour l'instant, les clips sortent sans sous-titres."} />
              <Check name="showHook" checked={s.showHook} label="Afficher l'accroche en haut de la vidéo" />
              <Check name="showCredit" checked={s.showCredit} label="Créditer le streamer sur la vidéo" hint="Recommandé : c'est la base du clipping, et ça limite les réclamations." />
            </div>
            <div className="md:col-span-2">
              <p className="mb-2.5 text-sm font-medium text-ink">Rythme et rétention <span className="font-normal text-muted">— les réglages par défaut, modifiables clip par clip dans l'éditeur</span></p>
              <div className="grid gap-2.5 md:grid-cols-2">
                <Check name="coldOpen" checked={s.coldOpen} label="Ouvrir sur le moment fort" hint="Flash d'environ 1,5 s du pic en ouverture, puis retour au début. Ignoré si le clip dure moins de 14 s ou si le pic arrive dans les 6 premières secondes." />
                <Check name="trimSilence" checked={s.trimSilence} label="Couper les temps morts" hint="Coupes sèches dans les silences et les creux avant le pic. Jamais au milieu d'une phrase, jamais dans les 2,5 s avant le pic." />
                <Check name="smartBounds" checked={s.smartBounds} label="Bornes intelligentes" hint="Le clip démarre sur un début de phrase et se termine après la chute ou la réaction. Appliqué à la création du clip." />
                <Check name="punchZoom" checked={s.punchZoom} label="Zoom d'impact au moment fort" hint="Léger zoom progressif (+12 %) sur le gameplay, puis retour." />
                <Check name="progressBar" checked={s.progressBar} label="Barre de progression" hint="Fine barre en haut de la vidéo." />
                <Check name="endCard" checked={s.endCard} label="Carton de fin" hint="2,5 s d'appel à s'abonner avec le crédit du streamer. Désactivé par défaut : il casse la boucle de relecture, qui compte beaucoup sur TikTok et Shorts." />
              </div>
            </div>
            <Field label="Texte du carton de fin" hint="40 caractères max.">
              <Input name="endCardText" defaultValue={s.endCardText} maxLength={40} />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Publication et stockage" />
          <div className="grid gap-5 p-5 md:grid-cols-2">
            <Field label="Hashtags par défaut" hint="Ajoutés à chaque clip, en plus de ceux proposés par l'IA.">
              <Input name="defaultHashtags" defaultValue={s.defaultHashtags.map((t) => `#${t}`).join(" ")} />
            </Field>
            <Field label="Conserver les clips non publiés (jours)" hint="Au-delà, ils sont supprimés pour libérer le disque. 0 = ne jamais supprimer.">
              <Input name="retentionDays" type="number" min={0} max={365} defaultValue={s.retentionDays} />
            </Field>
          </div>
        </Card>

        <SubmitButton variant="primary" size="lg" pendingLabel="Enregistrement…">Enregistrer les réglages</SubmitButton>
      </ActionForm>

      <Card className="mt-8">
        <CardHeader title="État du serveur" />
        <dl className="grid gap-x-8 gap-y-3 p-5 text-sm sm:grid-cols-2">
          <div className="flex items-center justify-between gap-3"><dt className="text-muted">Bot de capture (worker)</dt><dd><Badge tone={worker.online ? "ok" : "bad"}>{worker.online ? "En marche" : "Arrêté"}</Badge></dd></div>
          <div className="flex items-center justify-between gap-3"><dt className="text-muted">Lives en cours de capture</dt><dd className="tabular-nums">{worker.recordings}</dd></div>
          <div className="flex items-center justify-between gap-3"><dt className="text-muted">Titres générés par IA</dt><dd><Badge tone={worker.ai ? "ok" : "neutral"}>{worker.ai ? "Actifs" : "Non configurés"}</Badge></dd></div>
          <div className="flex items-center justify-between gap-3"><dt className="text-muted">Sous-titres automatiques</dt><dd><Badge tone={worker.transcription ? "ok" : "neutral"}>{worker.transcription ? "Actifs" : "Non configurés"}</Badge></dd></div>
        </dl>
      </Card>
    </>
  );
}
