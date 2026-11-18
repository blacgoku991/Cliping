/**
 * Sources citées dans la page « Conseils ». Chaque conseil renvoie à une ou plusieurs de ces entrées.
 * `official` = page publiée par la plateforme elle-même (aide, règles, blog officiel).
 * Consultées le 18 novembre 2026 : les plateformes modifient régulièrement ces pages.
 */
export interface Source {
  id: string;
  label: string;
  publisher: "YouTube" | "TikTok" | "Rockstar Games";
  url: string;
  official: boolean;
}

export const SOURCES_CHECKED_ON = "18 novembre 2026";

export const SOURCES = {
  ytShorts3min: {
    id: "ytShorts3min",
    label: "Aide YouTube — Comprendre les Shorts de trois minutes",
    publisher: "YouTube",
    url: "https://support.google.com/youtube/answer/15424877",
    official: true,
  },
  ytUploadShorts: {
    id: "ytUploadShorts",
    label: "Aide YouTube — Mettre en ligne des Shorts (titre de 100 caractères max.)",
    publisher: "YouTube",
    url: "https://support.google.com/youtube/answer/12779649",
    official: true,
  },
  ytShortsGuide: {
    id: "ytShortsGuide",
    label: "Blog YouTube — Your guide to getting started with YouTube Shorts",
    publisher: "YouTube",
    url: "https://blog.youtube/creator-and-artist-stories/your-guide-to-getting-started-with-youtube-shorts/",
    official: true,
  },
  ytHashtags: {
    id: "ytHashtags",
    label: "Aide YouTube — Règles relatives aux hashtags",
    publisher: "YouTube",
    url: "https://support.google.com/youtube/answer/6390658",
    official: true,
  },
  ytSpam: {
    id: "ytSpam",
    label: "Aide YouTube — Règles sur le spam, les pratiques trompeuses et les escroqueries",
    publisher: "YouTube",
    url: "https://support.google.com/youtube/answer/2801973",
    official: true,
  },
  ytReused: {
    id: "ytReused",
    label: "Aide YouTube — Règles de monétisation des chaînes (contenu réutilisé)",
    publisher: "YouTube",
    url: "https://support.google.com/youtube/answer/1311392",
    official: true,
  },
  ytComments: {
    id: "ytComments",
    label: "Aide YouTube — Publier des commentaires et interagir (épingler un commentaire)",
    publisher: "YouTube",
    url: "https://support.google.com/youtube/answer/6000964",
    official: true,
  },
  ytHandles: {
    id: "ytHandles",
    label: "Aide YouTube — Présentation des identifiants (@handle)",
    publisher: "YouTube",
    url: "https://support.google.com/youtube/answer/11585688",
    official: true,
  },
  ttTips: {
    id: "ttTips",
    label: "TikTok Creator Academy — 8 tips for becoming a successful TikTok creator",
    publisher: "TikTok",
    url: "https://www.tiktok.com/creator-academy/en/article/8-tips-for-becoming-a-successful-TikTok-creator",
    official: true,
  },
  ttOriginality: {
    id: "ttOriginality",
    label: "TikTok Creator Academy — Politique d'originalité",
    publisher: "TikTok",
    url: "https://www.tiktok.com/creator-academy/article/tiktok-originality-policy",
    official: true,
  },
  ttFyf: {
    id: "ttFyf",
    label: "Règles TikTok — Critères d'éligibilité au fil « Pour toi »",
    publisher: "TikTok",
    url: "https://www.tiktok.com/safety/en/policies-and-engagement/fyf-standards",
    official: true,
  },
  ttIntegrity: {
    id: "ttIntegrity",
    label: "Règles TikTok — Intégrité et authenticité (faux engagement, spam)",
    publisher: "TikTok",
    url: "https://www.tiktok.com/safety/en/policies-and-engagement/integrity-authenticity",
    official: true,
  },
  ttUsername: {
    id: "ttUsername",
    label: "Assistance TikTok — Changer de nom d'utilisateur (une fois tous les 30 jours)",
    publisher: "TikTok",
    url: "https://support.tiktok.com/en/getting-started/setting-up-your-profile/changing-your-username",
    official: true,
  },
  ttComments: {
    id: "ttComments",
    label: "Assistance TikTok — Gérer les commentaires (filtres)",
    publisher: "TikTok",
    url: "https://support.tiktok.com/en/account-and-privacy/account-privacy-settings/manage-comments",
    official: true,
  },
  ttBestTime: {
    id: "ttBestTime",
    label: "TikTok for Business — Le meilleur moment pour publier dépend de chaque compte",
    publisher: "TikTok",
    url: "https://ads.tiktok.com/business/en-US/blog/how-to-use-content-scheduling-platform",
    official: true,
  },
  rockstar: {
    id: "rockstar",
    label: "Rockstar Games — site officiel (date de sortie et annonces)",
    publisher: "Rockstar Games",
    url: "https://www.rockstargames.com/VI",
    official: true,
  },
} as const satisfies Record<string, Source>;

export type SourceId = keyof typeof SOURCES;
