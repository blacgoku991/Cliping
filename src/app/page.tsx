import Link from "next/link";
import { Captions, Clock, Flame, MessageSquare, Radio, Scissors, Send, ShieldCheck, Volume2 } from "lucide-react";
import { Logo, TikTokIcon, TwitchIcon, YouTubeIcon, KickIcon } from "@/components/brand";
import { LinkButton } from "@/components/ui";
import { getUser } from "@/lib/session";

function PhoneMock() {
  return (
    <div className="relative mx-auto w-[250px] sm:w-[290px]" aria-hidden>
      <div className="phone-glow absolute -inset-12 rounded-full opacity-80 blur-3xl" />
      {/* Pastilles flottantes : ce que le bot a vu */}
      <div className="rise-in absolute -left-6 top-[38%] z-10 rounded-2xl border border-line-strong bg-surface/95 px-3 py-2 text-xs shadow-2xl backdrop-blur sm:-left-16" style={{ animationDelay: "300ms" }}>
        <p className="font-semibold text-ink">Moment fort détecté</p>
        <svg viewBox="0 0 120 30" className="mt-1 h-7 w-28">
          <path d="M0 26 L12 25 L24 24 L36 25 L48 22 L58 20 L66 9 L72 3 L80 10 L90 21 L104 24 L120 25" fill="none" stroke="var(--color-brand)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" className="draw-line" style={{ "--len": 160 } as React.CSSProperties} />
          <line x1="0" x2="120" y1="14" y2="14" stroke="var(--color-brand-2)" strokeOpacity="0.6" />
          <circle cx="72" cy="3" r="3" fill="var(--color-brand-2)" />
        </svg>
      </div>
      <div className="rise-in absolute -right-4 top-[58%] z-10 rounded-full border border-brand/40 bg-surface/95 px-3 py-1.5 text-xs font-bold text-brand shadow-2xl backdrop-blur sm:-right-10" style={{ animationDelay: "500ms" }}>
        🔥 97 · prêt à poster
      </div>
      <div className="phone-shell relative rounded-[2.6rem] p-[9px]">
      <div className="relative aspect-[9/19] overflow-hidden rounded-[2rem] bg-black">
        <span className="absolute left-1/2 top-2 z-10 h-5 w-20 -translate-x-1/2 rounded-full bg-black" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#3a1a5c] via-[#ff4d8d]/50 to-[#ff8a3d]/70" />
        <div className="absolute inset-x-0 top-[27%] h-[40%] bg-gradient-to-br from-[#16a6c9] via-[#f2a65a] to-[#f25c78]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_70%,rgb(0_0_0/0.45),transparent_55%)]" />
          <div className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-md bg-black/55 px-2 py-1 text-[10px] font-semibold">
            <span className="live-dot size-1.5 rounded-full bg-live" /> LIVE · 48 213
          </div>
        </div>
        <p className="absolute inset-x-4 top-[11%] text-center font-display text-[23px] leading-[1.05] tracking-wide text-white [text-shadow:0_3px_0_#000,0_0_12px_rgb(0_0_0/0.6)]">
          IL S&apos;ATTENDAIT PAS À ÇA
        </p>
        <p className="absolute left-3 top-[23.5%] text-[9px] font-bold text-white/80">twitch.tv/tonstreamer</p>
        <p className="absolute inset-x-0 top-[71%] text-center text-[22px] font-extrabold tracking-tight text-white [text-shadow:0_3px_0_#000]">
          MAIS <span className="text-[#ffe600]">NOOON</span> FRÉROT
        </p>
        <div className="absolute bottom-4 right-3 flex flex-col items-center gap-3 text-white/90">
          <Flame className="size-6" />
          <MessageSquare className="size-6" />
          <Send className="size-6" />
        </div>
      </div>
      </div>
    </div>
  );
}

const STEPS = [
  { icon: Radio, title: "1. Ajoute tes streamers", text: "Colle le lien de leurs chaînes Twitch, Kick ou YouTube. Filtre par jeu : seuls les lives GTA 6 sont captés si tu veux." },
  { icon: Scissors, title: "2. Le bot regarde à ta place", text: "Dès qu'un live démarre, il est enregistré. Quand le streamer hurle et que le chat explose, le moment est découpé et monté tout seul." },
  { icon: Send, title: "3. Tu valides, tu postes", text: "Chaque clip arrive en vertical, sous-titré, titré. Un clic pour l'envoyer sur tous tes comptes TikTok et YouTube, maintenant ou plus tard." },
];

const FEATURES = [
  { icon: Volume2, title: "Détection son + chat", text: "Le bot mesure ce qui sort de l'ordinaire pour CE streamer : volume, rafales de KEKW et de « CLIP » dans le chat, action à l'écran." },
  { icon: Captions, title: "Sous-titres mot à mot", text: "Transcription automatique et sous-titres animés façon Shorts, avec le mot en cours surligné." },
  { icon: Flame, title: "Titres et hashtags par IA", text: "Claude lit ce qui se dit dans l'extrait et propose un titre, une accroche et une note de potentiel honnête." },
  { icon: Clock, title: "Programmation multi-comptes", text: "Connecte autant de comptes que tu veux. Publie tout de suite ou étale tes posts sur la journée." },
  { icon: Scissors, title: "Retouche en deux clics", text: "Décale le début ou la fin, change le titre, coupe les sous-titres : le clip est remonté en quelques secondes." },
  { icon: ShieldCheck, title: "Le streamer est crédité", text: "Son pseudo est incrusté sur chaque clip. Clippe des créateurs qui l'autorisent : c'est aussi ce qui protège tes comptes." },
];

export default async function Home() {
  const user = await getUser();
  return (
    <div className="grid-glow min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
        <nav className="flex items-center gap-2">
          {user ? (
            <LinkButton href="/app" variant="primary">Ouvrir l&apos;app</LinkButton>
          ) : (
            <>
              <LinkButton href="/login" variant="ghost">Connexion</LinkButton>
              <LinkButton href="/register" variant="primary">Commencer</LinkButton>
            </>
          )}
        </nav>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-10 lg:grid-cols-[1.15fr_0.85fr] lg:pt-16">
          <div>
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-brand/40 bg-brand/10 px-3 py-1 text-xs font-semibold text-brand">
              <span className="live-dot size-1.5 rounded-full bg-brand" /> Prêt pour la sortie de GTA 6
            </p>
            <h1 className="font-display text-5xl uppercase leading-[0.95] tracking-wide sm:text-7xl">
              Les meilleurs moments des lives. <span className="brand-text">Déjà montés.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
              Cliping regarde les streams à ta place, repère les moments qui font réagir, et te livre des clips verticaux sous-titrés. Toi, tu n&apos;as plus qu&apos;à appuyer sur « Publier ».
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <LinkButton href={user ? "/app" : "/register"} variant="primary" size="lg">
                {user ? "Ouvrir mon tableau de bord" : "Créer mon compte"}
              </LinkButton>
              <Link href="#comment" className="px-2 text-sm font-semibold text-muted underline-offset-4 hover:text-ink hover:underline">
                Comment ça marche
              </Link>
            </div>
            <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-muted">
              <span className="text-faint">Capte</span>
              <span className="inline-flex items-center gap-1.5"><TwitchIcon className="size-4 text-[#a970ff]" /> Twitch</span>
              <span className="inline-flex items-center gap-1.5"><KickIcon className="size-4 text-[#53fc18]" /> Kick</span>
              <span className="inline-flex items-center gap-1.5"><YouTubeIcon className="size-4 text-[#ff3333]" /> YouTube Live</span>
              <span className="text-faint">· Publie sur</span>
              <span className="inline-flex items-center gap-1.5"><TikTokIcon className="size-4" /> TikTok</span>
              <span className="inline-flex items-center gap-1.5"><YouTubeIcon className="size-4 text-[#ff3333]" /> Shorts</span>
            </div>
          </div>
          <PhoneMock />
        </section>

        <section id="comment" className="border-y border-line bg-surface/60">
          <div className="mx-auto grid max-w-6xl gap-6 px-5 py-16 md:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.title} className="rounded-2xl border border-line bg-bg p-6">
                <div className="brand-gradient mb-4 grid size-11 place-items-center rounded-xl text-white"><s.icon className="size-5" /></div>
                <h2 className="text-lg font-semibold">{s.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted">{s.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-20">
          <h2 className="max-w-2xl font-display text-4xl uppercase leading-none tracking-wide sm:text-5xl">
            Tout le montage, <span className="brand-text">sans monter.</span>
          </h2>
          <div className="mt-10 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title}>
                <f.icon className="mb-3 size-6 text-brand" />
                <h3 className="font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{f.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 pb-24">
          <div className="relative overflow-hidden rounded-3xl border border-line bg-surface px-6 py-12 text-center sm:px-12">
            <div className="absolute inset-x-0 -top-24 mx-auto h-48 w-2/3 rounded-full bg-brand/30 blur-3xl" aria-hidden />
            <h2 className="relative font-display text-4xl uppercase tracking-wide sm:text-5xl">Sois prêt avant le premier live</h2>
            <p className="relative mx-auto mt-4 max-w-xl text-muted">
              Ajoute tes streamers maintenant : à la seconde où ils lancent GTA 6, le bot enregistre.
            </p>
            <div className="relative mt-7">
              <LinkButton href={user ? "/app/streamers" : "/register"} variant="primary" size="lg">
                {user ? "Ajouter des streamers" : "Créer mon compte"}
              </LinkButton>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-8 text-xs text-faint">
          <Logo className="text-lg text-muted" />
          <p className="max-w-xl leading-relaxed">
            Cliping n&apos;est affilié ni à Rockstar Games, ni à Twitch, Kick, YouTube ou TikTok. Publie uniquement des extraits de créateurs qui autorisent le clipping.
          </p>
        </div>
      </footer>
    </div>
  );
}
