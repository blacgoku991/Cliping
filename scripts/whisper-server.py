"""Service de transcription local pour les sous-titres de Cliping (gratuit, sans clé d'API).

Expose la même route que l'API d'OpenAI, POST /v1/audio/transcriptions (multipart : file, language…),
et renvoie les mots horodatés : Cliping s'en sert comme de n'importe quel fournisseur compatible.
Réglages dans .env :  TRANSCRIBE_API_URL="http://127.0.0.1:8770/v1"  TRANSCRIBE_API_KEY="local"

Variables :
  WHISPER_MODEL    modèle faster-whisper (défaut large-v3-turbo : ~5 s pour 1 min d'audio sur 4 cœurs)
  WHISPER_HOST     adresse d'écoute (défaut 127.0.0.1 ; 0.0.0.0 dans Docker)
  WHISPER_PORT     port (défaut 8770)
  WHISPER_THREADS  cœurs utilisés (défaut 4)

Dépendances : faster-whisper, numpy, et ffmpeg dans le PATH. Le modèle (~1,6 Go) est téléchargé au premier lancement.
"""

import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
from email.parser import BytesParser
from email.policy import default as default_policy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
from faster_whisper import WhisperModel

MODEL_NAME = os.environ.get("WHISPER_MODEL", "large-v3-turbo")
HOST = os.environ.get("WHISPER_HOST", "127.0.0.1")
PORT = int(os.environ.get("WHISPER_PORT", "8770"))
THREADS = int(os.environ.get("WHISPER_THREADS", "4"))
MAX_UPLOAD = 100 * 1024 * 1024

model: WhisperModel | None = None
lock = threading.Lock()


def log(msg: str) -> None:
    print(f"{time.strftime('%H:%M:%S')} [whisper] {msg}", flush=True)


def decode(data: bytes) -> np.ndarray:
    """N'importe quel format audio/vidéo → PCM 16 kHz mono, via ffmpeg (PyAV n'est pas utilisé).

    Passe par un fichier temporaire : un .m4a a souvent son index en fin de fichier, illisible depuis un tuyau.
    """
    with tempfile.NamedTemporaryFile(suffix=".audio") as tmp:
        tmp.write(data)
        tmp.flush()
        proc = subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", tmp.name, "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "pipe:1"],
            capture_output=True,
            timeout=300,
        )
    if proc.returncode != 0:
        raise ValueError("audio illisible : " + proc.stderr.decode(errors="replace")[-300:])
    return np.frombuffer(proc.stdout, dtype=np.int16).astype(np.float32) / 32768.0


# Phrases que Whisper invente sur du silence ou de la musique (génériques de sous-titrage vus à l'entraînement).
HALLUCINATIONS = re.compile(
    r"amara\.org|sous-titr|merci d'avoir regard|abonnez-vous|n'oubliez pas de (vous abonner|liker)|thanks for watching|subtitles by",
    re.IGNORECASE,
)


def merge_words(raw):
    """Whisper découpe « l'ai » en « l » + « 'ai » : un morceau sans espace devant se recolle au mot précédent."""
    words = []
    for w in raw:
        text = w.word
        if words and text and not text[0].isspace():
            prev = words[-1]
            prev["word"] += text
            prev["end"] = round(w.end, 3)
            continue
        if text.strip():
            words.append({"word": text.strip(), "start": round(w.start, 3), "end": round(w.end, 3)})
    return words


def transcribe(data: bytes, language: str | None) -> dict:
    audio = decode(data)
    with lock:  # un seul calcul à la fois : le modèle occupe déjà tous les cœurs prévus
        segments, info = model.transcribe(
            audio,
            language=language or None,
            word_timestamps=True,
            vad_filter=True,
            beam_size=5,
            condition_on_previous_text=False,
        )
        segments = [s for s in segments if not HALLUCINATIONS.search(s.text)]
    raw = [w for s in segments for w in (s.words or [])]
    return {
        "text": " ".join(s.text.strip() for s in segments).strip(),
        "language": info.language,
        "duration": round(info.duration, 3),
        "words": merge_words(raw),
        "segments": [{"text": s.text.strip(), "start": round(s.start, 3), "end": round(s.end, 3)} for s in segments],
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "cliping-whisper"

    def log_message(self, fmt, *args):  # journal maison, plus court
        pass

    def reply(self, status: int, body: dict) -> None:
        payload = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path.rstrip("/") in ("", "/health", "/v1/models"):
            return self.reply(200, {"ok": True, "model": MODEL_NAME})
        self.reply(404, {"error": {"message": "introuvable"}})

    def do_POST(self):
        if self.path.rstrip("/") not in ("/v1/audio/transcriptions", "/audio/transcriptions"):
            return self.reply(404, {"error": {"message": "introuvable"}})
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_UPLOAD:
            return self.reply(413, {"error": {"message": "fichier absent ou trop gros"}})
        body = self.rfile.read(length)
        ctype = self.headers.get("Content-Type", "")
        msg = BytesParser(policy=default_policy).parsebytes(b"Content-Type: " + ctype.encode() + b"\r\n\r\n" + body)
        fields, audio = {}, None
        if msg.is_multipart():
            for part in msg.iter_parts():
                name = part.get_param("name", header="content-disposition")
                if name == "file":
                    audio = part.get_payload(decode=True)
                elif name:
                    fields[name] = (part.get_payload(decode=True) or b"").decode(errors="replace")
        if not audio:
            return self.reply(400, {"error": {"message": "champ « file » manquant"}})
        started = time.time()
        try:
            result = transcribe(audio, fields.get("language"))
        except Exception as err:  # renvoyé à Cliping, qui monte alors le clip sans sous-titres
            log(f"échec : {err}")
            return self.reply(500, {"error": {"message": str(err)[:300]}})
        log(f"{result['duration']:.0f} s d'audio transcrites en {time.time() - started:.1f} s ({len(result['words'])} mots)")
        self.reply(200, result)


def main() -> int:
    global model
    log(f"chargement du modèle {MODEL_NAME}…")
    model = WhisperModel(MODEL_NAME, device="cpu", compute_type="int8", cpu_threads=THREADS)
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    log(f"prêt sur http://{HOST}:{PORT}/v1")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
