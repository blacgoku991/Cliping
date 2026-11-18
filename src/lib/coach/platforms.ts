import type { Basis } from "./guide";
import type { SourceId } from "./sources";

/**
 * Onglet « Plateformes » de la page Conseils : comment chaque format choisit ce qu'il montre,
 * mémo par plateforme, et répartition entre plusieurs comptes.
 *
 * Mêmes règles que guide.ts : ce que la plateforme affirme est `official` et sourcé ; le reste est `usage`.
 * Les algorithmes ne sont pas publics : on ne prétend jamais connaître leurs pondérations.
 */

export interface Point {
  text: string;
  basis: Basis;
  sources?: SourceId[];
}

export interface FormatSheet {
  id: "tiktok" | "shorts" | "youtube";
  title: string;
  platform: "TIKTOK" | "YOUTUBE";
  summary: string;
  /** Ce que la plateforme dit regarder */
  signals: Point[];
  /** Ce que ça implique pour un clippeur de gaming */
  implications: Point[];
  /** Erreurs qui coûtent cher */
  mistakes: Point[];
}

export const ALGO_DISCLAIMER =
  "Aucune plateforme ne publie sa formule. Ce qui suit reprend ce qu'elles disent elles-mêmes regarder, puis ce qu'on en déduit en pratique. Quiconque prétend connaître « l'algorithme » au point de garantir des vues se trompe ou vend quelque chose.";

export const FORMATS: FormatSheet[] = [
  {
    id: "tiktok",
    title: "TikTok — le fil « Pour toi »",
    platform: "TIKTOK",
    summary: "TikTok estime, pour chaque spectateur, la probabilité qu'il interagisse avec une vidéo, et montre celles qui obtiennent la meilleure estimation, en évitant d'enchaîner des vidéos trop semblables.",
    signals: [
      {
        text: "Les interactions du spectateur : vidéos aimées ou partagées, comptes suivis, commentaires, vidéos regardées jusqu'au bout ou passées.",
        basis: "official",
        sources: ["ttHowRecommends", "ttRecoSystem"],
      },
      {
        text: "Les informations de la vidéo : légende, son, hashtags.",
        basis: "official",
        sources: ["ttHowRecommends"],
      },
      {
        text: "La langue, le pays et l'appareil, avec un poids plus faible selon TikTok.",
        basis: "official",
        sources: ["ttHowRecommends"],
      },
      {
        text: "Le nombre d'abonnés et les succès passés du compte ne sont pas des facteurs directs, d'après TikTok. Un petit compte peut donc être recommandé.",
        basis: "official",
        sources: ["ttHowRecommends"],
      },
      {
        text: "Peuvent ne pas être recommandées : les vidéos de moins de 5 secondes, de plus de 90 jours, ou dont le son a été coupé. Le contenu non original ou repris sans apport est inéligible au fil « Pour toi ».",
        basis: "official",
        sources: ["ttRecoSystem", "ttFyf"],
      },
    ],
    implications: [
      {
        text: "Tout se joue sur le visionnage : un clip qui démarre sur l'action et s'arrête quand le moment est fini donne envie de rester jusqu'au bout.",
        basis: "usage",
      },
      {
        text: "Écris une légende qui dit vraiment ce qui se passe (jeu, streamer, type de moment) : TikTok lit la légende et les hashtags pour comprendre de quoi parle la vidéo.",
        basis: "usage",
        sources: ["ttHowRecommends"],
      },
      {
        text: "Publie les moments tant qu'ils sont frais : une vidéo de plus de 90 jours peut ne plus être recommandée.",
        basis: "official",
        sources: ["ttRecoSystem"],
      },
      {
        text: "Garde le son du live : une vidéo au son coupé peut ne pas être recommandée.",
        basis: "official",
        sources: ["ttRecoSystem"],
      },
    ],
    mistakes: [
      {
        text: "Reposter un clip déjà publié ailleurs (filigrane d'un autre compte, même vidéo sur plusieurs comptes) : contenu non original, inéligible au fil « Pour toi ».",
        basis: "official",
        sources: ["ttFyf", "ttOriginality"],
      },
      {
        text: "Acheter des vues, des abonnés ou des commentaires, ou s'en donner avec d'autres comptes : interdit, sanctionnable.",
        basis: "official",
        sources: ["ttIntegrity"],
      },
      {
        text: "Supprimer et reposter une vidéo qui « n'a pas marché » en boucle : rien n'indique que ça aide, et ça ressemble à du spam.",
        basis: "usage",
      },
    ],
  },
  {
    id: "shorts",
    title: "YouTube Shorts — le flux Shorts",
    platform: "YOUTUBE",
    summary: "YouTube ne publie pas de règles propres au flux Shorts. Son système de recommandation part de ce que chaque spectateur regarde et apprécie, et YouTube Studio montre pour chaque Short combien de fois il a été affiché dans le flux et quelle part des spectateurs l'a regardé plutôt que balayé.",
    signals: [
      {
        text: "Ce que le spectateur regarde et combien de temps, ce qu'il aime, partage, n'aime pas, et ses réponses aux enquêtes de satisfaction.",
        basis: "official",
        sources: ["ytRecoBlog", "ytRecoHelp"],
      },
      {
        text: "Les retours « Pas intéressé » et « Ne pas recommander la chaîne », qui servent à éviter certains contenus.",
        basis: "official",
        sources: ["ytRecoHelp"],
      },
      {
        text: "Dans YouTube Studio : « Affichées dans le flux » et « Regardées (ou balayées) » pour chaque Short. YouTube ne dit pas comment ces chiffres pèsent dans la recommandation, mais ils montrent si ton début de clip retient.",
        basis: "official",
        sources: ["ytReach"],
      },
      {
        text: "Est un Short toute vidéo verticale ou carrée de 3 minutes maximum.",
        basis: "official",
        sources: ["ytShorts3min"],
      },
    ],
    implications: [
      {
        text: "Regarde « Regardées / balayées » sur tes Shorts : si beaucoup de spectateurs balaient, retravaille le début (accroche, premier plan) plutôt que le titre.",
        basis: "usage",
        sources: ["ytReach"],
      },
      {
        text: "La satisfaction compte, pas seulement le clic : un Short qui déçoit (titre mensonger) récolte « Pas intéressé » et des « Je n'aime pas ».",
        basis: "official",
        sources: ["ytRecoBlog"],
      },
      {
        text: "Le titre (100 caractères max.) et la description servent aussi à la recherche YouTube : nomme le jeu et le streamer.",
        basis: "usage",
        sources: ["ytUploadShorts"],
      },
    ],
    mistakes: [
      {
        text: "Une chaîne faite uniquement de clips d'autres créateurs, sans apport (commentaire, contexte, montage), peut perdre la monétisation de toute la chaîne pour contenu réutilisé — même avec l'accord du streamer.",
        basis: "official",
        sources: ["ytReused"],
      },
      {
        text: "Titres, miniatures ou hashtags trompeurs : interdits par les règles sur le spam et les pratiques trompeuses.",
        basis: "official",
        sources: ["ytSpam", "ytHashtags"],
      },
      {
        text: "Plus de 60 hashtags : YouTube les ignore tous.",
        basis: "official",
        sources: ["ytHashtags"],
      },
    ],
  },
  {
    id: "youtube",
    title: "Vidéos YouTube classiques — accueil, suggestions, recherche",
    platform: "YOUTUBE",
    summary: "Pour les vidéos horizontales et longues, YouTube s'appuie sur les mêmes signaux, mais le spectateur choisit d'abord de cliquer sur une miniature et un titre. L'accueil se base surtout sur l'historique du spectateur, les « vidéos suivantes » surtout sur la vidéo en cours.",
    signals: [
      {
        text: "Les clics, le temps de visionnage, les enquêtes de satisfaction (seules les vidéos notées 4 ou 5 étoiles comptent comme « temps de visionnage apprécié »), les partages, les « J'aime » et « Je n'aime pas ».",
        basis: "official",
        sources: ["ytRecoBlog"],
      },
      {
        text: "Sur l'accueil, surtout l'historique du spectateur ; à côté d'une vidéo, surtout la vidéo en cours de lecture.",
        basis: "official",
        sources: ["ytRecoHelp"],
      },
      {
        text: "Les contenus limites peuvent être moins recommandés, quels que soient leurs chiffres.",
        basis: "official",
        sources: ["ytRecoBlog"],
      },
    ],
    implications: [
      {
        text: "Un clip vertical de Cliping est un Short, pas une vidéo classique. Une vidéo longue (best-of, récap de la semaine) demande un vrai travail en plus : un fil conducteur, ton commentaire, un montage.",
        basis: "usage",
        sources: ["ytReused"],
      },
      {
        text: "La miniature et le titre doivent promettre exactement ce que la vidéo montre : le clic seul ne suffit pas si le spectateur repart déçu.",
        basis: "official",
        sources: ["ytRecoBlog", "ytSpam"],
      },
    ],
    mistakes: [
      {
        text: "Les compilations de moments mis bout à bout sans narration sont l'exemple que YouTube donne de contenu réutilisé.",
        basis: "official",
        sources: ["ytReused"],
      },
      {
        text: "Une miniature racoleuse sans rapport avec la vidéo : contenu trompeur, et spectateurs déçus.",
        basis: "official",
        sources: ["ytSpam"],
      },
    ],
  },
];

export interface MemoRow {
  label: string;
  tiktok: Point;
  shorts: Point;
}

export const MEMO: MemoRow[] = [
  {
    label: "Durée",
    tiktok: { text: "Pas de durée idéale officielle. Au moins 5 s (en dessous, la vidéo peut ne pas être recommandée). Pour un clip : la durée du moment, sans temps mort.", basis: "official", sources: ["ttRecoSystem"] },
    shorts: { text: "3 minutes maximum, format vertical ou carré. Pas de durée idéale officielle : coupe dès que le moment est fini.", basis: "official", sources: ["ytShorts3min"] },
  },
  {
    label: "Titre / légende",
    tiktok: { text: "Seules les premières lignes s'affichent sans « plus » : l'essentiel au début (qui, quoi, quel jeu) et le crédit du streamer.", basis: "usage" },
    shorts: { text: "Titre de 100 caractères max., description jusqu'à 5 000. Mets le jeu et le streamer dans le titre, le crédit dans la description.", basis: "official", sources: ["ytUploadShorts"] },
  },
  {
    label: "Hashtags",
    tiktok: { text: "Aucun nombre officiel. Quelques tags précis (jeu, streamer, type de moment) plutôt qu'une liste de tags génériques.", basis: "usage" },
    shorts: { text: "Au-delà de 60, YouTube les ignore tous ; tags trompeurs interdits. En pratique, 3 à 5 tags pertinents suffisent.", basis: "official", sources: ["ytHashtags"] },
  },
  {
    label: "Cadence",
    tiktok: { text: "TikTok : la cadence te regarde, mieux vaut un flux régulier de qualité que de se précipiter tous les jours.", basis: "official", sources: ["ttTips"] },
    shorts: { text: "Pas de cadence officielle. La régularité aide ton public à revenir ; ne sacrifie pas la qualité pour le volume.", basis: "usage" },
  },
  {
    label: "Horaires",
    tiktok: { text: "Le meilleur horaire dépend de ton compte : statistiques → Abonnés, une fois que tu as assez d'abonnés.", basis: "official", sources: ["ttBestTime"] },
    shorts: { text: "YouTube Studio → Audience → « Quand vos spectateurs sont sur YouTube », quand la chaîne a assez de données.", basis: "usage" },
  },
  {
    label: "À regarder dans tes stats",
    tiktok: { text: "Temps de visionnage moyen et moment où les spectateurs décrochent (onglet Contenu).", basis: "official", sources: ["ttTips"] },
    shorts: { text: "« Affichées dans le flux » et « Regardées / balayées » pour chaque Short.", basis: "official", sources: ["ytReach"] },
  },
];

export const DIFFERENCES: Point[] = [
  { text: "TikTok peut te proposer des sons en plus de celui du live (en mode brouillon, tu les ajoutes dans l'app). Sur YouTube, une musique protégée peut déclencher une réclamation Content ID.", basis: "usage" },
  { text: "TikTok écarte les vidéos de plus de 90 jours du fil « Pour toi » ; YouTube ne communique pas de limite d'âge équivalente.", basis: "official", sources: ["ttRecoSystem"] },
  { text: "Un Short vit aussi dans l'onglet Shorts de la chaîne et dans la recherche YouTube : un titre clair y est plus utile que sur TikTok.", basis: "usage" },
  { text: "La même vidéo peut aller sur ton compte TikTok et sur ta chaîne YouTube (ce sont deux plateformes) ; ce qui pose problème, c'est la même vidéo sur plusieurs comptes d'une même plateforme.", basis: "usage", sources: ["ttFyf", "ytReused"] },
];

export interface AccountPlanRow {
  account: string;
  angle: string;
  clips: string;
  schedule: string;
}

/** Exemple de répartition, à adapter : les comptes, angles et horaires sont illustratifs. */
export const ACCOUNT_PLAN_EXAMPLE: AccountPlanRow[] = [
  { account: "Compte 1", angle: "Fails et fous rires", clips: "Moments drôles, accidents, bugs", schedule: "Créneau A (ex. fin d'après-midi)" },
  { account: "Compte 2", angle: "Action et poursuites", clips: "Braquages, courses-poursuites, fusillades", schedule: "Créneau B (ex. soirée)" },
  { account: "Compte 3", angle: "Un streamer qui t'a donné son accord", clips: "Uniquement ses lives", schedule: "Après ses lives, quand les moments sont frais" },
];

export const SCALE_RULES: Point[] = [
  { text: "Un clip = un seul compte par plateforme. Cliping refuse déjà de publier deux fois le même clip sur un même compte ; c'est à toi de ne pas le dupliquer sur un autre compte de la même plateforme.", basis: "official", sources: ["ttFyf", "ytReused"] },
  { text: "Donne à chaque compte un angle que le public comprend en voyant trois de ses vidéos : un type de moment, un streamer, une langue. Son nom, sa bio et ses séries suivent cet angle.", basis: "usage" },
  { text: "Trie les clips à la source : au moment d'approuver un clip dans Cliping, décide pour quel compte il est fait. Un clip qui ne colle à aucun angle n'est pas publié.", basis: "usage" },
  { text: "Décale les horaires entre comptes pour pouvoir répondre aux commentaires de chacun dans l'heure qui suit, au lieu de tout publier en même temps.", basis: "usage" },
  { text: "Ne fais jamais interagir tes comptes entre eux comme s'ils étaient des spectateurs (likes croisés, commentaires) : c'est du faux engagement.", basis: "official", sources: ["ttIntegrity", "ytSpam"] },
  { text: "Démarre avec peu de comptes et ajoute-en un quand tu as assez de bons clips pour l'alimenter sans baisser la qualité des autres.", basis: "usage" },
  { text: "Côté technique : chaque compte a ses propres limites (sur TikTok, 5 brouillons en attente par 24 h et par compte via l'API sans audit ; sur YouTube, un quota d'envoi par projet Google). Vérifie-les dans Comptes avant la sortie.", basis: "usage" },
];
