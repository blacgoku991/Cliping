#!/usr/bin/env bash
# Installe Cliping sur un serveur neuf (Ubuntu 24.04), avec HTTPS automatique, en une commande :
#
#   curl -fsSL https://raw.githubusercontent.com/blacgoku991/Cliping/claude/gifted-mayer-f5vxyz/scripts/install-serveur.sh \
#     | sudo bash -s -- clips.mondomaine.fr
#
# Avant : le nom de domaine doit pointer vers l'adresse IP du serveur (enregistrement DNS de type A).
# Après : ouvre https://clips.mondomaine.fr, crée ton compte, puis ferme les inscriptions :
#   sudo bash /opt/cliping/scripts/install-serveur.sh --fermer-inscriptions
#
# Relancer la commande d'installation met Cliping à jour (les secrets et les données sont gardés).
set -euo pipefail

REPO="${CLIPING_REPO:-https://github.com/blacgoku991/Cliping.git}"
BRANCH="${CLIPING_BRANCH:-claude/gifted-mayer-f5vxyz}"
DIR="${CLIPING_DIR:-/opt/cliping}"
DRY="${CLIPING_DRY_RUN:-}"   # pour les tests : prépare .env sans installer ni lancer Docker

say() { printf '\n\033[1;35m▸ %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

# Écrit (ou remplace) une ligne CLE="valeur" dans .env.
set_env() {
  local key="$1" value="$2" file="$DIR/.env"
  if grep -qE "^#? ?${key}=" "$file"; then
    sed -i -E "s|^#? ?${key}=.*|${key}=\"${value}\"|" "$file"
  else
    printf '%s="%s"\n' "$key" "$value" >> "$file"
  fi
}

compose() { (cd "$DIR" && docker compose --profile https "$@"); }

if [ "${1:-}" = "--fermer-inscriptions" ]; then
  [ -f "$DIR/.env" ] || die "Cliping n'est pas installé dans $DIR."
  set_env ALLOW_SIGNUP false
  [ -n "$DRY" ] || compose up -d web
  say "Inscriptions fermées : seul ton compte peut se connecter."
  exit 0
fi

DOMAIN="${1:-}"
[ -n "$DOMAIN" ] || die "Indique ton nom de domaine, par exemple : … | sudo bash -s -- clips.mondomaine.fr"
printf '%s' "$DOMAIN" | grep -qE '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' \
  || die "« $DOMAIN » ne ressemble pas à un nom de domaine (exemple : clips.mondomaine.fr, sans https://)."
[ -n "$DRY" ] || [ "$(id -u)" -eq 0 ] || die "Lance la commande avec sudo."

if [ -z "$DRY" ]; then
  say "Docker"
  if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
    apt-get update -q
    apt-get install -y -q docker.io docker-compose-v2 git openssl
    systemctl enable --now docker
  fi
  command -v git >/dev/null 2>&1 || apt-get install -y -q git

  say "Code de Cliping ($BRANCH)"
  if [ -d "$DIR/.git" ]; then
    git -C "$DIR" fetch -q origin "$BRANCH" && git -C "$DIR" checkout -q -B "$BRANCH" "origin/$BRANCH"
  else
    git clone -q --branch "$BRANCH" "$REPO" "$DIR"
  fi
fi

say "Réglages (.env)"
if [ ! -f "$DIR/.env" ]; then
  cp "$DIR/.env.example" "$DIR/.env"
  # Secrets tirés au hasard sur le serveur : ils n'apparaissent nulle part ailleurs.
  set_env ENCRYPTION_KEY "$(openssl rand -base64 32)"
  set_env POSTGRES_PASSWORD "$(openssl rand -hex 24)"
  set_env ALLOW_SIGNUP true
  echo "  secrets générés"
fi
set_env APP_URL "https://$DOMAIN"
set_env DOMAIN "$DOMAIN"
chmod 600 "$DIR/.env"

if [ -n "$DRY" ]; then
  say "Essai à blanc : .env prêt dans $DIR, Docker non lancé."
  exit 0
fi

say "Construction et démarrage (5 à 10 minutes la première fois)"
compose up -d --build

say "Vérification"
for _ in $(seq 1 60); do
  curl -fsS -o /dev/null "http://127.0.0.1:${WEB_PORT:-3000}/login" && break
  sleep 5
done
compose ps

cat <<EOF

✔ Cliping tourne.
  1. Ouvre https://$DOMAIN et crée ton compte (email + mot de passe de ton choix).
     Le certificat HTTPS peut mettre une minute à arriver la première fois.
  2. Ferme les inscriptions :   sudo bash $DIR/scripts/install-serveur.sh --fermer-inscriptions
  3. Ajoute les chaînes GTA 6 FR déjà préparées (webcams placées) :
       cd $DIR && sudo docker compose exec worker node_modules/.bin/tsx scripts/import-chaines.ts ton@email.fr
  4. Pour connecter YouTube et TikTok, suis la page Comptes du site.
  Journaux du bot :   cd $DIR && sudo docker compose logs -f worker
EOF
