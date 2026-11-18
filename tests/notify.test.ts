import { createDecipheriv, createECDH, createHmac, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import webpush from "web-push";
import { DEFAULT_PREFS, groupMessage, parsePrefs, planDispatch, type PendingEvent } from "@/lib/notify-plan";
import { isAllowedPushEndpoint, parseDiscordWebhook, parseNtfyTarget } from "@/lib/notify/targets";

const MIN = 60_000;
// 2026-12-01 15:00 à Paris
const NOW = Date.UTC(2026, 11, 1, 14, 0, 0);
const prefs = { ...DEFAULT_PREFS, tz: "Europe/Paris" };

function ev(id: string, type: PendingEvent["type"] = "clipReady", at = NOW - MIN): PendingEvent {
  return { id, type, title: `t-${id}`, body: `b-${id}`, url: `/u/${id}`, createdAt: at };
}

describe("notifications : regroupement et silence", () => {
  it("le premier événement part tout de suite, tel quel", () => {
    const p = planDispatch({ pending: [ev("1")], prefs, lastSentAt: null, now: NOW });
    expect(p.send).toHaveLength(1);
    expect(p.send[0]).toMatchObject({ title: "t-1", body: "b-1", url: "/u/1", ids: ["1"] });
  });

  it("pendant la fenêtre de regroupement, on attend", () => {
    const p = planDispatch({ pending: [ev("1"), ev("2")], prefs, lastSentAt: NOW - 3 * MIN, now: NOW });
    expect(p.send).toEqual([]);
    expect(p.waitReason).toBe("grouping");
  });

  it("vingt clips d'un live agité → un seul message", () => {
    const pending = Array.from({ length: 20 }, (_, i) => ev(String(i)));
    const p = planDispatch({ pending, prefs, lastSentAt: NOW - 11 * MIN, now: NOW });
    expect(p.send).toHaveLength(1);
    expect(p.send[0]!.title).toBe("20 clips prêts à valider");
    expect(p.send[0]!.ids).toHaveLength(20);
    expect(p.send[0]!.body).toMatch(/et 17 autres/);
  });

  it("un message par type, et un seul résumé au-delà de trois types", () => {
    const three = planDispatch({ pending: [ev("1"), ev("2", "publishFailed"), ev("3", "accountInvalid")], prefs, lastSentAt: null, now: NOW });
    expect(three.send).toHaveLength(3);
    const four = planDispatch({ pending: [ev("1"), ev("2", "publishFailed"), ev("3", "accountInvalid"), ev("4", "autopilot")], prefs, lastSentAt: null, now: NOW });
    expect(four.send).toHaveLength(1);
    expect(four.send[0]!.ids.sort()).toEqual(["1", "2", "3", "4"]);
  });

  it("heures de silence : rien ne part, tout reste en attente", () => {
    const night = Date.UTC(2026, 11, 1, 2, 0, 0); // 3 h à Paris, silence 1 h – 8 h
    const p = planDispatch({ pending: [ev("1", "publishFailed", night - MIN)], prefs, lastSentAt: null, now: night });
    expect(p.send).toEqual([]);
    expect(p.waitReason).toBe("quiet");
  });

  it("types désactivés : abandonnés ; les tests passent toujours", () => {
    const off = { ...prefs, types: { ...prefs.types, clipReady: false } };
    const p = planDispatch({ pending: [ev("1"), ev("t", "test")], prefs: off, lastSentAt: NOW - MIN, now: NOW });
    expect(p.skip).toEqual(["1"]);
    expect(p.send.map((m) => m.ids)).toEqual([["t"]]);
  });

  it("préférences bornées", () => {
    const p = parsePrefs({ groupMin: 9999, digestHour: 40, quiet: { from: 5, to: 5 }, tz: "Nope/Nope", types: { clipReady: false } });
    expect(p.groupMin).toBe(180);
    expect(p.digestHour).toBe(23);
    expect(p.quiet).toBeNull();
    expect(p.tz).toBe("Europe/Paris");
    expect(p.types.clipReady).toBe(false);
    expect(p.types.publishFailed).toBe(true);
  });

  it("message groupé : lien vers la page de la liste", () => {
    expect(groupMessage("publishFailed", [ev("1", "publishFailed"), ev("2", "publishFailed")]).url).toBe("/app/queue");
  });
});

describe("notifications : adresses autorisées (anti-SSRF)", () => {
  afterEach(() => {
    delete process.env.NOTIFY_EXTRA_HOSTS;
  });

  it("Web Push : seulement les services de push connus, en https", () => {
    expect(isAllowedPushEndpoint("https://web.push.apple.com/QGuQyavXutnMH")).toBe(true);
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isAllowedPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true);
    expect(isAllowedPushEndpoint("https://wns2-par02p.notify.windows.com/w/?token=x")).toBe(true);
    expect(isAllowedPushEndpoint("http://web.push.apple.com/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://web.push.apple.com:8443/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://evil.com/web.push.apple.com")).toBe(false);
    expect(isAllowedPushEndpoint("https://push.apple.com.evil.com/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://169.254.169.254/latest")).toBe(false);
    expect(isAllowedPushEndpoint("https://user:pw@fcm.googleapis.com/x")).toBe(false);
    expect(isAllowedPushEndpoint("http://localhost:4000/push")).toBe(false);
    process.env.NOTIFY_EXTRA_HOSTS = "localhost:4000";
    expect(isAllowedPushEndpoint("http://localhost:4000/push")).toBe(true);
    expect(isAllowedPushEndpoint("http://localhost:4001/push")).toBe(false);
  });

  it("ntfy : sujet seul ou lien ntfy.sh, rien d'autre", () => {
    expect(parseNtfyTarget("cliping-x8k2m9q4z7")).toEqual({ server: "https://ntfy.sh", topic: "cliping-x8k2m9q4z7" });
    expect(parseNtfyTarget("https://ntfy.sh/cliping-x8k2m9q4z7")).toEqual({ server: "https://ntfy.sh", topic: "cliping-x8k2m9q4z7" });
    expect(parseNtfyTarget("court")).toHaveProperty("error");
    expect(parseNtfyTarget("https://internal.lan/cliping-x8k2m9q4z7")).toHaveProperty("error");
    expect(parseNtfyTarget("http://ntfy.sh/cliping-x8k2m9q4z7")).toHaveProperty("error");
    expect(parseNtfyTarget("https://ntfy.sh/a/b")).toHaveProperty("error");
    expect(parseNtfyTarget("https://10.0.0.1/cliping-x8k2m9q4z7")).toHaveProperty("error");
    process.env.NOTIFY_EXTRA_HOSTS = "ntfy.maison.fr";
    expect(parseNtfyTarget("https://ntfy.maison.fr/alertes")).toEqual({ server: "https://ntfy.maison.fr", topic: "alertes" });
  });

  it("Discord : seulement un webhook discord.com complet", () => {
    const ok = "https://discord.com/api/webhooks/123456789012345678/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcdefgh";
    expect(parseDiscordWebhook(ok)).toEqual({ url: ok });
    expect(parseDiscordWebhook(ok.replace("discord.com", "discordapp.com"))).toEqual({ url: ok });
    expect(parseDiscordWebhook(ok.replace("discord.com", "discord.com.evil.io"))).toHaveProperty("error");
    expect(parseDiscordWebhook("https://discord.com/api/users/@me")).toHaveProperty("error");
    expect(parseDiscordWebhook(ok.replace("https", "http"))).toHaveProperty("error");
  });
});

/**
 * Chiffrement Web Push (RFC 8291, aes128gcm) : on joue le rôle du navigateur — génération des clés
 * d'abonnement, puis déchiffrement de ce que produit la bibliothèque — pour vérifier que la charge utile
 * arrive intacte et que l'en-tête VAPID est bien formé (RFC 8292).
 */
describe("Web Push : chiffrement et signature VAPID", () => {
  function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, len: number): Buffer {
    const prk = createHmac("sha256", salt).update(ikm).digest();
    return createHmac("sha256", prk).update(Buffer.concat([info, Buffer.from([1])])).digest().subarray(0, len);
  }

  it("la charge utile chiffrée se déchiffre avec les clés de l'abonné", () => {
    const ua = createECDH("prime256v1");
    ua.generateKeys();
    const auth = randomBytes(16);
    const vapid = webpush.generateVAPIDKeys();
    const payload = JSON.stringify({ title: "Clip prêt à valider", body: "Énorme moment — score 92", url: "/app/review" });
    const req = webpush.generateRequestDetails(
      { endpoint: "https://web.push.apple.com/abc", keys: { p256dh: ua.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } },
      payload,
      { vapidDetails: { subject: "mailto:test@example.com", publicKey: vapid.publicKey, privateKey: vapid.privateKey }, TTL: 60, urgency: "high" },
    );
    const headers = req.headers as Record<string, string>;
    expect(headers["Content-Encoding"]).toBe("aes128gcm");
    expect(headers.TTL).toBe(60);
    expect(headers.Urgency).toBe("high");
    // Authorization: vapid t=<JWT>, k=<clé publique>
    const m = /^vapid t=([^,]+), k=(.+)$/.exec(headers.Authorization!);
    expect(m).not.toBeNull();
    expect(m![2]).toBe(vapid.publicKey);
    const claims = JSON.parse(Buffer.from(m![1]!.split(".")[1]!, "base64url").toString());
    expect(claims.aud).toBe("https://web.push.apple.com");
    expect(claims.sub).toBe("mailto:test@example.com");
    expect(claims.exp - Date.now() / 1000).toBeLessThanOrEqual(24 * 3600);

    // Déchiffrement côté « navigateur »
    const body = req.body as Buffer;
    const salt = body.subarray(0, 16);
    const idlen = body[20]!;
    const asPub = body.subarray(21, 21 + idlen);
    const cipher = body.subarray(21 + idlen);
    const shared = ua.computeSecret(asPub);
    const ikm = hkdf(auth, shared, Buffer.concat([Buffer.from("WebPush: info\0"), ua.getPublicKey(), asPub]), 32);
    const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
    const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);
    const d = createDecipheriv("aes-128-gcm", cek, nonce);
    d.setAuthTag(cipher.subarray(cipher.length - 16));
    const plain = Buffer.concat([d.update(cipher.subarray(0, cipher.length - 16)), d.final()]);
    // Dernier enregistrement : délimiteur 0x02 puis remplissage éventuel
    const end = plain.lastIndexOf(2);
    expect(plain.subarray(0, end).toString("utf8")).toBe(payload);
  });
});
