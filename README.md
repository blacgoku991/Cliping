# Cliping

Cliping regarde les lives à ta place, repère les meilleurs moments, les monte en clips verticaux sous-titrés, et te laisse les publier en un clic sur tes comptes TikTok, YouTube Shorts et Instagram Reels.

```
 chaînes suivies ──▶ live détecté ──▶ enregistrement ──▶ détection des moments forts
 (Twitch, Kick,      (filtre par       (tampon glissant,    (volume + chat + action à l'écran)
  YouTube, TikTok)    jeu : GTA 6)      sans réencodage)               │
                                                                       ▼
 publication ◀── tu valides / retouches ◀── clip 9:16 monté : fond flouté, accroche,
 (multi-comptes,     dans l'interface        sous-titres mot à mot, crédit du streamer,
  programmable)                              titre + hashtags proposés par l'IA
```

## Démarrage rapide (Docker)

Il te faut un serveur Linux avec Docker (un VPS 4 cœurs / 8 Go suffit pour 3 à 5 lives simultanés).

```bash
cp .env.example .env
# Dans .env : renseigne ENCRYPTION_KEY (openssl rand -base64 32) et POSTGRES_PASSWORD
docker compose up -d --build
```

Ouvre `http://localhost:3000`, crée ton compte, ajoute tes streamers dans **Streamers**. C'est tout : dès qu'un de leurs lives démarre sur le bon jeu, les clips arrivent dans **Clips**.

Le filtre de jeu est pré-rempli sur « Grand Theft Auto VI » (« GTA 6 » et « GTA VI » sont compris de la même façon). Si une chaîne est en live sans être captée, sa carte affiche la catégorie réellement annoncée par la plateforme : recopie-la dans le filtre.

Pour tester sans attendre un live, colle le lien d'un replay dans **Streamers → Importer une vidéo**.

## D'où viennent les clips

- **Lives suivis** : Twitch, Kick, YouTube et **TikTok Live** (`tiktok.com/@pseudo`). Sur YouTube et TikTok, qui n'affichent pas de catégorie, le filtre de jeu est cherché dans le titre du live.
- **Import d'une vidéo** (Streamers → Importer une vidéo) : colle le lien d'un **clip Twitch**, d'un **clip Kick**, d'une **vidéo ou d'un Short YouTube**, d'une **vidéo TikTok** (liens courts `vm.tiktok.com` compris), ou d'un replay. Une vidéo de 2 min 30 ou moins (`SHORT_VIDEO_MAX_SEC`) devient directement un clip vertical (une vidéo déjà verticale garde tout l'écran) ; au-delà, le bot y cherche les moments forts comme dans un replay.
- **« En live maintenant »** (page Streamers) : les plus gros lives d'un jeu (GTA 6 par défaut) dans une langue, avec spectateurs, titre et miniature, et un bouton **Suivre**. Demande des identifiants d'application Twitch (`TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET`, gratuits, voir `.env.example`) ; Kick en plus avec `KICK_CLIENT_ID` / `KICK_CLIENT_SECRET`.
- **Mode automatique** : « suivre automatiquement les N plus gros lives de ce jeu dans cette langue ». Toutes les 2 minutes, le bot ajoute les nouveaux gros lives et retire ceux qui sortent du classement (mis en pause s'ils ont déjà des clips, pour garder le crédit). Il reste dans la limite de `MAX_CONCURRENT_RECORDINGS`, ne touche jamais aux chaînes ajoutées à la main, et leur cède la place : si une chaîne manuelle démarre un live alors que tout est pris, la capture automatique la moins regardée s'arrête. Une chaîne automatique retirée à la main n'est plus reprise ; « Garder » la transforme en chaîne manuelle.

Une fois ton compte créé, mets `ALLOW_SIGNUP="false"` dans `.env` puis `docker compose up -d` si tu es le seul utilisateur.

### Mise en ligne avec HTTPS

TikTok, Google et Instagram n'acceptent les connexions de comptes que vers une adresse `https://`. Instagram vient en plus chercher chaque vidéo sur ton serveur : sans adresse publique, pas de publication Instagram. Pointe un nom de domaine vers ton serveur, puis :

```bash
# dans .env
APP_URL="https://clips.mondomaine.fr"
DOMAIN="clips.mondomaine.fr"

docker compose --profile https up -d --build
```

Le certificat est obtenu et renouvelé automatiquement (Caddy + Let's Encrypt).

## Connecter tes comptes

Chaque plateforme demande de créer une « application développeur » (gratuit). Les adresses de redirection exactes à déclarer sont affichées dans la page **Comptes** de l'app.

### YouTube

1. Sur [console.cloud.google.com](https://console.cloud.google.com), crée un projet et active **YouTube Data API v3**.
2. Configure l'écran de consentement OAuth, puis crée des identifiants **ID client OAuth → Application Web**.
3. URI de redirection autorisée : `{APP_URL}/api/oauth/youtube/callback`.
4. Copie l'ID et le secret dans `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, puis `docker compose up -d`.

À savoir :
- Tant que l'écran de consentement est en mode **Test**, les connexions expirent au bout de 7 jours. Passe-le en production.
- Google peut forcer en **privé** les vidéos envoyées par un projet API non vérifié. Cliping te le signale sur la publication concernée ; tu peux alors la passer en public depuis YouTube Studio, ou demander la vérification de ton projet.
- Le quota d'envoi par API est limité chaque jour (de l'ordre de 100 vidéos par projet). Vérifie le tien dans la console.

### TikTok

1. Sur [developers.tiktok.com](https://developers.tiktok.com), crée une application et ajoute les produits **Login Kit** et **Content Posting API**.
2. Scopes à demander : `user.info.basic`, `video.upload`, `video.publish`. Pour que la page **Performances** relève aussi les vues de tes vidéos TikTok, ajoute le droit `video.list` à l'application, mets `TIKTOK_STATS_SCOPE="true"` dans `.env`, redémarre et reconnecte tes comptes. Tant que ce droit n'est pas activé côté TikTok, laisse la variable à `false` : sinon la connexion des comptes serait refusée.
3. URI de redirection : `{APP_URL}/api/oauth/tiktok/callback`.
4. Copie la clé et le secret dans `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET`.

À savoir :
- Le mode **Brouillon** (par défaut) envoie la vidéo dans les notifications de ton app TikTok : tu ajoutes un son si tu veux et tu postes. C'est le mode qui fonctionne sans audit, limité à 5 brouillons en attente par 24 h et par compte.
- La **publication directe en public** exige que ton application ait passé l'audit TikTok. Avant ça, TikTok n'accepte que la visibilité « Moi uniquement », sur un compte privé.

### Instagram Reels

> **Non vérifié avec un vrai compte.** L'adaptateur suit la documentation de Meta (lue au travers d'extraits : le site développeur n'était pas joignable depuis l'environnement de développement) et son enchaînement est testé contre un faux Instagram. Fais un premier essai avec un compte secondaire.

Il faut un compte Instagram **professionnel** (Business ou Créateur). Un compte personnel se convertit gratuitement dans l'app : Paramètres → Type de compte et outils → Passer à un compte professionnel. Aucune Page Facebook n'est nécessaire.

1. Sur [developers.facebook.com](https://developers.facebook.com/apps), crée une application (les intitulés des menus de Meta changent souvent : cherche les termes entre guillemets). Choisis le cas d'usage qui permet de gérer le contenu Instagram (« Gérer les messages et le contenu sur Instagram ») ; type **Entreprise** si on te le demande.
2. Dans le produit Instagram, ouvre **« API setup with Instagram login »** (configuration avec la connexion Instagram, pas celle avec Facebook).
3. Section « Set up Instagram business login » : déclare l'URI de redirection `{APP_URL}/api/oauth/instagram/callback` (adresse exacte affichée dans la page Comptes).
4. Permissions : `instagram_business_basic` et `instagram_business_content_publish`.
5. Copie l'**Instagram app ID** et l'**Instagram app secret** (ceux de la section Instagram, pas l'identifiant de l'app Facebook) dans `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET`, puis `docker compose up -d`.
6. Dans **Rôles de l'app** (testeurs Instagram), ajoute tes comptes, et accepte l'invitation depuis chaque compte (Instagram → Paramètres → Apps et sites web → Invitations de testeurs).

À savoir :
- **Validation par Meta.** Tant que ton app n'a pas passé l'« App Review » (accès avancé à `instagram_business_content_publish`), elle ne fonctionne qu'avec les comptes qui ont un rôle dans l'app (administrateur, développeur, testeur). Pour tes propres comptes, ça suffit. Pour publier sur les comptes d'autres personnes, il faut la validation, qui demande une vidéo de démonstration, une politique de confidentialité et la vérification de l'entreprise.
- **Comment la vidéo part.** Avec la connexion Instagram, Meta n'accepte pas l'envoi direct du fichier (l'envoi « reprenable » n'est documenté que pour la connexion via Facebook) : Instagram vient télécharger la vidéo à une adresse que Cliping lui donne. Cette adresse est **temporaire (2 heures), signée, propre à une publication**, et ne sert que la vidéo montée de ce clip, uniquement pendant l'envoi. Ton serveur doit donc être en ligne en HTTPS (voir « Mise en ligne avec HTTPS ») ; la page Comptes te prévient sinon.
- **Visibilité.** L'API ne propose pas de visibilité : un Reel est public si ton compte l'est. Tu choisis seulement s'il apparaît aussi dans le fil du profil (« Reels + fil ») ou seulement dans l'onglet Reels.
- **Légende.** Titre, description, puis 5 hashtags au maximum (limite d'Instagram depuis fin 2025), 2 200 caractères en tout.
- **Limites.** Instagram plafonne les publications par API sur 24 heures glissantes (100 d'après des guides qui citent la documentation de Meta) ; Cliping vérifie le quota avant d'envoyer.
- **Accès.** Le jeton dure 60 jours. Cliping le renouvelle automatiquement bien avant l'échéance, même si le compte ne publie pas. Un compte resté sans renouvellement (serveur éteint pendant des semaines) devra être reconnecté.
- **Plusieurs comptes.** Pour connecter un autre compte, déconnecte-toi d'abord d'Instagram dans le navigateur (ou utilise une fenêtre privée).

## Publier sur plusieurs comptes

- **Réglages par compte** (page Comptes) : visibilité par défaut, plafond de publications sur 24 heures glissantes, et un bouton **Tester la connexion** qui relit le profil du compte avec son accès enregistré (rien n'est publié).
- **Planifier en lot** (Publications → « Planifier tous les clips approuvés ») : en un clic, tous les clips approuvés sont répartis sur tous les comptes valides, avec un aperçu déjà calculé (départ dans ~15 min, 3 h entre deux posts d'un compte, 20 min de décalage entre comptes) ; il ne reste qu'à cliquer « Programmer ». Tu peux aussi décocher des clips ou des comptes, changer l'heure de départ, l'écart minimal entre deux publications d'un même compte et le décalage entre comptes. L'aperçu répartit **un clip différent par publication** (jamais la même vidéo sur deux comptes), du meilleur score au moins bon, sur le compte libre le plus tôt, en respectant l'écart et les plafonds — publications déjà programmées comprises. Tu peux changer le compte ou l'heure de chaque ligne ou en retirer ; les conflits sont signalés en direct, et le serveur revérifie tout avant d'enregistrer.

## Activer l'IA et les sous-titres

Les deux sont facultatifs. Sans eux, les clips sortent avec un titre générique et sans sous-titres.

| Fonction | Variables | Remarque |
|---|---|---|
| Titres, accroches, hashtags, note de potentiel | `ANTHROPIC_API_KEY` | Modèle par défaut `claude-opus-5-5`. Pour de gros volumes, `AI_MODEL="claude-haiku-5-5"` coûte beaucoup moins cher. Le repli automatique vers un autre modèle en cas de refus est activé (sauf Haiku, qui ne le propose pas). |
| Sous-titres mot à mot | `TRANSCRIBE_API_URL`, `TRANSCRIBE_API_KEY`, `TRANSCRIBE_MODEL` | Toute API compatible OpenAI : OpenAI (`whisper-1`), Groq (`whisper-large-v3-turbo`)… Quelques centimes pour des centaines de clips. |

## Comment le bot choisit les moments

Chaque seconde de live produit trois mesures, comparées à la **ligne de base du stream lui-même** (ce qui compte, c'est ce qui sort de l'ordinaire pour ce streamer, pas un volume absolu) :

- **Son** : sonie du flux (cris, rires, explosion de volume).
- **Chat** (Twitch) : messages par seconde, pondérés par les réactions typiques (`KEKW`, `MDR`, `CLIP`, `???`…).
- **Image** : intensité des changements à l'écran.

Les écarts sont combinés et lissés sur 5 secondes (un simple coup de feu ne suffit pas), puis les pics au-dessus du seuil deviennent des clips, avec du contexte avant et des coupes calées sur les silences. Si l'IA est activée, elle note aussi le contenu à partir de ce qui se dit.

Tout se règle dans **Réglages** : sensibilité, durées, nombre max de clips par heure, mise en page, police et couleur des sous-titres.

## Comment le clip est monté

Ce qui fait qu'un clip est regardé jusqu'au bout, ce sont les deux premières secondes et le rythme. Chaque technique ci-dessous est activée par défaut (sauf le carton de fin) et se coupe dans **Réglages → Montage**, ou clip par clip dans l'éditeur :

- **Ouverture sur le moment fort** : le clip démarre sur un flash d'environ 1,5 s du pic, puis un éclair blanc ramène au début. Ignoré si le clip dure moins de 14 s ou si le pic arrive dans les 6 premières secondes.
- **Temps morts coupés** : les silences entre deux phrases qui sont aussi des creux sonores sont retirés avant le moment fort (coupes sèches, jamais au milieu d'une phrase, jamais dans les 2,5 s qui précèdent le pic, 40 % de la mise en place au maximum). Son et sous-titres restent synchronisés.
- **Bornes intelligentes** : à la création, le clip est calé sur un début de phrase, les premiers mots arrivent dans la première seconde, et la fin attend la chute de la phrase ou que la réaction retombe.
- **Zoom d'impact** : +12 % progressif sur le gameplay au moment fort, puis retour.
- **Sous-titres** : cinq styles (Classique, Impact, Encadré, Karaoké, Discret), avec les mots forts mis en valeur (choisis par l'IA, sinon exclamations, chiffres et mots criés).
- **Barre de progression** fine en haut de l'image, et **carton de fin** optionnel (appel à s'abonner + crédit du streamer, désactivé par défaut : il casse la boucle de relecture).
- **Trois accroches et trois titres** proposés par l'IA (ou des variantes neutres sans IA), à choisir d'un clic dans l'éditeur. L'IA voit quatre images de l'extrait autour du pic en plus de la transcription, écrit 6 à 8 accroches sous des angles différents (curiosité, enjeu, réaction, citation, question) et n'en garde que trois ; les formules creuses (« REGARDEZ ÇA », « INCROYABLE ») et les accroches de plus de 7 mots sont écartées.
- **Zone sûre TikTok + Shorts** : tous les textes restent hors des zones couvertes par l'interface des deux applis (rien au-dessus de y = 220, sous y = 1440, ni dans les 170 px de droite où sont les boutons). Les clips durent par défaut de 15 à 45 s.

Sur Kick, YouTube et TikTok, le chat n'est pas lu : la détection repose sur le son et l'image, et sera donc un peu moins fine que sur Twitch. (Kick ne propose officiellement la lecture du chat que par webhooks vers une adresse publique ; le websocket utilisé par son site n'est pas documenté et peut changer sans prévenir, il n'a donc pas été retenu.)

## Ce qui a été vérifié, et ce qui ne l'a pas été

Vérifié de bout en bout sur un faux live rejoué en temps réel (voir `tests/e2e/`) :

- détection du live, enregistrement, analyse, détection des moments, découpe exacte à l'image près, montage 1080×1920 avec sous-titres, nettoyage du disque, arrêt propre ;
- import de replay, retouche et remontage d'un clip depuis l'interface, lecture vidéo, pages sur ordinateur et mobile.

**Non vérifié en conditions réelles**, faute d'accès depuis l'environnement de développement :

- la capture de vrais lives Twitch, Kick et YouTube (elle repose sur `streamlink`, l'outil de référence, mais n'a pas pu être essayée ici) ;
- la connexion et la publication Instagram Reels : écrites d'après des extraits de la documentation de Meta (site développeur injoignable depuis l'environnement de développement) et des guides tiers pour les codes d'erreur, testées contre un faux Instagram (y compris le téléchargement réel de la vidéo par le lien signé), jamais avec un vrai compte ni une vraie application Meta ;
- les envois vers YouTube et TikTok : le code suit leur documentation et l'enchaînement des appels est testé contre un réseau simulé, mais aucune vraie vidéo n'a été publiée. Seuls les refus ont été observés sur les vrais serveurs de Google (identifiants invalides → message « reconnecte le compte ») ; TikTok n'était pas joignable ;
- l'appel à Claude et à l'API de transcription ;
- la capture de TikTok Live (plugin `tiktok` de streamlink 8.6, fragile car TikTok change souvent son site) et le téléchargement de vrais clips Twitch/Kick/TikTok/Shorts par yt-dlp (extracteurs présents dans la version installée, mais sites injoignables ici). L'import d'un clip court a été vérifié de bout en bout avec des fichiers servis localement ;
- l'annuaire des lives Twitch (API Helix, jeton d'application) et Kick (API publique `api.kick.com/public/v1`) : écrits d'après leur documentation, testés uniquement contre un faux annuaire. Pour Kick, les noms exacts des paramètres de `/livestreams` (`category_id`, `language`, `sort`) n'ont pu être confirmés que par des bibliothèques tierces ;
- « Tester la connexion » : vérifié contre les vrais serveurs de Google avec un jeton invalide (→ « reconnecte le compte ») ; TikTok injoignable ;
- la construction des images Docker.

Fais un essai complet avec un compte secondaire avant le jour J, et règle la sensibilité sur un vrai live : les seuils par défaut ont été calibrés sur des signaux de synthèse.

## Bonnes pratiques

- **Clippe des créateurs qui l'autorisent.** Beaucoup de streamers ont un programme de clipping ; sans leur accord, tes vidéos peuvent être retirées pour droits d'auteur. Le streamer est crédité sur chaque clip (désactivable, mais déconseillé).
- **Évite de poster la même vidéo sur plusieurs comptes.** TikTok, YouTube et Instagram pénalisent le contenu dupliqué ou « non original ». Répartis des clips différents entre tes comptes.
- **Garde `streamlink` et `yt-dlp` à jour** : les plateformes changent souvent. `docker compose build --no-cache worker && docker compose up -d` les met à jour.

## Dimensionnement

- Un live capté en 1080p60 occupe environ 0,5 Go de disque (tampon glissant de 5 minutes) et une fraction de cœur.
- Chaque clip conserve sa source (pour pouvoir le retoucher) : compte 50 à 100 Mo par clip. Les clips non publiés sont supprimés après 14 jours (réglable).
- Un montage prend 10 à 15 secondes sur 4 cœurs pour un clip de 20 à 30 s (mesuré entre 8,6 et 13,6 s, toutes options actives).
- `MAX_CONCURRENT_RECORDINGS`, `JOB_CONCURRENCY` et la qualité de capture par chaîne (`720p60,best`) permettent d'ajuster à ton serveur.

## Développement

```bash
npm install
cp .env.example .env            # décommente DATABASE_URL et DATA_DIR, renseigne ENCRYPTION_KEY
npx prisma migrate deploy
npm run dev                     # le site
npm run worker                  # le bot (dans un second terminal) — demande ffmpeg, streamlink et yt-dlp

npm test                        # tests unitaires
npm run typecheck
```

### Banc d'essai sans vrai live

`tests/e2e/` contient un faux `streamlink` qui rejoue un fichier local en temps réel, et un faux chat Twitch + une fausse API de transcription :

```bash
export E2E_DIR=/tmp/cliping-e2e && mkdir -p $E2E_DIR   # y placer une vidéo nommée stream.mp4
node tests/e2e/mock-services.mjs &
npm run demo:seed                                      # compte demo@cliping.local + chaîne fictive
touch $E2E_DIR/live                                    # « le streamer passe en live »
STREAMLINK_BIN=$PWD/tests/e2e/fake-streamlink.sh TWITCH_IRC_URL=ws://127.0.0.1:8765 \
TRANSCRIBE_API_URL=http://127.0.0.1:8765 TRANSCRIBE_API_KEY=test MONITOR_INTERVAL_SEC=10 npm run worker
```

### Organisation du code

```
prisma/schema.prisma        modèle de données
src/app/                    site Next.js (pages, actions serveur, routes OAuth et média)
src/lib/                    partagé site + bot : base, sessions, chiffrement, file de tâches, plateformes
src/lib/platforms/          adaptateurs YouTube, TikTok et Instagram (OAuth, envoi, suivi)
src/lib/public-media.ts     liens publics signés et temporaires (vidéo récupérée par Instagram)
src/lib/schedule.ts         planification en lot (partagée entre l'aperçu et la validation serveur)
src/worker/                 le bot
  monitor.ts                  qui est en live ?
  recorder.ts                 capture + analyse en continu + découpe
  analysis/                   mesures son/image et détecteur de moments forts
  chat/twitch.ts              lecture anonyme du chat
  discovery.ts                « en live maintenant » et mode automatique (annuaire : src/lib/live-apis.ts)
  pipeline/clip.ts            transcription → titre → montage
  render/                     sous-titres ASS et montage ffmpeg
  vod.ts, publish.ts          import de replays, publication
tests/                      tests unitaires + banc d'essai de bout en bout
```

## Pas encore là

- Paiement et abonnements (Stripe) : l'app est multi-utilisateurs, mais sans facturation.
- Instagram Reels et autres plateformes : l'interface d'adaptateur (`src/lib/platforms/types.ts`) est prévue pour en ajouter.
- Lecture du chat Kick, YouTube et TikTok.
- Stockage externe (S3/R2) : les vidéos sont sur le disque du serveur.

---

Cliping n'est affilié ni à Rockstar Games, ni à Twitch, Kick, YouTube ou TikTok.
