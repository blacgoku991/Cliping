#!/usr/bin/env bash
# Installe le service de transcription local des sous-titres (faster-whisper, gratuit, sans clé d'API).
#   scripts/whisper-setup.sh         installe dans /opt/whisper (WHISPER_VENV pour changer)
# Le modèle (~1,6 Go) est téléchargé au premier lancement de scripts/whisper-server.py ;
# scripts/dev-up.sh reel démarre le service tout seul quand il est installé.
set -euo pipefail
export PATH="$PATH:$HOME/.local/bin"
VENV="${WHISPER_VENV:-/opt/whisper}"
if command -v uv >/dev/null 2>&1; then
  [ -x "$VENV/bin/python" ] || uv venv --quiet "$VENV"
  uv pip install --quiet --python "$VENV/bin/python" "faster-whisper>=1.2,<2" numpy
else
  [ -x "$VENV/bin/python" ] || python3 -m venv "$VENV"
  "$VENV/bin/python" -m pip install --quiet "faster-whisper>=1.2,<2" numpy
fi
echo "transcription locale installée dans $VENV"
