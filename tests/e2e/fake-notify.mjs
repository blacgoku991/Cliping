// Faux récepteurs de notifications pour le banc d'essai (port 4100) :
//  - POST /push/<id>   : faux service Web Push. Déchiffre la charge utile (RFC 8291) avec les clés de l'abonné
//                         gardées dans $E2E_DIR/push-keys.json, vérifie l'en-tête VAPID, et note le message.
//                         /push/gone répond 410 (abonnement expiré).
//  - POST /            : faux serveur ntfy (publication JSON).
// Chaque réception est ajoutée à $E2E_DIR/logs/notify-received.jsonl.
// Lancement : node tests/e2e/fake-notify.mjs   (ou « keys » pour générer un abonné et afficher son abonnement)
import { createDecipheriv, createECDH, createHmac, randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";

const DIR = process.env.E2E_DIR ?? "/tmp/cliping-e2e";
const KEYS = `${DIR}/push-keys.json`;
const OUT = `${DIR}/logs/notify-received.jsonl`;
mkdirSync(`${DIR}/logs`, { recursive: true });

if (process.argv[2] === "keys") {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  writeFileSync(KEYS, JSON.stringify({ priv: ecdh.getPrivateKey("base64url"), pub: ecdh.getPublicKey("base64url"), auth: auth.toString("base64url") }));
  console.log(JSON.stringify({ endpoint: "http://127.0.0.1:4100/push/e2e", keys: { p256dh: ecdh.getPublicKey("base64url"), auth: auth.toString("base64url") } }));
  process.exit(0);
}

function hkdf(salt, ikm, info, len) {
  const prk = createHmac("sha256", salt).update(ikm).digest();
  return createHmac("sha256", prk).update(Buffer.concat([info, Buffer.from([1])])).digest().subarray(0, len);
}

function decryptPush(body) {
  const k = JSON.parse(readFileSync(KEYS, "utf8"));
  const ua = createECDH("prime256v1");
  ua.setPrivateKey(Buffer.from(k.priv, "base64url"));
  const uaPub = Buffer.from(k.pub, "base64url");
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPub = body.subarray(21, 21 + idlen);
  const cipher = body.subarray(21 + idlen);
  const ikm = hkdf(Buffer.from(k.auth, "base64url"), ua.computeSecret(asPub), Buffer.concat([Buffer.from("WebPush: info\0"), uaPub, asPub]), 32);
  const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);
  const d = createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(cipher.subarray(cipher.length - 16));
  const plain = Buffer.concat([d.update(cipher.subarray(0, cipher.length - 16)), d.final()]);
  return JSON.parse(plain.subarray(0, plain.lastIndexOf(2)).toString("utf8"));
}

http
  .createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const at = new Date().toISOString();
      try {
        if (req.url === "/push/gone") {
          res.writeHead(410).end();
          appendFileSync(OUT, JSON.stringify({ at, channel: "webpush", gone: true }) + "\n");
          return;
        }
        if (req.url?.startsWith("/push/")) {
          const auth = String(req.headers.authorization ?? "");
          const m = /^vapid t=([^.]+\.([^.]+)\.[^,]+), k=(.+)$/.exec(auth);
          if (!m || req.headers["content-encoding"] !== "aes128gcm" || !req.headers.ttl) {
            res.writeHead(400).end("BadWebPushRequest");
            return;
          }
          const claims = JSON.parse(Buffer.from(m[2], "base64url").toString());
          const msg = decryptPush(body);
          appendFileSync(OUT, JSON.stringify({ at, channel: "webpush", urgency: req.headers.urgency, aud: claims.aud, sub: claims.sub, msg }) + "\n");
          res.writeHead(201).end();
          return;
        }
        if (req.url === "/") {
          const msg = JSON.parse(body.toString("utf8"));
          appendFileSync(OUT, JSON.stringify({ at, channel: "ntfy", msg }) + "\n");
          res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ id: "x", event: "message" }));
          return;
        }
        res.writeHead(404).end();
      } catch (err) {
        appendFileSync(OUT, JSON.stringify({ at, error: String(err) }) + "\n");
        res.writeHead(400).end(String(err));
      }
    });
  })
  .listen(4100, "127.0.0.1", () => console.log("faux récepteurs de notifications sur :4100"));
