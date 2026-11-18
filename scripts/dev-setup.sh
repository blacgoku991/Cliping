#!/usr/bin/env bash
# Prépare un environnement de développement complet dans un conteneur vierge :
# Postgres local, dépendances, base migrée, outils vidéo, compte de démo et faux live de test.
# Idempotent : peut être relancé sans risque.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$PATH:$HOME/.local/bin"
E2E_DIR="${E2E_DIR:-/tmp/cliping-e2e}"

echo "▸ Postgres"
if command -v pg_ctlcluster >/dev/null 2>&1; then
  pg_ctlcluster 16 main start 2>/dev/null || true
  sleep 2
  su postgres -c "psql -tAc \"select 1 from pg_roles where rolname='cliping'\"" | grep -q 1 \
    || su postgres -c "psql -qc \"create user cliping with password 'cliping' createdb\""
  su postgres -c "psql -tAc \"select 1 from pg_database where datname='cliping'\"" | grep -q 1 \
    || su postgres -c "psql -qc \"create database cliping owner cliping\""
else
  echo "  pg_ctlcluster introuvable : démarre Postgres toi-même et vérifie DATABASE_URL dans .env"
fi

echo "▸ .env"
if [ ! -f .env ]; then
  cat > .env <<ENV
DATABASE_URL="postgresql://cliping:cliping@localhost:5432/cliping"
APP_URL="http://localhost:3000"
ENCRYPTION_KEY="dev-only-key-change-me-0123456789abcdef"
DATA_DIR="./data"
ENV
fi

echo "▸ Dépendances et base"
[ -d node_modules ] || npm ci
npx prisma migrate deploy >/dev/null
npx prisma generate >/dev/null

echo "▸ Outils vidéo"
command -v ffmpeg >/dev/null || echo "  ⚠ ffmpeg manquant"
if command -v uv >/dev/null 2>&1; then
  command -v streamlink >/dev/null || uv tool install streamlink >/dev/null 2>&1 || true
  command -v yt-dlp >/dev/null || uv tool install yt-dlp >/dev/null 2>&1 || true
fi

echo "▸ Faux live de test ($E2E_DIR/stream.mp4)"
mkdir -p "$E2E_DIR"
if [ ! -f "$E2E_DIR/stream.mp4" ]; then
  FONT=$(fc-match -f '%{file}' 'Inter:bold' 2>/dev/null || true)
  # 4 minutes : mire + chrono incrusté + bruit de fond, avec deux « moments forts » (70–78 s et 160–169 s)
  ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "testsrc2=size=1280x720:rate=30:duration=240" \
    -f lavfi -i "anoisesrc=color=pink:amplitude=0.5:duration=240:sample_rate=48000" \
    -filter_complex "[0:v]drawtext=fontfile=${FONT}:text='%{pts\:hms}':fontsize=64:fontcolor=white:box=1:boxcolor=black@0.6:x=40:y=40,negate=enable='between(mod(t\,0.5)\,0\,0.25)*(between(t\,70\,78)+between(t\,160\,169))',drawbox=x=960:y=40:w=280:h=200:color=0x9146FF:t=fill[v];[1:a]tremolo=f=3:d=0.6,volume='if(between(t,70,78)+between(t,160,169),1.0,0.10)':eval=frame,pan=stereo|c0=c0|c1=c0[a]" \
    -map "[v]" -map "[a]" -c:v libx264 -preset ultrafast -crf 23 -g 60 -keyint_min 60 -pix_fmt yuv420p -c:a aac -b:a 128k "$E2E_DIR/stream.mp4"
fi

echo "▸ Compte de démo"
npm run -s demo:seed

echo "✔ Prêt. Lance ensuite : scripts/dev-up.sh"
