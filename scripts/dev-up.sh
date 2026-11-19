#!/usr/bin/env bash
# Lance tout l'environnement de test en arrière-plan : faux services (chat Twitch + transcription),
# worker branché sur le faux streamlink, et le site (next dev) sur http://localhost:3000.
#   scripts/dev-up.sh          démarre (ou redémarre) tout
#   scripts/dev-up.sh live     idem, et fait « passer en live » la chaîne de démo (4 minutes de flux)
#   scripts/dev-up.sh reel     capte de VRAIS lives (chaînes suivies du compte), sans faux services
#   scripts/dev-up.sh stop     arrête tout
set -uo pipefail
cd "$(dirname "$0")/.."
export PATH="$PATH:$HOME/.local/bin"
export E2E_DIR="${E2E_DIR:-/tmp/cliping-e2e}"
LOGS="$E2E_DIR/logs"; mkdir -p "$LOGS"

stop_all() {
  # « next dev »/« next start » se renomment en next-server : il faut viser ce nom-là.
  pkill -f "next-server" 2>/dev/null; pkill -f "next dev" 2>/dev/null
  pkill -f "src/worker/index.ts" 2>/dev/null; pkill -f "tests/e2e/mock-services.mjs" 2>/dev/null
  sleep 2
}

stop_all
[ "${1:-}" = "stop" ] && { pkill -f "scripts/whisper-server.py" 2>/dev/null; rm -f "$E2E_DIR/live"; echo "arrêté"; exit 0; }

rm -f "$E2E_DIR/started" "$E2E_DIR/live"
[ "${1:-}" = "live" ] && touch "$E2E_DIR/live"

if [ "${1:-}" = "reel" ]; then
  # Vrais lives : vrais streamlink / yt-dlp, vrai chat Twitch, pas de fausse transcription.
  # Derrière un proxy HTTPS (environnement cloud), Node ne l'utilise que si on le lui demande.
  [ -n "${HTTPS_PROXY:-}" ] && export NODE_USE_ENV_PROXY=1 NODE_NO_WARNINGS=1
  # Sous-titres : service de transcription local (scripts/whisper-setup.sh), gardé allumé d'un redémarrage à l'autre
  # (le modèle met une vingtaine de secondes à se charger). Une clé de transcription réglée dans .env reste prioritaire.
  WHISPER_PY="${WHISPER_VENV:-/opt/whisper}/bin/python"
  if [ -x "$WHISPER_PY" ] && ! grep -q '^TRANSCRIBE_API_URL=' .env 2>/dev/null; then
    if ! curl -s -m 2 --noproxy '*' -o /dev/null http://127.0.0.1:8770/health; then
      nohup "$WHISPER_PY" scripts/whisper-server.py > "$LOGS/whisper.log" 2>&1 &
      for _ in $(seq 1 90); do curl -s -m 2 --noproxy '*' -o /dev/null http://127.0.0.1:8770/health && break; sleep 1; done
    fi
    export TRANSCRIBE_API_URL=http://127.0.0.1:8770/v1 TRANSCRIBE_API_KEY=local TRANSCRIBE_MODEL=large-v3-turbo
  fi
  MONITOR_INTERVAL_SEC=30 nohup npx tsx --env-file=.env src/worker/index.ts > "$LOGS/worker.log" 2>&1 &
else
  nohup node tests/e2e/mock-services.mjs > "$LOGS/mock.log" 2>&1 &
  STREAMLINK_BIN="$PWD/tests/e2e/fake-streamlink.sh" TWITCH_VIA_YTDLP=false TWITCH_IRC_URL=ws://127.0.0.1:8765 \
  TRANSCRIBE_API_URL=http://127.0.0.1:8765 TRANSCRIBE_API_KEY=test MONITOR_INTERVAL_SEC=10 \
    nohup npx tsx --env-file=.env src/worker/index.ts > "$LOGS/worker.log" 2>&1 &
fi
nohup npx next dev -p 3000 > "$LOGS/web.log" 2>&1 &

for _ in $(seq 1 40); do
  curl -s -o /dev/null http://127.0.0.1:3000/login && break
  sleep 1
done
echo "site    : http://localhost:3000  (demo@cliping.local / demo-cliping-2026)"
echo "journaux: $LOGS/{web,worker,mock,whisper}.log"
[ -f "$E2E_DIR/live" ] && echo "live    : la chaîne de démo est en live ; premier clip ~100 s après le début"
exit 0
