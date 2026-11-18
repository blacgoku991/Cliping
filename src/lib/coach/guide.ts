import type { SourceId } from "./sources";

/**
 * Contenu de la page « Conseils ».
 *
 * Règles d'écriture (à respecter si tu ajoutes un conseil) :
 * - une action concrète, le pourquoi, un exemple sur des clips de gaming ;
 * - aucune statistique inventée, aucune règle d'algorithme présentée comme certaine, aucune promesse de vues ;
 * - `basis: "official"` seulement si une page de la plateforme le dit ; sinon `"usage"` (pratique courante) ;
 * - rien qui aide à contourner la détection de contenu dupliqué ni à fabriquer de l'engagement.
 */
export type Basis = "official" | "usage";

export interface GuideItem {
  /** Identifiant stable : sert à enregistrer la progression. Ne le renomme pas. */
  id: string;
  title: string;
  why: string;
  example?: string;
  basis: Basis;
  sources?: SourceId[];
}

export interface GuideTheme {
  id: string;
  title: string;
  /** Nom d'icône lucide-react (voir src/components/coach/icons.tsx) */
  icon: "hook" | "clock" | "title" | "hash" | "calendar" | "comment" | "profile" | "series" | "accounts" | "rights" | "launch";
  intro: string;
  items: GuideItem[];
}

export const GUIDE: GuideTheme[] = [
  {
    id: "hook",
    title: "L'accroche des premières secondes",
    icon: "hook",
    intro: "Sur un fil vertical, le spectateur décide très vite s'il reste. Le début du clip compte plus que tout le reste.",
    items: [
      {
        id: "hook-start-action",
        title: "Fais démarrer le clip sur l'action, pas sur la mise en place",
        why: "TikTok conseille d'accrocher le spectateur dans les 3 premières secondes, YouTube dans les « premières secondes » pour éviter qu'il fasse défiler. Une minute de route avant la poursuite, c'est autant d'occasions de partir.",
        example: "Plutôt que 10 s de conduite avant le crash, commence 1 à 2 s avant l'impact. Dans Cliping, « Retoucher » → avance le début du clip.",
        basis: "official",
        sources: ["ttTips", "ytShortsGuide"],
      },
      {
        id: "hook-overlay",
        title: "Écris une accroche courte en haut de la vidéo",
        why: "Beaucoup regardent sans le son au début : un texte lisible d'un coup d'œil dit ce qui va se passer. C'est une pratique très répandue chez les clippeurs, pas une règle de plateforme.",
        example: "« Il braque la banque… avec un vélo » plutôt que « Moment drôle GTA 6 ».",
        basis: "usage",
      },
      {
        id: "hook-honest",
        title: "Promets seulement ce que le clip tient",
        why: "Un titre ou une accroche qui ment fait partir les gens tout de suite, et YouTube interdit les titres et miniatures trompeurs. Mieux vaut une accroche moins spectaculaire mais vraie.",
        example: "Si le streamer rate son saut, n'écris pas « le saut le plus fou de GTA 6 » : « Il était sûr de passer… » est vrai et donne envie.",
        basis: "official",
        sources: ["ytSpam"],
      },
    ],
  },
  {
    id: "length",
    title: "La durée",
    icon: "clock",
    intro: "Il n'y a pas de durée magique : la bonne durée est celle du moment, sans temps mort.",
    items: [
      {
        id: "length-limits",
        title: "Reste sous 3 minutes pour les Shorts",
        why: "YouTube classe en Short une vidéo verticale ou carrée de 3 minutes maximum. Au-delà, c'est une vidéo classique. Cliping bloque déjà les clips à 3 minutes.",
        basis: "official",
        sources: ["ytShorts3min"],
      },
      {
        id: "length-cut-dead-time",
        title: "Coupe dès que le moment est fini",
        why: "Un clip qui traîne après la chute perd des spectateurs avant la fin. Regarde la courbe de rétention (TikTok : onglet Contenu des statistiques ; YouTube Studio : Audience/Engagement) pour voir où les gens décrochent sur tes propres clips.",
        example: "La réaction du streamer après l'explosion : garde 2-3 s de rire, pas les 20 s où il recharge sa partie.",
        basis: "usage",
        sources: ["ttTips"],
      },
      {
        id: "length-test",
        title: "Teste des durées différentes et compare tes chiffres",
        why: "Ce qui marche dépend de ta niche et de ton public. Seules tes statistiques te le diront : compare le pourcentage regardé, pas seulement les vues.",
        example: "Une semaine de clips de 15-25 s, une semaine de 40-60 s, puis compare la durée moyenne regardée.",
        basis: "usage",
      },
    ],
  },
  {
    id: "titles",
    title: "Titres et descriptions",
    icon: "title",
    intro: "Le titre aide à comprendre le clip et à le retrouver en recherche. Il doit être clair avant d'être malin.",
    items: [
      {
        id: "titles-clear",
        title: "Dis qui, quoi, sur quel jeu",
        why: "Les gens cherchent « GTA 6 » et le nom de leurs streamers. Un titre qui les contient est trouvable ; un titre comme « 😂😂😂 » ne l'est pas.",
        example: "« [Streamer] se fait arrêter dès sa première mission sur GTA 6 » (si c’est bien ce qui se passe).",
        basis: "usage",
      },
      {
        id: "titles-length",
        title: "Respecte les limites : 100 caractères pour un titre YouTube",
        why: "C'est la limite fixée par YouTube. Sur TikTok, seules les premières lignes de la légende s'affichent sans toucher « plus » : mets l'essentiel au début.",
        basis: "official",
        sources: ["ytUploadShorts"],
      },
      {
        id: "titles-credit",
        title: "Mentionne le streamer dans la description",
        why: "C'est honnête envers le créateur, ça aide les fans à le retrouver, et ça montre que tu ne fais pas passer son contenu pour le tien.",
        example: "« 🎥 Extrait du live de @streamer sur Twitch »",
        basis: "usage",
      },
    ],
  },
  {
    id: "hashtags",
    title: "Les hashtags",
    icon: "hash",
    intro: "Les hashtags décrivent ton clip. Ils ne remplacent pas un bon clip.",
    items: [
      {
        id: "hashtags-few-relevant",
        title: "Utilise quelques hashtags pertinents plutôt qu'une liste",
        why: "YouTube ignore tous les hashtags d'une vidéo qui en contient plus de 60, et interdit les hashtags trompeurs ou sans rapport. Une poignée de tags précis (jeu, streamer, type de moment) suffit.",
        example: "#gta6 #nomdustreamer #clipgta — pas #fyp #viral #pourtoi ×20.",
        basis: "official",
        sources: ["ytHashtags"],
      },
      {
        id: "hashtags-no-bait",
        title: "N'ajoute pas un hashtag tendance sans rapport avec le clip",
        why: "C'est du contenu trompeur au sens des règles de YouTube, et les gens qui arrivent par ce tag repartent aussitôt.",
        basis: "official",
        sources: ["ytHashtags", "ytSpam"],
      },
    ],
  },
  {
    id: "timing",
    title: "Horaires et cadence",
    icon: "calendar",
    intro: "Personne ne connaît « la » bonne heure : TikTok le dit lui-même, elle dépend de ton public.",
    items: [
      {
        id: "timing-own-data",
        title: "Choisis tes horaires d'après tes statistiques",
        why: "TikTok explique que le meilleur moment pour publier est propre à chaque compte. TikTok (Statistiques → Abonnés) et YouTube Studio (Audience → « Quand vos spectateurs sont sur YouTube ») montrent quand ton public est connecté — dès que tu as assez d'abonnés pour que ces données s'affichent.",
        example: "Au début, sans données : publie quand ton public cible est libre (après les cours, le soir), note l'heure de chaque post et compare au bout de deux semaines.",
        basis: "official",
        sources: ["ttBestTime"],
      },
      {
        id: "timing-fresh",
        title: "Publie vite les moments liés à l'actualité",
        why: "Un clip sur une découverte du jour de sortie intéresse surtout tant que tout le monde en parle. C'est de l'usage, pas une règle : un moment drôle intemporel peut attendre un meilleur créneau.",
        basis: "usage",
      },
      {
        id: "timing-quality-first",
        title: "Préfère la régularité de qualité au volume",
        why: "TikTok écrit qu'un flux régulier de contenus de qualité vaut mieux que de se précipiter pour publier tous les jours, et que la cadence te regarde. Trois bons clips valent mieux que dix moyens.",
        example: "Fixe-toi un rythme tenable (par ex. 1 à 2 clips par jour et par compte pendant la sortie) et écarte les clips moyens dans Cliping.",
        basis: "official",
        sources: ["ttTips"],
      },
      {
        id: "timing-spread",
        title: "Espace tes publications sur un même compte",
        why: "Deux clips postés à la même minute se font concurrence auprès des mêmes abonnés. Cliping te propose un créneau qui laisse quelques heures entre deux posts d'une même plateforme (règle pratique, pas une exigence des plateformes).",
        basis: "usage",
      },
    ],
  },
  {
    id: "comments",
    title: "Les commentaires",
    icon: "comment",
    intro: "Les commentaires font vivre ton compte : on y répond, on y pose de vraies questions, on y garde une ambiance correcte.",
    items: [
      {
        id: "comments-pin",
        title: "Épingle un commentaire utile sous chaque clip",
        why: "Sur YouTube, un seul commentaire peut être épinglé et il s'affiche en premier. Utilise-le pour créditer le streamer ou poser une question sur le clip.",
        example: "« Le live complet est chez @streamer 🎮 Et toi, tu aurais tenté le saut ? »",
        basis: "official",
        sources: ["ytComments"],
      },
      {
        id: "comments-real-question",
        title: "Pose des questions qui ont une vraie réponse",
        why: "Une question sur le clip (« t'aurais fait quoi ? », « meilleur perso de GTA 6 ? ») lance une discussion. « Commente 1 si… » ou « abonne-toi pour gagner… » relève de l'appât à engagement : à éviter.",
        example: "« Qui conduit le pire dans la team : lui ou son pote ? »",
        basis: "usage",
      },
      {
        id: "comments-reply-early",
        title: "Réponds aux premiers commentaires",
        why: "Ça montre qu'il y a quelqu'un derrière le compte et ça relance la discussion. Cliping te propose des réponses (Conseils → Répondre) ; relis-les avant de les poster.",
        basis: "usage",
      },
      {
        id: "comments-filters",
        title: "Active les filtres contre le spam et les insultes",
        why: "TikTok propose des filtres de commentaires (spam, mots-clés, propos offensants) ; YouTube Studio a des réglages de modération équivalents. Inutile de répondre aux trolls : masque ou supprime.",
        basis: "official",
        sources: ["ttComments"],
      },
      {
        id: "comments-no-fake",
        title: "Pas de faux commentaires, de faux comptes ni d'achat d'engagement",
        why: "Les deux plateformes l'interdisent et peuvent sanctionner tout le compte. Ne commente pas tes propres clips avec tes autres comptes.",
        basis: "official",
        sources: ["ttIntegrity", "ytSpam"],
      },
    ],
  },
  {
    id: "profile",
    title: "La bio et le profil",
    icon: "profile",
    intro: "Ton profil répond en deux secondes à « c'est quoi ce compte, et pourquoi le suivre ? ».",
    items: [
      {
        id: "profile-name",
        title: "Choisis un nom qui dit ta niche",
        why: "Quelqu'un qui tombe sur ton clip doit comprendre ce qu'il trouvera sur ton compte. Sur TikTok, le nom d'utilisateur ne peut changer qu'une fois tous les 30 jours : choisis-le bien avant la sortie.",
        example: "« GTA6 Moments FR » plutôt que « xX_clips_Xx ». Le générateur de profil propose des idées.",
        basis: "official",
        sources: ["ttUsername", "ytHandles"],
      },
      {
        id: "profile-bio",
        title: "Écris une bio qui dit quoi, qui et à quel rythme",
        why: "La bio TikTok est courte (80 caractères affichés dans l'app) : une ligne pour la niche, une pour les streamers ou le rythme. Ne promets pas un rythme que tu ne tiendras pas.",
        example: "« Les meilleurs moments GTA 6 des streams FR 🎮 Crédits aux streamers »",
        basis: "usage",
      },
      {
        id: "profile-photo",
        title: "Une photo de profil lisible en petit et à toi",
        why: "Elle s'affiche minuscule à côté de chaque clip. Un logo simple ou un visuel net se reconnaît ; une capture du jeu se perd. N'utilise pas le logo officiel du jeu ni la photo d'un streamer : tu laisserais croire que c'est son compte.",
        basis: "usage",
      },
      {
        id: "profile-link",
        title: "Mets un lien utile, si la plateforme te le permet",
        why: "Selon le compte (nombre d'abonnés, type de compte), TikTok n'affiche pas toujours le champ « site web ». Sur YouTube, les liens se mettent dans la personnalisation de la chaîne. Un lien vers tes autres comptes ou vers le streamer (avec son accord) suffit.",
        basis: "usage",
      },
    ],
  },
  {
    id: "series",
    title: "Séries et régularité",
    icon: "series",
    intro: "Une série donne une raison de revenir : on suit l'histoire, pas seulement un clip.",
    items: [
      {
        id: "series-format",
        title: "Crée une ou deux séries reconnaissables",
        why: "Un format répété (même début de titre, même accroche) aide le public à reconnaître ton compte et à attendre la suite.",
        example: "« Jour 3 sur GTA 6 avec @streamer », « Les pires conducteurs de GTA 6 #4 ».",
        basis: "usage",
      },
      {
        id: "series-playlist",
        title: "Range tes séries en playlists (YouTube) ou en séries / playlists de profil (TikTok)",
        why: "Quelqu'un qui aime un épisode peut regarder la suite sans chercher. La disponibilité des playlists de profil TikTok varie selon les comptes.",
        basis: "usage",
      },
    ],
  },
  {
    id: "accounts",
    title: "Gérer plusieurs comptes sans être pénalisé",
    icon: "accounts",
    intro: "Plusieurs comptes, ce n'est utile que s'ils sont vraiment différents. Les deux plateformes écartent le contenu non original ou réutilisé sans apport.",
    items: [
      {
        id: "accounts-different-clips",
        title: "Ne publie jamais le même clip sur deux comptes de la même plateforme",
        why: "TikTok rend inéligible au fil « Pour toi » le contenu repris sans apport créatif ; YouTube peut retirer la monétisation de toute une chaîne pour contenu réutilisé. Un même clip sur deux comptes, c'est de la concurrence avec toi-même et un risque pour les deux comptes.",
        example: "Compte A : moments drôles. Compte B : courses-poursuites. Chaque clip va sur un seul compte par plateforme.",
        basis: "official",
        sources: ["ttFyf", "ttOriginality", "ytReused"],
      },
      {
        id: "accounts-angle",
        title: "Donne à chaque compte un angle à lui",
        why: "Un angle (un streamer, un type de moment, une langue) rend chaque compte utile à un public précis. C'est de la vraie différenciation, pas un camouflage.",
        example: "Un compte « fails GTA 6 », un compte dédié à un streamer qui t'a donné son accord, un compte « tuto / astuces » si tu ajoutes tes explications.",
        basis: "usage",
      },
      {
        id: "accounts-add-value",
        title: "Ajoute ta patte : montage, contexte, sous-titres, commentaire",
        why: "YouTube cite le commentaire, la critique ou l'explication comme ce qui distingue une réutilisation acceptable ; une simple compilation sans narration est donnée comme contre-exemple. Les sous-titres et l'accroche de Cliping sont un début ; ton contexte ou ta voix vont plus loin.",
        basis: "official",
        sources: ["ytReused", "ttOriginality"],
      },
      {
        id: "accounts-no-tricks",
        title: "Ne cherche pas à « tromper » la détection de doublons",
        why: "Retourner l'image, changer la vitesse ou ajouter un filtre pour republier le même clip ne crée rien de nouveau et va à l'encontre des règles d'originalité. Cliping ne propose volontairement aucune fonction de ce genre.",
        basis: "official",
        sources: ["ttOriginality", "ytReused"],
      },
    ],
  },
  {
    id: "rights",
    title: "Droits et crédit des streamers",
    icon: "rights",
    intro: "Le stream appartient au streamer. Un clip se publie avec son accord, ou au minimum en le créditant et en retirant si on te le demande.",
    items: [
      {
        id: "rights-programs",
        title: "Privilégie les streamers qui autorisent le clipping",
        why: "Beaucoup de streamers ont un programme ou des règles pour les clippeurs (sur leur Discord, leur bio ou leurs panneaux Twitch). Sans accord, ils peuvent faire retirer tes vidéos pour droit d'auteur, ce qui pénalise ton compte.",
        example: "Avant d'ajouter un streamer dans Cliping, cherche « clip » dans ses panneaux Twitch ou sur son Discord.",
        basis: "usage",
      },
      {
        id: "rights-credit",
        title: "Garde le crédit du streamer à l'écran et en description",
        why: "Cliping l'incruste par défaut. C'est la moindre des choses envers lui, et ça évite de laisser croire que c'est ton contenu.",
        basis: "usage",
      },
      {
        id: "rights-takedown",
        title: "Retire vite un clip si le streamer te le demande",
        why: "Un retrait demandé à l'amiable vaut mieux qu'une réclamation pour droit d'auteur, qui peut entraîner des sanctions sur le compte.",
        basis: "usage",
      },
      {
        id: "rights-music",
        title: "Méfie-toi de la musique en fond",
        why: "Une musique protégée diffusée pendant le live peut faire bloquer ou démonétiser le clip. Coupe le passage ou choisis un autre moment.",
        basis: "usage",
      },
    ],
  },
  {
    id: "launch",
    title: "Plan pour les premiers jours de GTA 6",
    icon: "launch",
    intro: "La sortie attirera énormément de clips. Ce qui fera la différence : être prêt avant, publier des moments clairs, et rester régulier après le premier jour. Vérifie la date officielle sur le site de Rockstar.",
    items: [
      {
        id: "launch-before",
        title: "Avant la sortie : profils prêts, streamers choisis, test complet",
        why: "Le jour J, tu n'auras pas le temps de régler les comptes. Bio et nom fixés, streamers ajoutés avec le filtre « GTA 6 », un clip test publié en privé sur chaque compte.",
        example: "Dans Cliping : Comptes (tout est connecté), Streamers (filtre de jeu), un essai de publication sur un compte secondaire.",
        basis: "usage",
        sources: ["rockstar"],
      },
      {
        id: "launch-day1",
        title: "Jour 1 : les premières réactions et découvertes",
        why: "Les premières heures montrent les réactions à la découverte du jeu (la carte, la conduite, les premiers bugs). Ce sont des moments compréhensibles sans contexte : idéal pour des clips courts.",
        example: "« Sa réaction en découvrant la ville pour la première fois », « Premier braquage, premier fiasco ».",
        basis: "usage",
      },
      {
        id: "launch-spoilers",
        title: "Signale les spoilers de l'histoire",
        why: "Beaucoup de joueurs voudront découvrir l'histoire eux-mêmes. Un « ⚠️ spoiler » dans l'accroche évite des commentaires furieux et des signalements.",
        basis: "usage",
      },
      {
        id: "launch-week",
        title: "Première semaine : garde ton rythme et regarde tes statistiques",
        why: "Après le premier jour, la concurrence baisse un peu mais l'intérêt reste élevé. Compare tes clips (durée regardée, partages) et fais plus de ce qui marche sur chaque compte.",
        basis: "usage",
      },
      {
        id: "launch-no-leaks",
        title: "Ne publie pas de contenu leaké ou volé",
        why: "Des images issues de fuites ou de copies non officielles peuvent faire l'objet de retraits pour droit d'auteur par l'éditeur et mettre ton compte en danger. Reste sur des lives publics.",
        basis: "usage",
      },
    ],
  },
];

export const ALL_ITEM_IDS: string[] = GUIDE.flatMap((t) => t.items.map((i) => i.id));
