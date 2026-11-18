# Cliping — guide pour travailler dans ce dépôt

Cliping surveille des streamers (Twitch, Kick, YouTube), enregistre leurs lives, repère les moments forts, les monte en clips verticaux sous-titrés, et permet de les publier sur des comptes TikTok et YouTube Shorts. Le contexte produit et l'état de ce qui est vérifié ou non sont dans `README.md` : lis-le en premier.

L'utilisateur est francophone et non développeur : l'interface, les messages d'erreur, les commentaires de code et les messages de commit sont **en français**, dans un registre direct (tutoiement dans l'interface).

## Démarrer dans un conteneur vierge

```bash
scripts/dev-setup.sh        # Postgres local, npm ci, migrations, streamlink/yt-dlp, compte de démo, faux live (~1 min)
scripts/dev-up.sh           # faux services + worker + site (next dev) sur http://localhost:3000
scripts/dev-up.sh live      # idem, avec la chaîne de démo « en live » : 2 clips sortent en ~3 min
scripts/dev-up.sh stop
```

Compte de démo : `demo@cliping.local` / `demo-cliping-2026`. Journaux dans `/tmp/cliping-e2e/logs/`.

Twitch, Kick, TikTok et YouTube (hors API Google) ne sont pas joignables depuis ces conteneurs. Le banc d'essai (`tests/e2e/`) les remplace : un faux `streamlink` rejoue `stream.mp4` en temps réel (deux moments forts à 70 s et 160 s), un faux chat Twitch réagit, une fausse API de transcription renvoie des mots horodatés.

## Vérifier avant de dire que c'est fini

```bash
npm run typecheck && npm test && npx next build
```

Puis vérifie **réellement** ce que tu as changé, pas seulement par les tests :

- Interface : pilote le site avec Playwright et regarde tes captures d'écran (ordinateur 1440 px **et** mobile 390 px), sans erreur console. Playwright est préinstallé ; écris des scripts **CommonJS** (`.cjs`, `require("playwright")`) hors du dépôt — l'import ESM ne trouve pas le module.
- Montage : lance un vrai rendu ffmpeg et regarde des images extraites du résultat.
- Worker : `scripts/dev-up.sh live` et lis `worker.log`.

Dis clairement dans ton rapport ce que tu n'as pas pu vérifier (appels à des services injoignables, etc.). Ne présente jamais comme testé ce qui ne l'a été que contre un réseau simulé.

## Architecture

```
prisma/schema.prisma     modèle de données (Postgres)
src/app/                 site Next.js 16 (App Router) : pages, actions serveur (src/app/actions), routes OAuth et média
src/components/          composants ; ui.tsx = briques de base, action-form.tsx = formulaires reliés aux actions
src/lib/                 partagé site + worker : db, session, crypto, jobs (file Postgres), settings, platforms/
src/worker/              le bot : monitor → recorder → analysis/detector → pipeline/clip → render/ ; vod.ts ; publish.ts
tests/                   vitest (unitaires) + tests/e2e (banc d'essai)
```

Le site et le worker ne se parlent que par la base (tables `Job`, `KeyValue`, et les modèles métier). Les vidéos sont sur disque dans `DATA_DIR` (`clips/<id>/{source,final}.mp4`).

## Conventions

- **TypeScript strict**, `noUncheckedIndexedAccess`. Alias `@/` → `src/`. Pas de `any`.
- **Next 16** : `params` et `searchParams` sont des `Promise` ; `cookies()` est asynchrone. Les mutations passent par des actions serveur qui commencent toutes par `requireUser()` et filtrent par `userId`.
- **Formulaires** : `<ActionForm>` + `<SubmitButton>` (`src/components/action-form.tsx`). L'action renvoie `{ error }` ou `{ ok }`. Les champs gardent leur saisie en cas d'erreur.
- **Style** : Tailwind v4, jetons de couleur dans `src/app/globals.css` (`bg`, `surface`, `line`, `ink`, `muted`, `brand`…). Thème sombre, dégradé rose→orange de la marque, police d'affichage Anton (`font-display`). Icônes `lucide-react` ; les logos de marques sont des SVG maison dans `src/components/brand.tsx`.
- **Dates** : le serveur ne connaît pas le fuseau de l'utilisateur. Durées relatives (`ago()`) côté serveur, heures absolues via `<LocalTime>` côté client.
- **Processus externes** : toujours `run()`/`runOk()` de `src/worker/proc.ts` (pas de shell, pas d'interpolation). Les URL fournies par l'utilisateur passent par `isAllowedSourceUrl()` (anti-SSRF).
- **Secrets** : les jetons OAuth sont chiffrés (`encrypt`/`decrypt`). Rien de secret dans les journaux ni dans le dépôt.
- **Base** : toute évolution du schéma passe par `npx prisma migrate dev --name <nom>` (une migration ajoutée, jamais une migration existante modifiée). N'enlève ni ne renomme une colonne existante sans nécessité.
- **Dépendances** : n'en ajoute que si elle apporte vraiment quelque chose ; pas de bibliothèque lourde pour ce qui tient en quelques dizaines de lignes.
- **IA (Claude)** : charge le skill `claude-api` avant d'écrire du code qui appelle l'API. Le modèle vient de `env.ai.model` (défaut `claude-opus-5-5`) ; suis le patron de `src/worker/ai.ts` (sorties structurées, repli côté serveur sauf sur Haiku, dégradation propre sans clé).
- **Honnêteté du produit** : pas de promesse de vues, pas de fonction pensée pour contourner la détection de contenu dupliqué des plateformes, crédit du streamer conservé par défaut.

## Commits

Messages en français, à l'impératif descriptif, qui disent ce que ça change pour l'utilisateur. Ne mentionne aucun identifiant de modèle dans les commits ou le code.
