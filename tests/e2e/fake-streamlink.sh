#!/usr/bin/env bash
# Faux streamlink pour les tests de bout en bout : rejoue un fichier local en temps réel
# au lieu de se connecter à Twitch. Piloté par E2E_DIR (dossier contenant stream.mp4).
#   --json     → répond « en live sur Grand Theft Auto VI » tant que $E2E_DIR/live existe
#   --stdout   → envoie stream.mp4 en MPEG-TS, à vitesse réelle, sur la sortie standard
set -euo pipefail
: "${E2E_DIR:?E2E_DIR manquant}"
mode=""
for a in "$@"; do
  case "$a" in
    --json) mode=json ;;
    --stdout) mode=stream ;;
    --version) echo "streamlink 0.0.0-fake"; exit 0 ;;
  esac
done
if [ "$mode" = json ]; then
  if [ -f "$E2E_DIR/live" ]; then
    echo '{"plugin":"twitch","metadata":{"id":"1","author":"TestStreamer","category":"Grand Theft Auto VI","title":"ON DÉCOUVRE GTA 6 !!"},"streams":{"best":{"type":"hls"}}}'
    exit 0
  fi
  echo '{"error":"No playable streams found on this URL: fake"}'
  exit 1
fi
if [ "$mode" = stream ]; then
  date +%s.%N > "$E2E_DIR/started"
  exec ffmpeg -hide_banner -loglevel error -re -i "$E2E_DIR/stream.mp4" -c copy -f mpegts pipe:1
fi
echo "usage: fake-streamlink (--json|--stdout) URL" >&2
exit 2
