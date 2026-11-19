"""Lit un flux Twitch à partir de l'adresse de sa liste de lecture et l'écrit sur la sortie standard,
sans les coupures publicitaires.

Utilisé quand l'adresse vient de yt-dlp (voir twitch-ytdlp.ts) : on réutilise le lecteur Twitch de streamlink,
qui reconnaît et retire les segments de pub, sans passer par sa détection des flux (cassée depuis le changement
de format de Twitch). Lancé avec l'interpréteur Python de streamlink.

Usage : python twitch-hls.py <adresse .m3u8>
"""

import sys

from streamlink import Streamlink
from streamlink.plugins.twitch import TwitchHLSStream


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: twitch-hls.py <url.m3u8>", file=sys.stderr)
        return 2
    session = Streamlink()
    stream = TwitchHLSStream(session, sys.argv[1])
    out = sys.stdout.buffer
    fd = stream.open()
    try:
        while True:
            data = fd.read(65536)
            if not data:
                break
            out.write(data)
            out.flush()
    except (BrokenPipeError, KeyboardInterrupt):
        pass
    finally:
        fd.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
